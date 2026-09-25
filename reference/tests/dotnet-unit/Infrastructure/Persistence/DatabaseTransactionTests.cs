using Dapper;
using System.Data;
using NotesSample.Infrastructure.Persistence;
using Shouldly;
using Xunit;

namespace NotesSample.UnitTests.Infrastructure.Persistence;

public sealed class DatabaseTransactionTests
{
    public sealed class CommitAsync
    {
        [Fact]
        public async Task PersistsChangesAndIgnoresRepeatedCommitAsync()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            using var fixture = TemporaryDatabase.Create();
            await fixture.Database.InitializeAsync();
            await using var transaction = await fixture.Database.BeginTransactionAsync();
            await transaction.Connection.ExecuteAsync("INSERT INTO users (id, name) VALUES ('committed', 'Committed')");

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            await transaction.CommitAsync();
            await transaction.CommitAsync();

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            await using var connection = await fixture.Database.OpenAsync();
            (await connection.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM users WHERE id = 'committed'")).ShouldBe(1);
        }
    }

    public sealed class RollbackAsync
    {
        [Fact]
        public async Task DiscardsChangesAndIgnoresRepeatedRollbackAsync()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            using var fixture = TemporaryDatabase.Create();
            await fixture.Database.InitializeAsync();
            await using var transaction = await fixture.Database.BeginTransactionAsync();
            await transaction.Connection.ExecuteAsync("INSERT INTO users (id, name) VALUES ('rolled-back', 'Rolled back')");

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            await transaction.RollbackAsync();
            await transaction.RollbackAsync();

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            await using var connection = await fixture.Database.OpenAsync();
            (await connection.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM users WHERE id = 'rolled-back'")).ShouldBe(0);
        }
    }

    public sealed class DisposeAsync
    {
        [Fact]
        public async Task RollsBackPendingChangesAndClosesConnectionAsync()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            using var fixture = TemporaryDatabase.Create();
            await fixture.Database.InitializeAsync();
            var transaction = await fixture.Database.BeginTransactionAsync();
            await transaction.Connection.ExecuteAsync("INSERT INTO users (id, name) VALUES ('disposed', 'Disposed')");

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            await transaction.DisposeAsync();

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            transaction.Connection.State.ShouldBe(ConnectionState.Closed);
            await using var connection = await fixture.Database.OpenAsync();
            (await connection.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM users WHERE id = 'disposed'")).ShouldBe(0);
        }
    }

    private sealed class TemporaryDatabase : IDisposable
    {
        private TemporaryDatabase()
        {
            Directory = System.IO.Path.Combine(System.IO.Path.GetTempPath(), $"aidd-database-transaction-unit-{Guid.NewGuid():N}");
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
