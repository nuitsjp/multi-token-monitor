using Microsoft.AspNetCore.Http.HttpResults;

namespace MultiTokenMonitor.Presentation.Http;

internal static class ApiEndpoints
{
    internal static void MapApplicationEndpoints(WebApplication app)
    {
        app.MapGet("/health", () => TypedResults.Ok(new HealthOutput("ok")))
            .WithName("GetHealth");
        // 段階2では契約だけを公開する。読み取り処理は段階4で接続する。
        app.MapGet("/api/overview", Results<Ok<OverviewOutput>, ProblemHttpResult> () =>
                TypedResults.Problem(statusCode: StatusCodes.Status501NotImplemented, title: "未実装です。"))
            .WithName("GetOverview");
    }
}
