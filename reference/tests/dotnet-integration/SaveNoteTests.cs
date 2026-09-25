using Dapper;
using Microsoft.AspNetCore.Http;
using Microsoft.Data.Sqlite;
using NotesSample.Application.Authentication;
using NotesSample.Features.Notes;
using NotesSample.Infrastructure.Notifications;
using Shouldly;
using Xunit;

namespace NotesSample.IntegrationTests;

public sealed class SaveNoteTests
{
    private static readonly Principal Alice = new("alice", "Alice");
    private static readonly Principal Bob = new("bob", "Bob");
    private const string NoteId = "00000000-0000-4000-8000-000000000011";

    [Fact]
    public async Task NewNote_TrimsTitlePersistsAndNotifiesAfterCommitAsync()
    {
        // -------------------------------------------------------------
        // Arrange
        // -------------------------------------------------------------
        using var fixture = await CreateDatabaseAsync();
        var changes = new ChangeNotifications(_ => { });
        var saveNote = new SaveNote(fixture.Database, changes);
        var notifications = 0;
        var persistedWhenNotified = false;
        using var subscription = changes.Subscribe("alice", () =>
        {
            notifications++;
            using var connection = new SqliteConnection($"Data Source={fixture.Path};Mode=ReadOnly;Pooling=False");
            connection.Open();
            persistedWhenNotified = connection.ExecuteScalar<int>("SELECT COUNT(*) FROM notes WHERE title = 'new'") == 1;
        });

        // -------------------------------------------------------------
        // Act
        // -------------------------------------------------------------
        var result = await saveNote.Presentation.HandleAsync(Alice, new SaveNoteRequest(null, null, "  new  ", "body"));

        // -------------------------------------------------------------
        // Assert
        // -------------------------------------------------------------
        ((IStatusCodeHttpResult)result).StatusCode.ShouldBe(StatusCodes.Status200OK);
        var output = ((IValueHttpResult)result).Value.ShouldBeOfType<SaveNoteResponse>();
        output.Title.ShouldBe("new");
        output.Version.ShouldBe(1);
        (await ReadNoteAsync(fixture, output.Id)).ShouldBe(new NoteRow("alice", "new", "body", 1));
        notifications.ShouldBe(1);
        persistedWhenNotified.ShouldBeTrue();
    }

    [Fact]
    public async Task MatchingVersion_UpdatesNoteAndIncrementsVersionAsync()
    {
        // -------------------------------------------------------------
        // Arrange
        // -------------------------------------------------------------
        using var fixture = await CreateDatabaseAsync();
        await InsertNoteAsync(fixture);
        var saveNote = new SaveNote(fixture.Database, new ChangeNotifications(_ => { }));

        // -------------------------------------------------------------
        // Act
        // -------------------------------------------------------------
        var result = await saveNote.Presentation.HandleAsync(Alice, new SaveNoteRequest(NoteId, 1, "updated", "next"));

        // -------------------------------------------------------------
        // Assert
        // -------------------------------------------------------------
        ((IStatusCodeHttpResult)result).StatusCode.ShouldBe(StatusCodes.Status200OK);
        var output = ((IValueHttpResult)result).Value.ShouldBeOfType<SaveNoteResponse>();
        output.Version.ShouldBe(2);
        (await ReadNoteAsync(fixture, NoteId)).ShouldBe(new NoteRow("alice", "updated", "next", 2));
    }

    [Fact]
    public async Task StaleVersion_ReturnsConflictWithoutChangingNoteAsync()
    {
        // -------------------------------------------------------------
        // Arrange
        // -------------------------------------------------------------
        using var fixture = await CreateDatabaseAsync();
        await InsertNoteAsync(fixture);
        var changes = new ChangeNotifications(_ => { });
        var saveNote = new SaveNote(fixture.Database, changes);
        var notifications = 0;
        using var subscription = changes.Subscribe("alice", () => notifications++);

        // -------------------------------------------------------------
        // Act
        // -------------------------------------------------------------
        var result = await saveNote.Presentation.HandleAsync(Alice, new SaveNoteRequest(NoteId, 2, "changed", "next"));

        // -------------------------------------------------------------
        // Assert
        // -------------------------------------------------------------
        ((IStatusCodeHttpResult)result).StatusCode.ShouldBe(StatusCodes.Status409Conflict);
        (await ReadNoteAsync(fixture, NoteId)).ShouldBe(new NoteRow("alice", "original", "body", 1));
        notifications.ShouldBe(0);
    }

    [Fact]
    public async Task OtherOwner_ReturnsNotFoundWithoutChangingNoteAsync()
    {
        // -------------------------------------------------------------
        // Arrange
        // -------------------------------------------------------------
        using var fixture = await CreateDatabaseAsync();
        await InsertNoteAsync(fixture);
        var saveNote = new SaveNote(fixture.Database, new ChangeNotifications(_ => { }));

        // -------------------------------------------------------------
        // Act
        // -------------------------------------------------------------
        var result = await saveNote.Presentation.HandleAsync(Bob, new SaveNoteRequest(NoteId, 1, "changed", "next"));

        // -------------------------------------------------------------
        // Assert
        // -------------------------------------------------------------
        ((IStatusCodeHttpResult)result).StatusCode.ShouldBe(StatusCodes.Status404NotFound);
        (await ReadNoteAsync(fixture, NoteId)).ShouldBe(new NoteRow("alice", "original", "body", 1));
    }

    [Fact]
    public async Task MissingNote_ReturnsNotFoundAsync()
    {
        // -------------------------------------------------------------
        // Arrange
        // -------------------------------------------------------------
        using var fixture = await CreateDatabaseAsync();
        var saveNote = new SaveNote(fixture.Database, new ChangeNotifications(_ => { }));

        // -------------------------------------------------------------
        // Act
        // -------------------------------------------------------------
        var result = await saveNote.Presentation.HandleAsync(Alice, new SaveNoteRequest(NoteId, 1, "missing", "body"));

        // -------------------------------------------------------------
        // Assert
        // -------------------------------------------------------------
        ((IStatusCodeHttpResult)result).StatusCode.ShouldBe(StatusCodes.Status404NotFound);
        (await CountNotesAsync(fixture)).ShouldBe(0);
    }

    [Fact]
    public async Task ExistingTitle_ReturnsTranslatedConflictAsync()
    {
        // -------------------------------------------------------------
        // Arrange
        // -------------------------------------------------------------
        using var fixture = await CreateDatabaseAsync();
        await InsertNoteAsync(fixture);
        var saveNote = new SaveNote(fixture.Database, new ChangeNotifications(_ => { }));

        // -------------------------------------------------------------
        // Act
        // -------------------------------------------------------------
        var error = await Record.ExceptionAsync(() =>
            saveNote.Presentation.HandleAsync(Alice, new SaveNoteRequest(null, null, "original", "another")));

        // -------------------------------------------------------------
        // Assert
        // -------------------------------------------------------------
        error.ShouldBeOfType<NotesSample.Domain.AppFaultException>().Code.ShouldBe("TITLE_EXISTS");
        (await CountNotesAsync(fixture)).ShouldBe(1);
    }

    [Fact]
    public async Task NotificationFailure_DoesNotUndoCommittedSaveAsync()
    {
        // -------------------------------------------------------------
        // Arrange
        // -------------------------------------------------------------
        using var fixture = await CreateDatabaseAsync();
        var errors = new List<Exception>();
        var changes = new ChangeNotifications(errors.Add);
        using var subscription = changes.Subscribe("alice", () => throw new InvalidOperationException("subscriber failed"));
        var saveNote = new SaveNote(fixture.Database, changes);

        // -------------------------------------------------------------
        // Act
        // -------------------------------------------------------------
        var result = await saveNote.Presentation.HandleAsync(Alice, new SaveNoteRequest(null, null, "saved", "body"));

        // -------------------------------------------------------------
        // Assert
        // -------------------------------------------------------------
        ((IStatusCodeHttpResult)result).StatusCode.ShouldBe(StatusCodes.Status200OK);
        (await CountNotesAsync(fixture)).ShouldBe(1);
        errors.Single().Message.ShouldBe("subscriber failed");
    }

    [Fact]
    public async Task ConcurrentEdits_OnlyOneVersionWinsAsync()
    {
        // -------------------------------------------------------------
        // Arrange
        // -------------------------------------------------------------
        using var fixture = await CreateDatabaseAsync();
        await InsertNoteAsync(fixture);
        var saveNote = new SaveNote(fixture.Database, new ChangeNotifications(_ => { }));
        using var start = new ManualResetEventSlim(false);
        var attempts = new[] { "first", "second" }.Select(body => Task.Run(async () =>
        {
            start.Wait();
            return await saveNote.Presentation.HandleAsync(Alice, new SaveNoteRequest(NoteId, 1, "original", body));
        })).ToArray();

        // -------------------------------------------------------------
        // Act
        // -------------------------------------------------------------
        start.Set();
        var results = await Task.WhenAll(attempts);

        // -------------------------------------------------------------
        // Assert
        // -------------------------------------------------------------
        results.Select(result => ((IStatusCodeHttpResult)result).StatusCode).Order().ToArray()
            .ShouldBe(new int?[] { StatusCodes.Status200OK, StatusCodes.Status409Conflict });
        (await ReadNoteAsync(fixture, NoteId))!.Version.ShouldBe(2);
    }

    private static async Task<TestSqliteDatabase> CreateDatabaseAsync()
    {
        var fixture = await TestSqliteDatabase.CreateAsync();
        await using var connection = await fixture.Database.OpenAsync();
        await connection.ExecuteAsync("INSERT INTO users (id, name) VALUES ('alice', 'Alice'), ('bob', 'Bob')");
        return fixture;
    }

    private static async Task InsertNoteAsync(TestSqliteDatabase fixture)
    {
        await using var connection = await fixture.Database.OpenAsync();
        await connection.ExecuteAsync("""
            INSERT INTO notes (id, owner_id, title, body, version, updated_at)
            VALUES (@Id, 'alice', 'original', 'body', 1, '2026-01-01T00:00:00Z')
            """, new { Id = NoteId });
    }

    private static async Task<NoteRow?> ReadNoteAsync(
        TestSqliteDatabase fixture, string id)
    {
        await using var connection = await fixture.Database.OpenAsync();
        return await connection.QuerySingleOrDefaultAsync<NoteRow>("""
            SELECT owner_id AS Owner, title AS Title, body AS Body, version AS Version
            FROM notes WHERE id = @id
            """, new { id });
    }

    private static async Task<int> CountNotesAsync(TestSqliteDatabase fixture)
    {
        await using var connection = await fixture.Database.OpenAsync();
        return await connection.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM notes");
    }

    private sealed record NoteRow(string Owner, string Title, string Body, long Version);
}
