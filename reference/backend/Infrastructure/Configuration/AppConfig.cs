using System.Net;

namespace NotesSample.Infrastructure.Configuration;

internal sealed record AppConfig(
    string Host,
    int Port,
    string DatabasePath,
    string AuthMode,
    Uri? PublicOrigin,
    IReadOnlySet<string> AllowedOrigins,
    string WebRootPath)
{
    internal static AppConfig FromEnvironment() => FromValues(Environment.GetEnvironmentVariable);

    internal static AppConfig FromValues(Func<string, string?> value)
    {
        var host = value("HOST") ?? "127.0.0.1";
        if (host is not ("127.0.0.1" or "::1"))
        {
            throw new InvalidOperationException("バックエンドはloopbackへバインドしてください。公開は認証プロキシを経由します。");
        }

        if (!int.TryParse(value("PORT") ?? "3000", out var port) || port is < 0 or > 65535)
        {
            throw new InvalidOperationException("PORTは0〜65535で指定してください。");
        }

        var authMode = value("AUTH_MODE") ?? "demo";
        if (authMode is not ("demo" or "proxy"))
        {
            throw new InvalidOperationException("AUTH_MODEはdemoまたはproxyです。");
        }

        var publicOriginText = value("PUBLIC_ORIGIN");
        Uri? publicOrigin = null;
        if (!string.IsNullOrEmpty(publicOriginText))
        {
            if (!Uri.TryCreate(publicOriginText, UriKind.Absolute, out publicOrigin) ||
                publicOrigin.GetLeftPart(UriPartial.Authority) != publicOriginText ||
                !string.IsNullOrEmpty(publicOrigin.PathAndQuery.Trim('/')) ||
                !string.IsNullOrEmpty(publicOrigin.Fragment))
            {
                throw new InvalidOperationException("PUBLIC_ORIGINにはパスを含めずoriginを指定してください。");
            }
        }

        if (authMode == "proxy" && (publicOrigin is null || publicOrigin.Scheme != Uri.UriSchemeHttps))
        {
            throw new InvalidOperationException("proxyモードではHTTPSのPUBLIC_ORIGINが必要です。");
        }

        var databasePath = Path.GetFullPath(value("DB_PATH") ?? "./data/app.sqlite");
        var webRoot = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "wwwroot"));
        var comparison = OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal;
        if (databasePath.Equals(webRoot, comparison) || databasePath.StartsWith(webRoot + Path.DirectorySeparatorChar, comparison))
        {
            throw new InvalidOperationException("DBはWeb公開領域の外に配置してください。");
        }

        var allowedOrigins = (value("DEV_ORIGINS") ?? string.Empty)
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .ToHashSet(StringComparer.Ordinal);

        return new AppConfig(host, port, databasePath, authMode, publicOrigin, allowedOrigins, webRoot);
    }

    internal static string DatabasePathFromEnvironment() =>
        Path.GetFullPath(Environment.GetEnvironmentVariable("DB_PATH") ?? "./data/app.sqlite");

    internal IPAddress BindAddress => IPAddress.Parse(Host);
}
