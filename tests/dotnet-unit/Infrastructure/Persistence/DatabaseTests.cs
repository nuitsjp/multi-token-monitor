using Dapper;
using Microsoft.Data.Sqlite;
using MultiTokenMonitor.Infrastructure.Persistence;
using Shouldly;
using Xunit;

namespace MultiTokenMonitor.UnitTests.Infrastructure.Persistence;

public sealed class DatabaseTests
{
    [Fact]
    public async Task SeparateInstances_KeepPathsIndependentAsync()
    {
        // -------------------------------------------------------------
        // Arrange
        // -------------------------------------------------------------
        using var first = TemporaryDatabase.Create();
        using var second = TemporaryDatabase.Create();
        await first.Database.InitializeAsync();
        await second.Database.InitializeAsync();

        // -------------------------------------------------------------
        // Act
        // -------------------------------------------------------------
        await using (var connection = await first.Database.OpenAsync())
        {
            await connection.ExecuteAsync("CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL); INSERT INTO users (id, name) VALUES ('first', 'First')");
        }

        // -------------------------------------------------------------
        // Assert
        // -------------------------------------------------------------
        (await CountUsersAsync(first.Database)).ShouldBe(1);
        (await CountUsersTablesAsync(second.Database)).ShouldBe(0);
    }

    public sealed class Constructor
    {
        [Fact]
        public void MemoryDatabase_ThrowsInvalidOperation()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            const string path = ":memory:";

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            var error = Record.Exception(() => new Database(path));

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            error.ShouldBeOfType<InvalidOperationException>();
        }
    }

    public sealed class InitializeAsync
    {
        [Fact]
        public async Task NewFile_MigratesToTheLatestSchemaVersionWithWalAsync()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            using var fixture = TemporaryDatabase.Create();

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            await fixture.Database.InitializeAsync();

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            await using var connection = await fixture.Database.OpenAsync();
            (await connection.ExecuteScalarAsync<int>("PRAGMA user_version")).ShouldBe(8);
            (await connection.ExecuteScalarAsync<string>("PRAGMA journal_mode")).ShouldBe("wal");
        }

        [Fact]
        public async Task NewFile_CreatesTheLimitTablesWithBaselineCostsInsteadOfCostColumnsAsync()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            using var fixture = TemporaryDatabase.Create();

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            await fixture.Database.InitializeAsync();

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            await using var connection = await fixture.Database.OpenAsync();
            async Task<string[]> ColumnsAsync(string table) =>
                (await connection.QueryAsync<string>($"SELECT name FROM pragma_table_info('{table}') ORDER BY cid")).ToArray();
            (await ColumnsAsync("hub_accounts")).ShouldBe(["hub_id", "provider", "account_key", "source_device_id"]);
            var windows = await ColumnsAsync("latest_limit_windows");
            windows.ShouldContain("base_remaining_percent");
            windows.ShouldContain("window_minutes");
            windows.ShouldNotContain("base_cost_usd");
            windows.ShouldNotContain("cost_usd");
            (await ColumnsAsync("limit_window_baseline_costs"))
                .ShouldBe(["hub_id", "provider", "account_key", "kind", "limit_key", "device_id", "model", "cost_usd"]);
        }

        [Fact]
        public async Task VersionFiveFile_DropsTheOldLimitWindowsAndKeepsTheRestAsync()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            using var fixture = TemporaryDatabase.Create();
            await fixture.Database.InitializeAsync();
            await using (var connection = await fixture.Database.OpenAsync())
            {
                // 版5の利用枠（コストを列に持つ）に戻して、行を1つ入れる。
                await connection.ExecuteAsync(
                    """
                    ALTER TABLE hubs DROP COLUMN url;
                    ALTER TABLE hubs DROP COLUMN token;
                    DROP TABLE daily_monthly_limits;
                    DROP TABLE plan_prices;
                    DROP TABLE limit_window_baseline_costs;
                    DROP TABLE latest_limit_windows;
                    DROP TABLE hub_accounts;
                    CREATE TABLE latest_limit_windows (
                      hub_id TEXT NOT NULL REFERENCES hubs(hub_id) ON DELETE CASCADE,
                      provider TEXT NOT NULL,
                      account_key TEXT NOT NULL,
                      kind TEXT NOT NULL,
                      limit_key TEXT NOT NULL,
                      label TEXT,
                      remaining_percent REAL NOT NULL,
                      used_percent REAL,
                      resets_at TEXT,
                      meter_changed_at TEXT NOT NULL,
                      base_received_at TEXT NOT NULL,
                      base_remaining_percent REAL NOT NULL,
                      base_cost_usd REAL NOT NULL,
                      cost_usd REAL NOT NULL,
                      window_minutes REAL,
                      PRIMARY KEY (hub_id, provider, account_key, kind, limit_key),
                      FOREIGN KEY (provider, account_key) REFERENCES accounts(provider, account_key)
                    ) STRICT;
                    INSERT INTO hubs (hub_id, name, connected) VALUES ('hub', 'Hub', 1);
                    INSERT INTO accounts (provider, account_key, account_label, plan_label) VALUES ('codex', 'a', 'A', 'Pro');
                    INSERT INTO latest_limit_windows VALUES
                      ('hub', 'codex', 'a', 'weekly', 'codex', NULL, 50, 50, NULL, 't', 't', 60, 1, 2, 10080);
                    PRAGMA user_version = 5;
                    """);
            }

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            await fixture.Database.InitializeAsync();

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            await using var migrated = await fixture.Database.OpenAsync();
            (await migrated.ExecuteScalarAsync<int>("PRAGMA user_version")).ShouldBe(8);
            (await migrated.ExecuteScalarAsync<long>("SELECT COUNT(*) FROM latest_limit_windows")).ShouldBe(0);
            (await migrated.ExecuteScalarAsync<long>("SELECT COUNT(*) FROM hubs")).ShouldBe(1);
            (await migrated.ExecuteScalarAsync<long>("SELECT COUNT(*) FROM accounts")).ShouldBe(1);
            (await migrated.ExecuteScalarAsync<long>("SELECT COUNT(*) FROM hub_accounts")).ShouldBe(0);
        }

        [Fact]
        public async Task VersionSevenFile_AddsEmptyHubConnectionAndKeepsTheHubAsync()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            using var fixture = TemporaryDatabase.Create();
            await fixture.Database.InitializeAsync();
            await using (var connection = await fixture.Database.OpenAsync())
            {
                // 版7（URL・認証トークンの列がない）に戻して、Hubを1つ入れる。
                await connection.ExecuteAsync(
                    """
                    ALTER TABLE hubs DROP COLUMN url;
                    ALTER TABLE hubs DROP COLUMN token;
                    INSERT INTO hubs (hub_id, name, connected) VALUES ('hub', 'Hub', 1);
                    INSERT INTO daily_token_usages (hub_id, date, tokens, cost_usd) VALUES ('hub', '2026-10-01', 5, NULL);
                    PRAGMA user_version = 7;
                    """);
            }

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            await fixture.Database.InitializeAsync();

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            await using var migrated = await fixture.Database.OpenAsync();
            (await migrated.ExecuteScalarAsync<int>("PRAGMA user_version")).ShouldBe(8);
            (await migrated.QuerySingleAsync<(string Url, string Token)>("SELECT url, token FROM hubs WHERE hub_id = 'hub'"))
                .ShouldBe(("", ""));
            (await migrated.ExecuteScalarAsync<long>("SELECT COUNT(*) FROM daily_token_usages")).ShouldBe(1);
        }

        [Fact]
        public async Task UnknownSchemaVersion_IsRejectedWithoutDeletingDataAsync()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            using var fixture = TemporaryDatabase.Create();
            await fixture.Database.InitializeAsync();
            await using (var connection = await fixture.Database.OpenAsync())
            {
                await connection.ExecuteAsync(CreateSavedUserSql);
                await connection.ExecuteAsync("PRAGMA user_version = 99");
            }

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            var error = await Record.ExceptionAsync(fixture.Database.InitializeAsync);

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            error.ShouldBeOfType<InvalidOperationException>();
            await using var reopened = await fixture.Database.OpenAsync();
            (await reopened.ExecuteScalarAsync<string>("SELECT name FROM users WHERE id = 'saved'")).ShouldBe("Saved");
            (await reopened.ExecuteScalarAsync<int>("PRAGMA user_version")).ShouldBe(99);
        }
    }

    public sealed class OpenAsync
    {
        [Fact]
        public async Task FreshConnection_EnablesForeignKeysAsync()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            using var fixture = TemporaryDatabase.Create();
            await fixture.Database.InitializeAsync();

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            await using var connection = await fixture.Database.OpenAsync();
            var foreignKeys = await connection.ExecuteScalarAsync<int>("PRAGMA foreign_keys");

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            foreignKeys.ShouldBe(1);
        }
    }

    public sealed class Backup
    {
        [Fact]
        public async Task CommittedWalState_IsCopiedToValidDatabaseAsync()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            using var fixture = TemporaryDatabase.Create();
            await fixture.Database.InitializeAsync();
            await using (var connection = await fixture.Database.OpenAsync())
            {
                await connection.ExecuteAsync(CreateSavedUserSql);
            }
            var destination = System.IO.Path.Combine(fixture.Directory, "backup.sqlite");

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            fixture.Database.Backup(destination);

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            (await new Database(destination).CheckAsync()).IsHealthy.ShouldBeTrue();
            await using var backup = new SqliteConnection($"Data Source={destination};Mode=ReadOnly;Pooling=False");
            await backup.OpenAsync(TestContext.Current.CancellationToken);
            (await backup.ExecuteScalarAsync<string>("SELECT name FROM users WHERE id = 'saved'")).ShouldBe("Saved");
        }
    }

    public sealed class CheckAsync
    {
        [Fact]
        public async Task InitializedDatabase_ReportsHealthyAsync()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            using var fixture = TemporaryDatabase.Create();
            await fixture.Database.InitializeAsync();

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            var result = await fixture.Database.CheckAsync();

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            result.Version.ShouldBe(8);
            result.IsHealthy.ShouldBeTrue();
        }
    }

    private const string CreateSavedUserSql =
        "CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL); INSERT INTO users (id, name) VALUES ('saved', 'Saved')";

    private static async Task<int> CountUsersTablesAsync(Database database)
    {
        await using var connection = await database.OpenAsync();
        return await connection.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'users'");
    }

    private static async Task<int> CountUsersAsync(Database database)
    {
        await using var connection = await database.OpenAsync();
        return await connection.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM users");
    }

    private sealed class TemporaryDatabase : IDisposable
    {
        private TemporaryDatabase()
        {
            Directory = System.IO.Path.Combine(System.IO.Path.GetTempPath(), $"aidd-database-unit-{Guid.NewGuid():N}");
            Database = new Database(System.IO.Path.Combine(Directory, "app.sqlite"));
        }

        internal string Directory { get; }
        internal Database Database { get; }
        internal static TemporaryDatabase Create() => new();
        public void Dispose()
        {
            if (System.IO.Directory.Exists(Directory)) System.IO.Directory.Delete(Directory, true);
        }
    }
}
