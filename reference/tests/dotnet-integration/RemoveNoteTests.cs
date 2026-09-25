using Dapper;
using Microsoft.AspNetCore.Http;
using Microsoft.Data.Sqlite;
using NotesSample.Application.Authentication;
using NotesSample.Features.Notes;
using NotesSample.Infrastructure.Notifications;
using Shouldly;
using Xunit;

namespace NotesSample.IntegrationTests;

public sealed class RemoveNoteTests
{
    private static readonly Principal Alice = new("alice", "Alice");
    private static readonly Principal Bob = new("bob", "Bob");
    private const string NoteId = "00000000-0000-4000-8000-000000000001";

    [Fact]
    public async Task MatchingVersion_DeletesNoteAndPublishesChangeAsync()
    {
        // -------------------------------------------------------------
        // Arrange
        // -------------------------------------------------------------
        using var fixture = await CreateDatabaseWithNoteAsync();
        var changes = new ChangeNotifications(_ => { });
        var removeNote = new RemoveNote(fixture.Database, changes);
        var notifications = 0;
        var remainingWhenNotified = -1;
        using var subscription = changes.Subscribe("alice", () =>
        {
            notifications++;
            using var connection = new SqliteConnection($"Data Source={fixture.Path};Mode=ReadOnly;Pooling=False");
            connection.Open();
            remainingWhenNotified = connection.ExecuteScalar<int>("SELECT COUNT(*) FROM notes WHERE id = @Id", new { Id = NoteId });
        });

        // -------------------------------------------------------------
        // Act
        // -------------------------------------------------------------
        var result = await removeNote.Presentation.ExecuteAsync(Alice, new RemoveNoteInput(NoteId, 1));

        // -------------------------------------------------------------
        // Assert
        // -------------------------------------------------------------
        ((IStatusCodeHttpResult)result).StatusCode.ShouldBe(StatusCodes.Status200OK);
        (await CountNotesAsync(fixture)).ShouldBe(0);
        notifications.ShouldBe(1);
        remainingWhenNotified.ShouldBe(0);
    }

    [Fact]
    public async Task StaleVersion_ReturnsConflictAndKeepsNoteAsync()
    {
        // -------------------------------------------------------------
        // Arrange
        // -------------------------------------------------------------
        using var fixture = await CreateDatabaseWithNoteAsync();
        var changes = new ChangeNotifications(_ => { });
        var removeNote = new RemoveNote(fixture.Database, changes);
        var notifications = 0;
        using var subscription = changes.Subscribe("alice", () => notifications++);

        // -------------------------------------------------------------
        // Act
        // -------------------------------------------------------------
        var result = await removeNote.Presentation.ExecuteAsync(Alice, new RemoveNoteInput(NoteId, 2));

        // -------------------------------------------------------------
        // Assert
        // -------------------------------------------------------------
        ((IStatusCodeHttpResult)result).StatusCode.ShouldBe(StatusCodes.Status409Conflict);
        (await CountNotesAsync(fixture)).ShouldBe(1);
        notifications.ShouldBe(0);
    }

    [Fact]
    public async Task OtherOwner_ReturnsNotFoundAndKeepsNoteAsync()
    {
        // -------------------------------------------------------------
        // Arrange
        // -------------------------------------------------------------
        using var fixture = await CreateDatabaseWithNoteAsync();
        var removeNote = new RemoveNote(fixture.Database, new ChangeNotifications(_ => { }));

        // -------------------------------------------------------------
        // Act
        // -------------------------------------------------------------
        var result = await removeNote.Presentation.ExecuteAsync(Bob, new RemoveNoteInput(NoteId, 1));

        // -------------------------------------------------------------
        // Assert
        // -------------------------------------------------------------
        ((IStatusCodeHttpResult)result).StatusCode.ShouldBe(StatusCodes.Status404NotFound);
        (await CountNotesAsync(fixture)).ShouldBe(1);
    }

    [Fact]
    public async Task MissingNote_ReturnsNotFoundAsync()
    {
        // -------------------------------------------------------------
        // Arrange
        // -------------------------------------------------------------
        using var fixture = await TestSqliteDatabase.CreateAsync();
        var removeNote = new RemoveNote(fixture.Database, new ChangeNotifications(_ => { }));

        // -------------------------------------------------------------
        // Act
        // -------------------------------------------------------------
        var result = await removeNote.Presentation.ExecuteAsync(Alice, new RemoveNoteInput(NoteId, 1));

        // -------------------------------------------------------------
        // Assert
        // -------------------------------------------------------------
        ((IStatusCodeHttpResult)result).StatusCode.ShouldBe(StatusCodes.Status404NotFound);
        (await CountNotesAsync(fixture)).ShouldBe(0);
    }

    private static async Task<TestSqliteDatabase> CreateDatabaseWithNoteAsync()
    {
        var fixture = await TestSqliteDatabase.CreateAsync();
        await using var connection = await fixture.Database.OpenAsync();
        await connection.ExecuteAsync("INSERT INTO users (id, name) VALUES ('alice', 'Alice'), ('bob', 'Bob')");
        await connection.ExecuteAsync("""
            INSERT INTO notes (id, owner_id, title, body, version, updated_at)
            VALUES (@Id, 'alice', 'target', 'body', 1, '2026-01-01T00:00:00Z')
            """, new { Id = NoteId });
        return fixture;
    }

    private static async Task<int> CountNotesAsync(TestSqliteDatabase fixture)
    {
        await using var connection = await fixture.Database.OpenAsync();
        return await connection.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM notes WHERE id = @Id", new { Id = NoteId });
    }
}
