using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using MultiTokenMonitor.Infrastructure.Configuration;
using MultiTokenMonitor.Infrastructure.Persistence;

namespace MultiTokenMonitor.Features.HubSync;

// Hubごとに独立したSSE受信を動かす。あるHubの失敗はそのHubの受信だけを止める。
internal sealed class HubReceivers(
    IReadOnlyList<HubConnection> hubs,
    Database database,
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

    private async Task ReceiveAsync(HubConnection hub, CancellationToken stoppingToken)
    {
        try
        {
            var cause = await ReceiveUntilFailureAsync(hub, stoppingToken);
            // 例外・応答本文・URL・トークンは秘密情報を含み得るため、原因の分類だけを記録する。
            logger.LogError("Hub受信を停止しました。HubId={HubId} Cause={Cause}", hub.Id, cause);
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            // 終了要求による停止。
        }
        catch (Exception error)
        {
            logger.LogError("Hub受信を停止しました。HubId={HubId} Cause=connection Error={ErrorType}", hub.Id, error.GetType().Name);
        }
    }

    private async Task<string> ReceiveUntilFailureAsync(HubConnection hub, CancellationToken stoppingToken)
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

            snapshotReceived = true;
            logger.LogInformation("Hubの最新状態を保存しました。HubId={HubId} Event={Event} ReceivedAt={ReceivedAt}",
                hub.Id, eventName, receivedAt);
            eventName = "";
            data.Clear();
        }
    }
}
