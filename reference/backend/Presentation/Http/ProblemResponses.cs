namespace NotesSample.Presentation.Http;

internal static class ProblemResponses
{
    internal static Task WriteAsync(HttpContext context, int status, string detail) =>
        Results.Problem(
            statusCode: status,
            title: status switch
            {
                StatusCodes.Status401Unauthorized => "認証が必要です。",
                StatusCodes.Status403Forbidden => "操作できません。",
                StatusCodes.Status404NotFound => "見つかりません。",
                StatusCodes.Status409Conflict => "競合が発生しました。",
                StatusCodes.Status413PayloadTooLarge => "リクエストが大きすぎます。",
                StatusCodes.Status415UnsupportedMediaType => "対応していない形式です。",
                _ => "処理を完了できませんでした。",
            },
            detail: detail)
        .ExecuteAsync(context);

    internal static Task WriteValidationAsync(HttpContext context, string message) =>
        Results.ValidationProblem(
            new Dictionary<string, string[]> { ["request"] = [message] },
            title: "入力内容を確認してください。")
        .ExecuteAsync(context);
}
