namespace MultiTokenMonitor.Presentation.Http;

internal static class ApiEndpoints
{
    internal static void MapApplicationEndpoints(WebApplication app)
    {
        app.MapGet("/health", () => TypedResults.Ok(new HealthOutput("ok")))
            .WithName("GetHealth");
    }
}
