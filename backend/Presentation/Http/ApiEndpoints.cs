using System.Text.Json;
using System.Threading.Channels;
using Microsoft.AspNetCore.Mvc;
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
        // SSEは型契約の対象にせず、合図の名前だけを画面と共有する。
        app.MapGet("/api/events", StreamEventsAsync)
            .ExcludeFromDescription();
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
