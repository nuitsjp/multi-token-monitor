using Microsoft.AspNetCore.Mvc;
using MultiTokenMonitor.Features.Overview;
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
    }
}
