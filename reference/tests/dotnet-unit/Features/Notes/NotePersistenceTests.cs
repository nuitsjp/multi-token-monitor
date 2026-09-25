using Dapper;
using Microsoft.Data.Sqlite;
using NotesSample.Domain;
using NotesSample.Features.Notes;
using NotesSample.Infrastructure.Persistence;
using Shouldly;
using Xunit;

namespace NotesSample.UnitTests.Features.Notes;

public sealed class NotePersistenceTests
{
    public sealed class ReadAsync
    {
        [Fact]
        public async Task OtherOwnersNote_ReturnsNullAsync()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            using var fixture = TemporaryDatabase.Create();
            await fixture.Database.InitializeAsync();
            await using var connection = await fixture.Database.OpenAsync();
            await connection.ExecuteAsync("INSERT INTO users (id, name) VALUES ('alice', 'Alice'), ('bob', 'Bob')");
            var saved = await NotePersistence.InsertAsync(connection, "alice", "title", "body");

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            var own = await NotePersistence.ReadAsync(connection, "alice", saved.Id);
            var other = await NotePersistence.ReadAsync(connection, "bob", saved.Id);

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            own.ShouldBe(saved);
            other.ShouldBeNull();
        }
    }

    public sealed class InsertAsync
    {
        [Fact]
        public async Task Note_IsStoredForOwnerAsync()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            using var fixture = TemporaryDatabase.Create();
            await fixture.Database.InitializeAsync();
            const string ownerId = "alice";
            await using var connection = await fixture.Database.OpenAsync();
            await connection.ExecuteAsync("INSERT INTO users (id, name) VALUES (@Id, @Name)", new { Id = ownerId, Name = "Alice" });

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            var note = await NotePersistence.InsertAsync(connection, ownerId, "title", "body");

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            Guid.TryParseExact(note.Id, "D", out _).ShouldBeTrue();
            note.Title.ShouldBe("title");
            note.Body.ShouldBe("body");
            note.Version.ShouldBe(1);
            note.UpdatedAt.ShouldNotBeNullOrWhiteSpace();
            (await connection.ExecuteScalarAsync<string>("SELECT owner_id FROM notes WHERE id = @Id", new { Id = note.Id })).ShouldBe(ownerId);
        }

        [Fact]
        public async Task SameTitleForDifferentOwners_IsAllowedAsync()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            using var fixture = TemporaryDatabase.Create();
            await fixture.Database.InitializeAsync();
            await using var connection = await fixture.Database.OpenAsync();
            await connection.ExecuteAsync("INSERT INTO users (id, name) VALUES ('alice', 'Alice'), ('bob', 'Bob')");

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            await NotePersistence.InsertAsync(connection, "alice", "shared", "alice body");
            await NotePersistence.InsertAsync(connection, "bob", "shared", "bob body");

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            (await connection.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM notes WHERE title = 'shared'")).ShouldBe(2);
            (await connection.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM notes WHERE owner_id = 'alice' AND body = 'alice body'")).ShouldBe(1);
            (await connection.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM notes WHERE owner_id = 'bob' AND body = 'bob body'")).ShouldBe(1);
        }
    }

    public sealed class TranslateError
    {
        [Fact]
        public async Task UniqueTitleViolation_ReturnsTitleExistsFaultAsync()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            using var fixture = TemporaryDatabase.Create();
            await fixture.Database.InitializeAsync();
            await using var connection = await fixture.Database.OpenAsync();
            await connection.ExecuteAsync("INSERT INTO users (id, name) VALUES ('alice', 'Alice')");
            await NotePersistence.InsertAsync(connection, "alice", "duplicate", "first");
            var error = await Record.ExceptionAsync(() => NotePersistence.InsertAsync(connection, "alice", "duplicate", "second"));

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            var translated = NotePersistence.TranslateError(error!);

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            error.ShouldBeOfType<SqliteException>().SqliteExtendedErrorCode.ShouldBe(2067);
            translated.ShouldBeOfType<AppFaultException>().Code.ShouldBe("TITLE_EXISTS");
            translated.Message.ShouldBe("同じタイトルのメモが既にあります。");
        }

        [Fact]
        public async Task OtherSqliteError_IsReturnedUnchangedAsync()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            using var fixture = TemporaryDatabase.Create();
            await fixture.Database.InitializeAsync();
            await using var connection = await fixture.Database.OpenAsync();
            var error = await Record.ExceptionAsync(() => connection.ExecuteAsync("INSERT INTO notes (id, owner_id, title, body, version, updated_at) VALUES ('id', 'missing', 'title', '', 1, 'time')"));

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            var translated = NotePersistence.TranslateError(error!);

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            error.ShouldBeOfType<SqliteException>().SqliteExtendedErrorCode.ShouldNotBe(2067);
            translated.ShouldBeSameAs(error);
        }
    }

    private sealed class TemporaryDatabase : IDisposable
    {
        private TemporaryDatabase()
        {
            Directory = System.IO.Path.Combine(System.IO.Path.GetTempPath(), $"aidd-note-persistence-unit-{Guid.NewGuid():N}");
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
