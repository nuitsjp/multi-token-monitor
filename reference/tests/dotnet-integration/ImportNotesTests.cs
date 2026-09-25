using Dapper;
using Microsoft.Data.Sqlite;
using NotesSample.Application.Authentication;
using NotesSample.Domain;
using NotesSample.Features.Notes;
using NotesSample.Infrastructure.Notifications;
using Shouldly;
using Xunit;

namespace NotesSample.IntegrationTests;

public sealed class ImportNotesTests
{
    private static readonly Principal Alice = new("alice", "Alice");
    private static readonly Principal Bob = new("bob", "Bob");

    [Fact]
    public async Task ValidInput_InsertsAllNotesAndNotifiesAfterCommitAsync()
    {
        // -------------------------------------------------------------
        // Arrange
        // -------------------------------------------------------------
        using var fixture = await CreateDatabaseAsync();
        var changes = new ChangeNotifications(_ => { });
        var import = new ImportNotes(fixture.Database, changes, new PreviewNotes().Application);
        var notifications = 0;
        var countWhenNotified = -1;
        using var subscription = changes.Subscribe("alice", () =>
        {
            notifications++;
            using var connection = new SqliteConnection($"Data Source={fixture.Path};Mode=ReadOnly;Pooling=False");
            connection.Open();
            countWhenNotified = connection.ExecuteScalar<int>("SELECT COUNT(*) FROM notes WHERE owner_id = 'alice'");
        });

        // -------------------------------------------------------------
        // Act
        // -------------------------------------------------------------
        var result = await import.Presentation.ExecuteAsync(Alice, new BulkInput(" first \nsecond", "body"));

        // -------------------------------------------------------------
        // Assert
        // -------------------------------------------------------------
        result.Count.ShouldBe(2);
        (await ReadTitlesAsync(fixture, "alice")).ShouldBe(new[] { "first", "second" });
        notifications.ShouldBe(1);
        countWhenNotified.ShouldBe(2);
    }

    [Fact]
    public async Task LaterTitleConflict_RollsBackEarlierInsertAsync()
    {
        // -------------------------------------------------------------
        // Arrange
        // -------------------------------------------------------------
        using var fixture = await CreateDatabaseAsync();
        await InsertNoteAsync(fixture, "alice", "second");
        var changes = new ChangeNotifications(_ => { });
        var import = new ImportNotes(fixture.Database, changes, new PreviewNotes().Application);
        var notifications = 0;
        using var subscription = changes.Subscribe("alice", () => notifications++);

        // -------------------------------------------------------------
        // Act
        // -------------------------------------------------------------
        var error = await Record.ExceptionAsync(() =>
            import.Presentation.ExecuteAsync(Alice, new BulkInput("first\nsecond", "body")));

        // -------------------------------------------------------------
        // Assert
        // -------------------------------------------------------------
        error.ShouldBeOfType<AppFaultException>().Code.ShouldBe("TITLE_EXISTS");
        (await ReadTitlesAsync(fixture, "alice")).ShouldBe(new[] { "second" });
        notifications.ShouldBe(0);
    }

    [Fact]
    public async Task DuplicateInput_RejectsBeforeInsertingAsync()
    {
        // -------------------------------------------------------------
        // Arrange
        // -------------------------------------------------------------
        using var fixture = await CreateDatabaseAsync();
        var import = new ImportNotes(fixture.Database, new ChangeNotifications(_ => { }), new PreviewNotes().Application);

        // -------------------------------------------------------------
        // Act
        // -------------------------------------------------------------
        var error = await Record.ExceptionAsync(() =>
            import.Presentation.ExecuteAsync(Alice, new BulkInput("same\n same ", "body")));

        // -------------------------------------------------------------
        // Assert
        // -------------------------------------------------------------
        error.ShouldBeOfType<AppFaultException>().Code.ShouldBe("VALIDATION");
        (await ReadTitlesAsync(fixture, "alice")).ShouldBeEmpty();
    }

    [Fact]
    public async Task SameTitleForDifferentOwners_RemainsIsolatedAsync()
    {
        // -------------------------------------------------------------
        // Arrange
        // -------------------------------------------------------------
        using var fixture = await CreateDatabaseAsync();
        var import = new ImportNotes(fixture.Database, new ChangeNotifications(_ => { }), new PreviewNotes().Application);

        // -------------------------------------------------------------
        // Act
        // -------------------------------------------------------------
        await import.Presentation.ExecuteAsync(Alice, new BulkInput("shared", "alice body"));
        await import.Presentation.ExecuteAsync(Bob, new BulkInput("shared", "bob body"));

        // -------------------------------------------------------------
        // Assert
        // -------------------------------------------------------------
        (await ReadTitlesAsync(fixture, "alice")).ShouldBe(new[] { "shared" });
        (await ReadTitlesAsync(fixture, "bob")).ShouldBe(new[] { "shared" });
    }

    private static async Task<TestSqliteDatabase> CreateDatabaseAsync()
    {
        var fixture = await TestSqliteDatabase.CreateAsync();
        await using var connection = await fixture.Database.OpenAsync();
        await connection.ExecuteAsync("INSERT INTO users (id, name) VALUES ('alice', 'Alice'), ('bob', 'Bob')");
        return fixture;
    }

    private static async Task InsertNoteAsync(TestSqliteDatabase fixture, string ownerId, string title)
    {
        await using var connection = await fixture.Database.OpenAsync();
        await connection.ExecuteAsync("""
            INSERT INTO notes (id, owner_id, title, body, version, updated_at)
            VALUES (@id, @ownerId, @title, 'existing', 1, '2026-01-01T00:00:00Z')
            """, new { id = Guid.NewGuid().ToString("D"), ownerId, title });
    }

    private static async Task<string[]> ReadTitlesAsync(TestSqliteDatabase fixture, string ownerId)
    {
        await using var connection = await fixture.Database.OpenAsync();
        return (await connection.QueryAsync<string>(
            "SELECT title FROM notes WHERE owner_id = @ownerId ORDER BY title", new { ownerId })).ToArray();
    }
}
