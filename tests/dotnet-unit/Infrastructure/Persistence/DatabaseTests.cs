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
        (await CountTablesAsync(second.Database)).ShouldBe(0);
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
        public async Task NewFile_UsesSchemaVersionZeroAndWalAsync()
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
            (await connection.ExecuteScalarAsync<int>("PRAGMA user_version")).ShouldBe(0);
            (await connection.ExecuteScalarAsync<string>("PRAGMA journal_mode")).ShouldBe("wal");
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
            result.Version.ShouldBe(0);
            result.IsHealthy.ShouldBeTrue();
        }
    }

    private const string CreateSavedUserSql =
        "CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL); INSERT INTO users (id, name) VALUES ('saved', 'Saved')";

    private static async Task<int> CountTablesAsync(Database database)
    {
        await using var connection = await database.OpenAsync();
        return await connection.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table'");
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
