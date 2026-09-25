using System.Net;

namespace MultiTokenMonitor.Infrastructure.Configuration;

internal sealed record AppConfig(
    string Host,
    int Port,
    string DatabasePath,
    string WebRootPath)
{
    internal static AppConfig FromEnvironment() => FromValues(Environment.GetEnvironmentVariable);

    internal static AppConfig FromValues(Func<string, string?> value)
    {
        var host = value("HOST") ?? "127.0.0.1";
        if (host is not ("127.0.0.1" or "::1"))
        {
            throw new InvalidOperationException("バックエンドはloopbackへバインドしてください。");
        }

        if (!int.TryParse(value("PORT") ?? "3000", out var port) || port is < 0 or > 65535)
        {
            throw new InvalidOperationException("PORTは0〜65535で指定してください。");
        }

        var databasePath = Path.GetFullPath(value("DB_PATH") ?? "./data/app.sqlite");
        var webRoot = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "wwwroot"));
        var comparison = OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal;
        if (databasePath.Equals(webRoot, comparison) || databasePath.StartsWith(webRoot + Path.DirectorySeparatorChar, comparison))
        {
            throw new InvalidOperationException("DBはWeb公開領域の外に配置してください。");
        }

        return new AppConfig(host, port, databasePath, webRoot);
    }

    internal static string DatabasePathFromEnvironment() =>
        Path.GetFullPath(Environment.GetEnvironmentVariable("DB_PATH") ?? "./data/app.sqlite");

    internal IPAddress BindAddress => IPAddress.Parse(Host);
}
