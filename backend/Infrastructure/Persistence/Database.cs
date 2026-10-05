using Dapper;
using Microsoft.Data.Sqlite;

namespace MultiTokenMonitor.Infrastructure.Persistence;

internal sealed class Database
{
    private readonly string path;

    internal Database(string databasePath)
    {
        if (databasePath == ":memory:")
        {
            throw new InvalidOperationException("このアプリはファイルDBを使用します。テストも専用ファイルを指定してください。");
        }

        path = Path.GetFullPath(databasePath);
    }

    internal async Task InitializeAsync()
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        await using var connection = await OpenAsync();
        await connection.ExecuteAsync("""
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = FULL;
            """);
        await connection.ExecuteAsync("BEGIN IMMEDIATE;");
        try
        {
            var version = await connection.ExecuteScalarAsync<int>("PRAGMA user_version;");
            string[] migrations = ["001-hub-sync.sql", "002-limit-estimate.sql", "003-limit-window-minutes.sql", "004-daily-token-usages.sql", "005-device-daily-model-usages.sql", "006-limit-cost-baselines.sql", "007-limit-history.sql", "008-hub-connection.sql"];
            if (version < 0 || version > migrations.Length)
            {
                throw new InvalidOperationException("未対応のDBスキーマです。");
            }

            // 現在の版より後の移行を順に適用し、同じトランザクションで版を更新する。
            for (var next = version; next < migrations.Length; next++)
            {
                using var stream = typeof(Database).Assembly.GetManifestResourceStream($"MultiTokenMonitor.Migrations.{migrations[next]}")
                    ?? throw new InvalidOperationException("DB migrationが見つかりません。");
                using var reader = new StreamReader(stream);
                await connection.ExecuteAsync(await reader.ReadToEndAsync());
                await connection.ExecuteAsync($"PRAGMA user_version = {next + 1};");
            }

            await connection.ExecuteAsync("COMMIT;");
        }
        catch
        {
            await connection.ExecuteAsync("ROLLBACK;");
            throw;
        }
    }

    internal async Task InTransactionAsync(Func<SqliteConnection, Task> operation)
    {
        await using var connection = await OpenAsync();
        await connection.ExecuteAsync("BEGIN IMMEDIATE;");
        try
        {
            await operation(connection);
            await connection.ExecuteAsync("COMMIT;");
        }
        catch
        {
            await connection.ExecuteAsync("ROLLBACK;");
            throw;
        }
    }

    // 読み取り専用接続の1トランザクション内で読み、複数のSELECTを同じ時点の状態で揃える。
    internal async Task<T> InReadTransactionAsync<T>(Func<SqliteConnection, Task<T>> operation)
    {
        await using var connection = await OpenReadOnlyAsync(path);
        await connection.ExecuteAsync("BEGIN;");
        try
        {
            return await operation(connection);
        }
        finally
        {
            await connection.ExecuteAsync("COMMIT;");
        }
    }

    internal void Backup(string destinationPath)
    {
        var source = path;
        var destination = Path.GetFullPath(destinationPath);
        var comparison = OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal;
        if (source.Equals(destination, comparison) || File.Exists(destination))
        {
            throw new InvalidOperationException("バックアップ先は未作成の別ファイルにしてください。");
        }

        if (!File.Exists(source))
        {
            throw new FileNotFoundException("バックアップ元DBが見つかりません。", source);
        }

        Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
        using var sourceConnection = OpenReadOnly(source);
        using var destinationConnection = CreateConnection(destination, SqliteOpenMode.ReadWriteCreate);
        destinationConnection.Open();
        sourceConnection.BackupDatabase(destinationConnection);
    }

    internal async Task<DatabaseCheck> CheckAsync()
    {
        await using var connection = await OpenReadOnlyAsync(path);
        var version = await connection.ExecuteScalarAsync<int>("PRAGMA user_version;");
        var results = (await connection.QueryAsync<string>("PRAGMA quick_check;")).AsList();

        return new DatabaseCheck(version, results);
    }

    private static SqliteConnection OpenReadOnly(string path)
    {
        var connection = CreateConnection(path, SqliteOpenMode.ReadOnly);
        try
        {
            connection.Open();
            connection.Execute("PRAGMA busy_timeout = 2000;");
            return connection;
        }
        catch
        {
            connection.Dispose();
            throw;
        }
    }

    private static async Task<SqliteConnection> OpenReadOnlyAsync(string path)
    {
        var connection = CreateConnection(path, SqliteOpenMode.ReadOnly);
        try
        {
            await connection.OpenAsync();
            await connection.ExecuteAsync("PRAGMA busy_timeout = 2000;");
            return connection;
        }
        catch
        {
            await connection.DisposeAsync();
            throw;
        }
    }

    internal async Task<SqliteConnection> OpenAsync()
    {
        var connection = CreateConnection(path, SqliteOpenMode.ReadWriteCreate);
        try
        {
            await connection.OpenAsync();
            await connection.ExecuteAsync("""
                PRAGMA foreign_keys = ON;
                PRAGMA busy_timeout = 2000;
                PRAGMA synchronous = FULL;
                """);
            return connection;
        }
        catch
        {
            await connection.DisposeAsync();
            throw;
        }
    }

    private static SqliteConnection CreateConnection(string databasePath, SqliteOpenMode mode) =>
        new(new SqliteConnectionStringBuilder
        {
            DataSource = databasePath,
            Mode = mode,
            Pooling = false,
            DefaultTimeout = 2,
        }.ToString());
}
