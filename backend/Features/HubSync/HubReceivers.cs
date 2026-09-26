using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using MultiTokenMonitor.Infrastructure.Configuration;
using MultiTokenMonitor.Infrastructure.Notifications;
using MultiTokenMonitor.Infrastructure.Persistence;

namespace MultiTokenMonitor.Features.HubSync;

// Hubごとに独立したSSE受信を動かす。あるHubの失敗はそのHubだけを再接続させる。
internal sealed class HubReceivers(
    IReadOnlyList<HubConnection> hubs,
    Database database,
    ChangeNotifications notifications,
    ILogger<HubReceivers> logger) : BackgroundService
{
    private readonly HttpClient client = new(new SocketsHttpHandler { AllowAutoRedirect = false })
    {
        Timeout = Timeout.InfiniteTimeSpan,
    };

    protected override Task ExecuteAsync(CancellationToken stoppingToken) =>
        Task.WhenAll(hubs.Select(hub => Task.Run(() => ReceiveAsync(hub, stoppingToken), CancellationToken.None)));

    public override void Dispose()
    {
        client.Dispose();
        base.Dispose();
    }

    private static readonly TimeSpan FirstRetryDelay = TimeSpan.FromSeconds(1);
    private static readonly TimeSpan MaxRetryDelay = TimeSpan.FromSeconds(60);

    // 受信が止まった理由を問わず、待ち時間を倍にしながら上限なく再接続する。
    private async Task ReceiveAsync(HubConnection hub, CancellationToken stoppingToken)
    {
        // 起動時の登録で受信中に戻っている。
        var connected = true;
        var delay = FirstRetryDelay;
        while (true)
        {
            var saved = false;
            string cause;
            try
            {
                cause = await ReceiveUntilFailureAsync(hub, () => saved = true, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                // 終了要求による停止。
                return;
            }
            catch (Exception error)
            {
                cause = $"connection Error={error.GetType().Name}";
            }

            if (saved)
            {
                connected = true;
                delay = FirstRetryDelay;
            }

            // 例外・応答本文・URL・トークンは秘密情報を含み得るため、原因の分類だけを記録する。
            logger.LogError("Hub受信が止まりました。再接続を待ちます。HubId={HubId} Cause={Cause} DelaySeconds={DelaySeconds}",
                hub.Id, cause, delay.TotalSeconds);

            if (connected)
            {
                try
                {
                    await HubStateStore.MarkReconnectingAsync(database, hub.Id);
                    connected = false;
                    notifications.Publish();
                }
                catch (Exception error)
                {
                    // 記録できなかった場合は、次に受信が止まったときに改めて記録する。
                    logger.LogError("受信状態を記録できませんでした。HubId={HubId} Error={ErrorType}", hub.Id, error.GetType().Name);
                }
            }

            try
            {
                await Task.Delay(delay, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                return;
            }

            delay = TimeSpan.FromTicks(Math.Min(delay.Ticks * 2, MaxRetryDelay.Ticks));
        }
    }

    private async Task<string> ReceiveUntilFailureAsync(HubConnection hub, Action saved, CancellationToken stoppingToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, new Uri(hub.Origin, "/api/stats/stream"));
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", hub.Token);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("text/event-stream"));
        request.Headers.Add("x-token-monitor-stream", "2");
        using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, stoppingToken);
        if (response.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden)
            return $"authentication Status={(int)response.StatusCode}";
        if (!response.IsSuccessStatusCode || response.Content.Headers.ContentType?.MediaType is not { } mediaType ||
            !mediaType.Equals("text/event-stream", StringComparison.OrdinalIgnoreCase))
            return $"response Status={(int)response.StatusCode}";

        await using var stream = await response.Content.ReadAsStreamAsync(stoppingToken);
        using var reader = new StreamReader(stream, new UTF8Encoding(false, throwOnInvalidBytes: true));
        var snapshotReceived = false;
        var eventName = "";
        var data = new List<string>();
        while (true)
        {
            string? line;
            try
            {
                line = await reader.ReadLineAsync(stoppingToken);
            }
            catch (DecoderFallbackException)
            {
                return "invalid-notification";
            }

            if (line is null) return "disconnected";
            // コメント行（heartbeat）は保存しない。
            if (line.StartsWith(':')) continue;
            if (line.Length > 0)
            {
                var colon = line.IndexOf(':');
                var field = colon < 0 ? line : line[..colon];
                var value = colon < 0 ? "" : line[(colon + 1)..];
                if (value.StartsWith(' ')) value = value[1..];
                if (field == "event") eventName = value;
                else if (field == "data") data.Add(value);
                continue;
            }

            // 空行で1件の通知を確定する。
            if (data.Count == 0)
            {
                eventName = "";
                continue;
            }

            var receivedAt = DateTimeOffset.UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'");
            HubNotification notification;
            try
            {
                notification = HubNotification.Parse(eventName, string.Join('\n', data));
            }
            catch (JsonException)
            {
                return "invalid-notification";
            }

            // 各接続で最初の snapshot より前の差分通知は受け付けない。
            if (!snapshotReceived && notification.Kind != HubNotificationKind.Snapshot) return "invalid-notification";

            try
            {
                // 保存は終了要求で中断せず、COMMITまたはロールバックまで進める。
                await HubStateStore.SaveAsync(database, hub.Id, notification, receivedAt);
            }
            catch (Exception)
            {
                return "database";
            }

            // COMMIT後にだけ、保存の種類を問わず閲覧側へ合図する。
            notifications.Publish();
            saved();
            snapshotReceived = true;
            logger.LogInformation("Hubの最新状態を保存しました。HubId={HubId} Event={Event} ReceivedAt={ReceivedAt}",
                hub.Id, eventName, receivedAt);
            eventName = "";
            data.Clear();
        }
    }
}
