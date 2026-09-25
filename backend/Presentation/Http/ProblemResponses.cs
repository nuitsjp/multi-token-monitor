namespace MultiTokenMonitor.Presentation.Http;

internal static class ProblemResponses
{
    internal static Task WriteAsync(HttpContext context, int status, string detail) =>
        Results.Problem(
            statusCode: status,
            title: status == StatusCodes.Status404NotFound ? "見つかりません。" : "処理を完了できませんでした。",
            detail: detail)
        .ExecuteAsync(context);
}
