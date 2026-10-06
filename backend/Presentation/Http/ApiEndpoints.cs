using System.Text.Json;
using System.Threading.Channels;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Mvc;
using MultiTokenMonitor.Features.HubRegistration;
using MultiTokenMonitor.Features.HubSync;
using MultiTokenMonitor.Features.Overview;
using MultiTokenMonitor.Features.HubUsage;
using MultiTokenMonitor.Features.LimitHistory;
using MultiTokenMonitor.Infrastructure.Notifications;
using MultiTokenMonitor.Infrastructure.Persistence;

namespace MultiTokenMonitor.Presentation.Http;

internal static class ApiEndpoints
{
    internal static void MapApplicationEndpoints(WebApplication app)
    {
        app.MapGet("/health", () => TypedResults.Ok(new HealthOutput("ok")))
            .WithName("GetHealth");
        app.MapGet("/api/overview", async ([FromServices] Database database) =>
                TypedResults.Ok(await OverviewQuery.ReadAsync(database)))
            .WithName("GetOverview");
        app.MapGet("/api/hub-usage", async ([FromServices] Database database) =>
                TypedResults.Ok(await HubUsageQuery.ReadAsync(database)))
            .WithName("GetHubUsage");
        app.MapGet("/api/limit-history", async ([FromServices] Database database) =>
                TypedResults.Ok(await LimitHistoryQuery.ReadAsync(database)))
            .WithName("GetLimitHistory");
        app.MapGet("/api/hubs", async ([FromServices] Database database) =>
                TypedResults.Ok(await HubRegistry.ListAsync(database)))
            .WithName("GetHubs");
        app.MapPost("/api/hubs", AddHubAsync)
            .WithName("AddHub");
        app.MapPut("/api/hubs/{hubId}", UpdateHubAsync)
            .WithName("UpdateHub");
        // SSEは型契約の対象にせず、合図の名前だけを画面と共有する。
        app.MapGet("/api/events", StreamEventsAsync)
            .ExcludeFromDescription();
    }

    // 入力の検証と接続の確認の後に保存し、保存の確定後に受信を開始して閲覧側へ変更を通知する。認証トークンは応答に含めない。
    private static async Task<Results<Created<HubRegistrationOutput>, ValidationProblem>> AddHubAsync(
        AddHubInput input,
        [FromServices] Database database,
        [FromServices] HubReceivers receivers,
        [FromServices] ChangeNotifications notifications,
        CancellationToken cancellationToken)
    {
        var (errors, origin) = HubRegistry.Validate(input.Name, input.Url, input.Token);
        if (errors.Count > 0) return TypedResults.ValidationProblem(errors);
        if (await HubConnectionCheck.CheckAsync(origin!, input.Token!.Trim(), cancellationToken) is { } rejected)
            return TypedResults.ValidationProblem(new Dictionary<string, string[]> { ["token"] = [rejected] });

        var hub = await HubRegistry.AddAsync(database, input.Name!, origin!, input.Token!);
        receivers.Start(hub);
        notifications.Publish();
        return TypedResults.Created(
            $"/api/hubs/{hub.Id}",
            new HubRegistrationOutput(hub.Id, hub.Name, hub.Origin.GetLeftPart(UriPartial.Authority), "notReceived"));
    }

    // Token が空なら登録済みの認証トークンを使う。URLまたは認証トークンが変わるときだけ、保存の前に接続を確認し、
    // 保存の確定後に受信を新しい接続情報で開始し直す。
    private static async Task<Results<Ok<HubRegistrationOutput>, NotFound, ValidationProblem>> UpdateHubAsync(
        string hubId,
        UpdateHubInput input,
        [FromServices] Database database,
        [FromServices] HubReceivers receivers,
        [FromServices] ChangeNotifications notifications,
        CancellationToken cancellationToken)
    {
        if (await HubRegistry.FindAsync(database, hubId) is not { } stored) return TypedResults.NotFound();
        var token = string.IsNullOrWhiteSpace(input.Token) ? stored.Token : input.Token;
        var (errors, origin) = HubRegistry.Validate(input.Name, input.Url, token);
        if (errors.Count > 0) return TypedResults.ValidationProblem(errors);

        var hub = new HubConnection(hubId, input.Name!.Trim(), origin!, token.Trim());
        var connectionChanged = hub.Origin.GetLeftPart(UriPartial.Authority) != stored.Url || hub.Token != stored.Token;
        if (connectionChanged &&
            await HubConnectionCheck.CheckAsync(hub.Origin, hub.Token, cancellationToken) is { } rejected)
            return TypedResults.ValidationProblem(new Dictionary<string, string[]> { ["token"] = [rejected] });

        await HubRegistry.UpdateAsync(database, hub, connectionChanged);
        if (connectionChanged) await receivers.RestartAsync(hub);
        notifications.Publish();
        return TypedResults.Ok((await HubRegistry.ReadAsync(database, hubId))!);
    }

    private static async Task StreamEventsAsync(
        HttpContext context,
        [FromServices] ChangeNotifications notifications,
        [FromServices] IHostApplicationLifetime lifetime)
    {
        using var stopping = CancellationTokenSource.CreateLinkedTokenSource(
            context.RequestAborted,
            lifetime.ApplicationStopping);
        var cancellationToken = stopping.Token;
        context.Response.ContentType = "text/event-stream";
        context.Response.Headers.CacheControl = "no-store";
        // 未送信の合図は、全体の変更を1件、時刻の更新をHubごとに最新の1件だけ保持してまとめる。
        var signal = Channel.CreateBounded<bool>(new BoundedChannelOptions(1)
        {
            FullMode = BoundedChannelFullMode.DropWrite,
            SingleReader = true,
        });
        var gate = new object();
        var overviewChanged = false;
        var freshness = new Dictionary<string, HubFreshnessChanged>(StringComparer.Ordinal);
        using var subscription = notifications.Subscribe(change =>
        {
            lock (gate)
            {
                if (change is null) overviewChanged = true;
                else freshness[change.HubId] = change;
            }

            signal.Writer.TryWrite(true);
        });
        try
        {
            await WriteEventAsync(context.Response, "ready", "{}", cancellationToken);
            while (true)
            {
                await signal.Reader.ReadAsync(cancellationToken);
                bool changed;
                HubFreshnessChanged[] changes;
                lock (gate)
                {
                    changed = overviewChanged;
                    changes = [.. freshness.Values];
                    overviewChanged = false;
                    freshness.Clear();
                }

                if (changed) await WriteEventAsync(context.Response, "overview.changed", "{}", cancellationToken);
                foreach (var change in changes)
                    await WriteEventAsync(context.Response, "hub.freshness",
                        JsonSerializer.Serialize(change, JsonSerializerOptions.Web), cancellationToken);
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            // 画面の切断または終了要求による停止。
        }
    }

    private static async Task WriteEventAsync(HttpResponse response, string eventName, string data, CancellationToken cancellationToken)
    {
        await response.WriteAsync($"event: {eventName}\ndata: {data}\n\n", cancellationToken);
        await response.Body.FlushAsync(cancellationToken);
    }
}
