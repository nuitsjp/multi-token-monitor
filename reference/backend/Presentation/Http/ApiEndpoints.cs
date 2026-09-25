using NotesSample.Infrastructure.Notifications;
using NotesSample.Infrastructure.Configuration;
using NotesSample.Infrastructure.Authentication;
using Microsoft.AspNetCore.Mvc;
using System.Threading.Channels;

namespace NotesSample.Presentation.Http;

internal static class ApiEndpoints
{
    internal static void MapApplicationEndpoints(WebApplication app, AppConfig config, IdentityService identity)
    {
        app.MapGet("/api/session", async (HttpRequest request) =>
            TypedResults.Ok(new SessionOutput(await identity.ResolveAsync(request), config.AuthMode)))
            .WithName("GetSession")
            .Produces<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json");

        if (config.AuthMode == "demo")
        {
            app.MapAnonymousPost<DemoSignInInput, SignInOutput>(
                "/api/demo/sign-in",
                "DemoSignIn",
                async (context, input) =>
                    new SignInOutput(await identity.SignInAsync(context.Request, context.Response, input.User)));
            app.MapPost("/api/demo/sign-out", (HttpContext context) =>
            {
                identity.SignOut(context.Request, context.Response);
                return TypedResults.Ok(new SuccessOutput(true));
            })
            .WithName("DemoSignOut")
            .Produces<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json");
        }
    }

    internal static void MapEventEndpoints(
        WebApplication app,
        IdentityService identity,
        ChangeNotifications notifications,
        CancellationToken applicationStopping)
    {
        app.MapGet("/events/notes", async (HttpContext context) =>
        {
            var user = await identity.RequireAsync(context.Request);
            using var stopping = CancellationTokenSource.CreateLinkedTokenSource(
                context.RequestAborted,
                applicationStopping);
            var cancellationToken = stopping.Token;
            context.Response.StatusCode = StatusCodes.Status200OK;
            context.Response.ContentType = "text/event-stream";
            context.Response.Headers.CacheControl = "no-store";
            context.Response.Headers.Connection = "keep-alive";
            context.Response.Headers["X-Accel-Buffering"] = "no";
            var pending = Channel.CreateUnbounded<bool>(new UnboundedChannelOptions
            {
                SingleReader = true,
                SingleWriter = false,
            });
            using var subscription = notifications.Subscribe(user.Id, () => pending.Writer.TryWrite(true));
            using var keepalive = new Timer(_ => pending.Writer.TryWrite(false), null, TimeSpan.FromSeconds(15), TimeSpan.FromSeconds(15));
            try
            {
                await WriteEventAsync(context.Response, "ready", cancellationToken);
                while (await pending.Reader.WaitToReadAsync(cancellationToken))
                {
                    var changed = false;
                    while (pending.Reader.TryRead(out var item))
                    {
                        changed |= item;
                    }

                    if (changed)
                    {
                        await WriteEventAsync(context.Response, "notes.changed", cancellationToken);
                    }
                    else
                    {
                        await context.Response.WriteAsync(": keepalive\n\n", cancellationToken);
                        await context.Response.Body.FlushAsync(cancellationToken);
                    }
                }
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
            }
        });

        app.MapGet("/health", () => TypedResults.Ok(new HealthOutput("ok")));
    }

    private static async Task WriteEventAsync(HttpResponse response, string eventName, CancellationToken cancellationToken)
    {
        await response.WriteAsync($"event: {eventName}\ndata: {{}}\n\n", cancellationToken);
        await response.Body.FlushAsync(cancellationToken);
    }
}
