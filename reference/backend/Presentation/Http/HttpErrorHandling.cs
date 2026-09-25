using NotesSample.Domain;

namespace NotesSample.Presentation.Http;

internal static class HttpErrorHandling
{
    internal static void UseHttpErrorHandling(this WebApplication app)
    {
        // APIの失敗をProblem Detailsに揃え、公開しない例外の詳細はログに留める。
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
                // 型付きバインディングが例外を投げずに返すサイズ超過等も公開エラー形式に統一する。
                if (context.Request.Path.StartsWithSegments("/api") && !context.Response.HasStarted
                    && context.Response.ContentType is null
                    && context.Response.StatusCode is 400 or 413 or 415)
                {
                    if (context.Response.StatusCode == StatusCodes.Status400BadRequest)
                        await ProblemResponses.WriteValidationAsync(context, "入力の形式を確認してください。");
                    else
                        await ProblemResponses.WriteAsync(context, context.Response.StatusCode,
                            context.Response.StatusCode == 413 ? "リクエストが大きすぎます。" : "入力の形式を確認してください。");
                }
            }
            catch (AppFaultException fault)
            {
                // SSEなど送信開始後の応答は書き換えられない。
                if (context.Response.HasStarted)
                {
                    throw;
                }

                // 業務上の失敗だけを対応するHTTPステータスへ変換する。
                var status = fault.Code switch
                {
                    "UNAUTHENTICATED" => StatusCodes.Status401Unauthorized,
                    "NOT_FOUND" => StatusCodes.Status404NotFound,
                    "TITLE_EXISTS" => StatusCodes.Status409Conflict,
                    "VALIDATION" => StatusCodes.Status400BadRequest,
                    _ => StatusCodes.Status500InternalServerError,
                };
                if (status == StatusCodes.Status400BadRequest)
                    await ProblemResponses.WriteValidationAsync(context, fault.Message);
                else
                    await ProblemResponses.WriteAsync(context, status, fault.Message);
            }
            // ASP.NET Coreの入力拒否もAPIと同じエラー形式に揃える。
            catch (BadHttpRequestException error) when (error.StatusCode is StatusCodes.Status400BadRequest or StatusCodes.Status413PayloadTooLarge or StatusCodes.Status415UnsupportedMediaType)
            {
                if (context.Response.HasStarted)
                {
                    throw;
                }

                if (error.StatusCode == StatusCodes.Status400BadRequest)
                    await ProblemResponses.WriteValidationAsync(context, "入力の形式を確認してください。");
                else
                    await ProblemResponses.WriteAsync(
                        context,
                        error.StatusCode,
                        error.StatusCode == 413 ? "リクエストが大きすぎます。" : "入力の形式を確認してください。");
            }
            // 想定外の例外内容は応答へ出さない。
            catch (Exception error)
            {
                if (context.Response.HasStarted)
                {
                    throw;
                }

                app.Logger.LogError(error, "機能操作に失敗しました");
                await ProblemResponses.WriteAsync(
                    context,
                    StatusCodes.Status500InternalServerError,
                    "処理を完了できませんでした。");
            }
        });
    }
}
