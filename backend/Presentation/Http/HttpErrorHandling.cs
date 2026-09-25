namespace MultiTokenMonitor.Presentation.Http;

internal static class HttpErrorHandling
{
    internal static void UseHttpErrorHandling(this WebApplication app)
    {
        // 失敗をProblem Detailsに揃え、公開しない例外の詳細はログに留める。
        app.Use(async (context, next) =>
        {
            // UIとAPIの両方へ共通のブラウザー保護ヘッダーを付ける。
            context.Response.Headers["X-Content-Type-Options"] = "nosniff";
            context.Response.Headers["Referrer-Policy"] = "same-origin";
            context.Response.Headers["Content-Security-Policy"] =
                "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'";
            try
            {
                await next(context);
            }
            // 想定外の例外内容は応答へ出さない。
            catch (Exception error)
            {
                if (context.Response.HasStarted)
                {
                    throw;
                }

                app.Logger.LogError(error, "処理に失敗しました");
                await ProblemResponses.WriteAsync(
                    context,
                    StatusCodes.Status500InternalServerError,
                    "処理を完了できませんでした。");
            }
        });
    }
}
