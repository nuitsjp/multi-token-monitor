using System.Text.Json;
using MultiTokenMonitor.Infrastructure.Configuration;

namespace MultiTokenMonitor.Infrastructure.Persistence;

internal static class DatabaseCommands
{
    internal static async Task<int> RunAsync(string[] args)
    {
        if (args is ["db:backup", var destination])
        {
            new Database(AppConfig.DatabasePathFromEnvironment()).Backup(destination);
            Console.WriteLine("整合したバックアップを作成しました。");
            return 0;
        }

        if (args is ["db:check", var path])
        {
            var result = await new Database(path).CheckAsync();
            Console.WriteLine(JsonSerializer.Serialize(new { version = result.Version, result = result.Result }));
            return result.IsHealthy ? 0 : 1;
        }

        throw new InvalidOperationException("使用方法: MultiTokenMonitor db:backup <新規ファイル> | App db:check <DBファイル>");
    }
}
