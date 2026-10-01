using System.Net;

namespace MultiTokenMonitor.Infrastructure.Configuration;

internal sealed record AppConfig(
    string Host,
    int Port,
    string DatabasePath,
    string WebRootPath,
    string? HubConfigPath,
    double RetryTimeScale = 1)
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

        var hubConfigPath = value("HUB_CONFIG_PATH") is { } path ? Path.GetFullPath(path) : null;
        // Hub再接続の待ち時間にかける倍率。E2Eが待ち時間を縮めるための設定で、通常は指定しない。
        var retryTimeScale = 1.0;
        if (value("HUB_RETRY_TIME_SCALE") is { } scale &&
            (!double.TryParse(scale, System.Globalization.CultureInfo.InvariantCulture, out retryTimeScale) ||
             retryTimeScale is <= 0 or > 1))
        {
            throw new InvalidOperationException("HUB_RETRY_TIME_SCALEは0より大きく1以下で指定してください。");
        }

        return new AppConfig(host, port, databasePath, webRoot, hubConfigPath, retryTimeScale);
    }

    internal static string DatabasePathFromEnvironment() =>
        Path.GetFullPath(Environment.GetEnvironmentVariable("DB_PATH") ?? "./data/app.sqlite");

    internal IPAddress BindAddress => IPAddress.Parse(Host);
}
