using NotesSample.Infrastructure.Configuration;

namespace NotesSample.Presentation.Http;

internal static class ApiRequestGuard
{
    internal static void UseApiRequestGuard(this WebApplication app, AppConfig config)
    {
        // APIと変更通知へのアクセスは、許可された接続先とOriginに限定する。
        app.Use(async (context, next) =>
        {
            // UIの静的配信にはAPI専用の接続元制限を適用しない。
            if (!context.Request.Path.StartsWithSegments("/api") && context.Request.Path != "/events/notes")
            {
                await next(context);
                return;
            }

            context.Response.Headers.CacheControl = "no-store";
            // Hostヘッダーを検査し、別の接続先名を使ったAPI呼び出しを拒否する。
            var port = context.Connection.LocalPort;
            var localHost = config.Host == "::1" ? $"[::1]:{port}" : $"{config.Host}:{port}";
            var publicHost = config.PublicOrigin?.Authority;
            var requestHost = context.Request.Host.Value ?? string.Empty;
            if (!requestHost.Equals(localHost, StringComparison.OrdinalIgnoreCase) &&
                !requestHost.Equals($"localhost:{port}", StringComparison.OrdinalIgnoreCase) &&
                (publicHost is null || !requestHost.Equals(publicHost, StringComparison.OrdinalIgnoreCase)))
            {
                await ProblemResponses.WriteAsync(
                    context,
                    StatusCodes.Status403Forbidden,
                    "接続先が不正です。");
                return;
            }

            // 書込みにはOriginを必須とし、許可済みのサイトからの操作だけ通す。
            var localOrigin = $"http://{localHost}";
            var expectedOrigin = config.PublicOrigin?.GetLeftPart(UriPartial.Authority) ?? localOrigin;
            var origin = context.Request.Headers.Origin.ToString();
            if ((!string.IsNullOrEmpty(origin) && origin != expectedOrigin && !config.AllowedOrigins.Contains(origin)) ||
                (HttpMethods.IsPost(context.Request.Method) && string.IsNullOrEmpty(origin)))
            {
                await ProblemResponses.WriteAsync(
                    context,
                    StatusCodes.Status403Forbidden,
                    "同一サイトから操作してください。");
                return;
            }

            await next(context);
        });
    }
}
