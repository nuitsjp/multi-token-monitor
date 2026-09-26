using System.Threading.Channels;
using Microsoft.AspNetCore.Mvc;
using MultiTokenMonitor.Features.Overview;
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
        // 未送信の合図は1件だけ保持し、続く合図をまとめる。
        var pending = Channel.CreateBounded<bool>(new BoundedChannelOptions(1)
        {
            FullMode = BoundedChannelFullMode.DropWrite,
            SingleReader = true,
        });
        using var subscription = notifications.Subscribe(() => pending.Writer.TryWrite(true));
        try
        {
            await WriteEventAsync(context.Response, "ready", cancellationToken);
            while (true)
            {
                await pending.Reader.ReadAsync(cancellationToken);
                await WriteEventAsync(context.Response, "overview.changed", cancellationToken);
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            // 画面の切断または終了要求による停止。
        }
    }

    private static async Task WriteEventAsync(HttpResponse response, string eventName, CancellationToken cancellationToken)
    {
        await response.WriteAsync($"event: {eventName}\ndata: {{}}\n\n", cancellationToken);
        await response.Body.FlushAsync(cancellationToken);
    }
}
