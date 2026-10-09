using System.Text.Json;
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
            (await connection.ExecuteScalarAsync<int>("PRAGMA user_version")).ShouldBe(9);
            (await connection.ExecuteScalarAsync<string>("PRAGMA journal_mode")).ShouldBe("wal");
        }

        [Fact]
        public async Task NewFile_CreatesOnlyTheRetainedTablesAndColumnsAsync()
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
            await AssertCurrentSchemaAsync(connection);
        }

        [Fact]
        public async Task VersionEightFile_RemovesEstimatesAndKeepsAllOtherDataAsync()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            using var fixture = TemporaryDatabase.Create();
            await CreateVersionEightFileAsync(fixture);
            string[] savedData;
            await using (var connection = await fixture.Database.OpenAsync())
            {
                savedData = await SnapshotRetainedDataAsync(connection);
                foreach (var table in RemovedTables)
                    (await connection.ExecuteScalarAsync<int>($"SELECT COUNT(*) FROM {table}")).ShouldBe(1);
            }

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            await fixture.Database.InitializeAsync();

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            await using var migrated = await fixture.Database.OpenAsync();
            (await migrated.ExecuteScalarAsync<int>("PRAGMA user_version")).ShouldBe(9);
            (await SnapshotRetainedDataAsync(migrated)).ShouldBe(savedData);
            await AssertCurrentSchemaAsync(migrated);
            (await migrated.QueryAsync<object>("PRAGMA foreign_key_check")).ShouldBeEmpty();
        }

        [Fact]
        public async Task VersionEightFile_WhenColumnRemovalFails_RollsBackSchemaAndDataAsync()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            using var fixture = TemporaryDatabase.Create();
            await CreateVersionEightFileAsync(fixture);
            string[] savedData;
            await using (var connection = await fixture.Database.OpenAsync())
            {
                savedData = await SnapshotRetainedDataAsync(connection);
                await connection.ExecuteAsync("CREATE VIEW blocked_removal AS SELECT base_remaining_percent FROM latest_limit_windows");
            }

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            var error = await Record.ExceptionAsync(fixture.Database.InitializeAsync);

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            await using var migrated = await fixture.Database.OpenAsync();
            error.ShouldBeOfType<SqliteException>().Message.ShouldContain("base_remaining_percent");
            (await migrated.ExecuteScalarAsync<int>("PRAGMA user_version")).ShouldBe(8);
            (await SnapshotRetainedDataAsync(migrated)).ShouldBe(savedData);
            foreach (var table in RemovedTables)
                (await migrated.ExecuteScalarAsync<int>($"SELECT COUNT(*) FROM {table}")).ShouldBe(1);
            (await migrated.QuerySingleAsync<(string ReceivedAt, double Remaining)>(
                "SELECT base_received_at, base_remaining_percent FROM latest_limit_windows WHERE account_key = 'account'"))
                .ShouldBe(("2026-10-01T00:00:00Z", 90d));
            (await migrated.ExecuteScalarAsync<string>("SELECT source_device_id FROM hub_accounts WHERE account_key = 'account'"))
                .ShouldBe("device");
        }

        [Fact]
        public async Task CurrentSchema_ReinitializationKeepsDataAndDoesNotRecreateRemovedTablesAsync()
        {
            using var fixture = TemporaryDatabase.Create();
            await CreateVersionEightFileAsync(fixture);
            await fixture.Database.InitializeAsync();
            string[] savedData;
            await using (var connection = await fixture.Database.OpenAsync())
                savedData = await SnapshotRetainedDataAsync(connection);

            await fixture.Database.InitializeAsync();

            await using var reopened = await fixture.Database.OpenAsync();
            (await reopened.ExecuteScalarAsync<int>("PRAGMA user_version")).ShouldBe(9);
            (await SnapshotRetainedDataAsync(reopened)).ShouldBe(savedData);
            await AssertCurrentSchemaAsync(reopened);
        }

        [Theory]
        [InlineData(-1)]
        [InlineData(1)]
        [InlineData(2)]
        [InlineData(3)]
        [InlineData(4)]
        [InlineData(5)]
        [InlineData(6)]
        [InlineData(7)]
        [InlineData(10)]
        [InlineData(99)]
        public async Task UnknownSchemaVersion_IsRejectedWithoutDeletingDataAsync(int version)
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            using var fixture = TemporaryDatabase.Create();
            await fixture.Database.InitializeAsync();
            await using (var connection = await fixture.Database.OpenAsync())
            {
                await connection.ExecuteAsync(CreateSavedUserSql);
                await connection.ExecuteAsync($"PRAGMA user_version = {version}");
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
            (await reopened.ExecuteScalarAsync<int>("PRAGMA user_version")).ShouldBe(version);
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
            result.Version.ShouldBe(9);
            result.IsHealthy.ShouldBeTrue();
        }
    }

    private static readonly string[] RetainedTables =
    [
        "hubs", "hub_states", "hub_summaries", "devices", "latest_token_usages", "daily_token_usages",
        "device_daily_model_usages", "accounts", "hub_accounts", "latest_limit_windows",
    ];

    private static readonly string[] RemovedTables = ["limit_window_baseline_costs", "daily_monthly_limits", "plan_prices"];

    private static async Task AssertCurrentSchemaAsync(SqliteConnection connection)
    {
        (await connection.QueryAsync<string>("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name"))
            .ShouldBe(RetainedTables.OrderBy(name => name));
        (await connection.QueryAsync<string>("SELECT name FROM pragma_table_info('hub_accounts') ORDER BY cid"))
            .ShouldBe(["hub_id", "provider", "account_key"]);
        (await connection.QueryAsync<string>("SELECT name FROM pragma_table_info('latest_limit_windows') ORDER BY cid"))
            .ShouldBe(["hub_id", "provider", "account_key", "kind", "limit_key", "label", "remaining_percent", "used_percent",
                "resets_at", "meter_changed_at", "window_minutes"]);
        (await connection.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM pragma_table_list WHERE schema = 'main' AND name NOT LIKE 'sqlite_%' AND strict = 0"))
            .ShouldBe(0);
    }

    private static async Task<string[]> SnapshotRetainedDataAsync(SqliteConnection connection)
    {
        var result = new List<string>();
        foreach (var table in RetainedTables)
        {
            var columns = (await connection.QueryAsync<string>($"SELECT name FROM pragma_table_info('{table}') ORDER BY cid"))
                .Where(name => name is not ("source_device_id" or "base_received_at" or "base_remaining_percent"));
            var rows = await connection.QueryAsync($"SELECT rowid, {string.Join(", ", columns)} FROM {table} ORDER BY rowid");
            result.Add(table + ":" + JsonSerializer.Serialize(rows.Select(row => (IDictionary<string, object>)row).ToArray()));
        }

        return result.ToArray();
    }

    private static async Task CreateVersionEightFileAsync(TemporaryDatabase fixture)
    {
        System.IO.Directory.CreateDirectory(fixture.Directory);
        await using var connection = await fixture.Database.OpenAsync();
        await connection.ExecuteAsync(VersionEightSchema);
        await connection.ExecuteAsync("""
            INSERT INTO hubs (rowid, hub_id, name, connected, url, token) VALUES
              (13, 'hub', 'Hub', 1, 'https://hub.example.com', 'saved-token'),
              (47, 'empty', 'Empty connection', 0, '', '');
            INSERT INTO hub_states VALUES ('hub', '{"sourceDeviceId":"device"}', '2026-10-09T01:00:00Z');
            INSERT INTO hub_summaries VALUES ('hub', '2026-10-09T00:59:00Z', 7);
            INSERT INTO devices VALUES ('hub', 'device', 'Device', 'Windows', '2026-10-09T00:59:00Z', 1);
            INSERT INTO latest_token_usages VALUES ('hub', 'device', 'all_time', 'codex', 'model', 100, 2.5);
            INSERT INTO daily_token_usages VALUES ('hub', '2026-10-08', 30, NULL);
            INSERT INTO device_daily_model_usages VALUES ('hub', 'device', '2026-10-08', 'model', 30, 0.75);
            INSERT INTO accounts VALUES ('codex', 'account', 'Account', 'Pro');
            INSERT INTO hub_accounts VALUES ('hub', 'codex', 'account', 'device');
            INSERT INTO latest_limit_windows VALUES
              ('hub', 'codex', 'account', 'weekly', 'weekly', 'Weekly', 65, 35,
                '2026-10-15T00:00:00Z', '2026-10-09T00:30:00Z', '2026-10-01T00:00:00Z', 90, 10080);
            INSERT INTO limit_window_baseline_costs VALUES ('hub', 'codex', 'account', 'weekly', 'weekly', 'device', 'model', 1);
            INSERT INTO plan_prices VALUES ('codex', 'Pro', 200, '2026-10-01T00:00:00Z');
            INSERT INTO daily_monthly_limits VALUES
              ('hub', 'codex', 'account', '', '2026-10-08', 'Pro', 250, 200, '2026-10-08T23:00:00Z');
            PRAGMA user_version = 8;
            """);
    }

    private const string VersionEightSchema = """
        CREATE TABLE hubs (
          hub_id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          connected INTEGER NOT NULL,
          url TEXT NOT NULL DEFAULT '',
          token TEXT NOT NULL DEFAULT ''
        ) STRICT;
        CREATE TABLE hub_states (
          hub_id TEXT PRIMARY KEY REFERENCES hubs(hub_id) ON DELETE CASCADE,
          stats_json TEXT NOT NULL,
          received_at TEXT NOT NULL
        ) STRICT;
        CREATE TABLE hub_summaries (
          hub_id TEXT PRIMARY KEY REFERENCES hubs(hub_id) ON DELETE CASCADE,
          updated_at TEXT NOT NULL,
          active_days INTEGER
        ) STRICT;
        CREATE TABLE devices (
          hub_id TEXT NOT NULL REFERENCES hubs(hub_id) ON DELETE CASCADE,
          device_id TEXT NOT NULL,
          hostname TEXT NOT NULL,
          os_name TEXT,
          updated_at TEXT NOT NULL,
          stale INTEGER NOT NULL,
          PRIMARY KEY (hub_id, device_id)
        ) STRICT;
        CREATE TABLE latest_token_usages (
          hub_id TEXT NOT NULL,
          device_id TEXT NOT NULL,
          period TEXT NOT NULL,
          tool TEXT NOT NULL,
          model TEXT NOT NULL,
          tokens INTEGER NOT NULL,
          cost_usd REAL,
          PRIMARY KEY (hub_id, device_id, period, tool, model),
          FOREIGN KEY (hub_id, device_id) REFERENCES devices(hub_id, device_id) ON DELETE CASCADE
        ) STRICT;
        CREATE TABLE daily_token_usages (
          hub_id TEXT NOT NULL REFERENCES hubs(hub_id) ON DELETE CASCADE,
          date TEXT NOT NULL,
          tokens INTEGER NOT NULL,
          cost_usd REAL,
          PRIMARY KEY (hub_id, date)
        ) STRICT;
        CREATE TABLE device_daily_model_usages (
          hub_id TEXT NOT NULL,
          device_id TEXT NOT NULL,
          date TEXT NOT NULL,
          model TEXT NOT NULL,
          tokens INTEGER NOT NULL,
          cost_usd REAL,
          PRIMARY KEY (hub_id, device_id, date, model),
          FOREIGN KEY (hub_id, device_id) REFERENCES devices(hub_id, device_id) ON DELETE CASCADE
        ) STRICT;
        CREATE TABLE accounts (
          provider TEXT NOT NULL,
          account_key TEXT NOT NULL,
          account_label TEXT,
          plan_label TEXT,
          PRIMARY KEY (provider, account_key)
        ) STRICT;
        CREATE TABLE hub_accounts (
          hub_id TEXT NOT NULL REFERENCES hubs(hub_id) ON DELETE CASCADE,
          provider TEXT NOT NULL,
          account_key TEXT NOT NULL,
          source_device_id TEXT,
          PRIMARY KEY (hub_id, provider, account_key),
          FOREIGN KEY (provider, account_key) REFERENCES accounts(provider, account_key)
        ) STRICT;
        CREATE TABLE latest_limit_windows (
          hub_id TEXT NOT NULL,
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
          window_minutes REAL,
          PRIMARY KEY (hub_id, provider, account_key, kind, limit_key),
          FOREIGN KEY (hub_id, provider, account_key) REFERENCES hub_accounts(hub_id, provider, account_key) ON DELETE CASCADE
        ) STRICT;
        CREATE TABLE limit_window_baseline_costs (
          hub_id TEXT NOT NULL,
          provider TEXT NOT NULL,
          account_key TEXT NOT NULL,
          kind TEXT NOT NULL,
          limit_key TEXT NOT NULL,
          device_id TEXT NOT NULL,
          model TEXT NOT NULL,
          cost_usd REAL NOT NULL,
          PRIMARY KEY (hub_id, provider, account_key, kind, limit_key, device_id, model),
          FOREIGN KEY (hub_id, provider, account_key, kind, limit_key) REFERENCES latest_limit_windows(hub_id, provider, account_key, kind, limit_key) ON DELETE CASCADE
        ) STRICT;
        CREATE TABLE plan_prices (
          provider TEXT NOT NULL,
          plan TEXT NOT NULL COLLATE NOCASE,
          monthly_usd REAL NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (provider, plan)
        ) STRICT;
        CREATE TABLE daily_monthly_limits (
          hub_id TEXT NOT NULL REFERENCES hubs(hub_id) ON DELETE CASCADE,
          provider TEXT NOT NULL,
          account_key TEXT NOT NULL,
          limit_group TEXT NOT NULL,
          date TEXT NOT NULL,
          plan TEXT,
          monthly_limit_usd REAL NOT NULL,
          price_usd REAL,
          recorded_at TEXT NOT NULL,
          PRIMARY KEY (hub_id, provider, account_key, limit_group, date)
        ) STRICT;
        """;

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
