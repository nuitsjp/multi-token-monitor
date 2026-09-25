using Dapper;
using NotesSample.Application.Authentication;
using NotesSample.Features.Notes;
using Shouldly;
using Xunit;

namespace NotesSample.IntegrationTests;

public sealed class ListNotesTests
{
    private static readonly Principal Alice = new("alice", "Alice");
    private static readonly Principal Bob = new("bob", "Bob");
    private const string AliceOldNoteId = "00000000-0000-4000-8000-000000000001";
    private const string AliceNewNoteId = "00000000-0000-4000-8000-000000000002";
    private const string BobNoteId = "00000000-0000-4000-8000-000000000003";

    [Fact]
    public async Task MatchingOwner_ReturnsNotesInUpdatedOrderAsync()
    {
        // -------------------------------------------------------------
        // Arrange
        // -------------------------------------------------------------
        using var fixture = await CreateDatabaseWithNotesAsync();
        var listNotes = new ListNotes(fixture.Database);

        // -------------------------------------------------------------
        // Act
        // -------------------------------------------------------------
        var result = await listNotes.Presentation.ExecuteAsync(Alice);

        // -------------------------------------------------------------
        // Assert
        // -------------------------------------------------------------
        result.Select(note => note.Id).ShouldBe(new[] { AliceNewNoteId, AliceOldNoteId });
        result.Select(note => note.Title).ShouldBe(new[] { "new", "old" });
        result.All(note => note.Id != BobNoteId).ShouldBeTrue();
    }

    [Fact]
    public async Task OtherOwner_ReturnsOwnNotesOnlyAsync()
    {
        // -------------------------------------------------------------
        // Arrange
        // -------------------------------------------------------------
        using var fixture = await CreateDatabaseWithNotesAsync();
        var listNotes = new ListNotes(fixture.Database);

        // -------------------------------------------------------------
        // Act
        // -------------------------------------------------------------
        var result = await listNotes.Presentation.ExecuteAsync(Bob);

        // -------------------------------------------------------------
        // Assert
        // -------------------------------------------------------------
        result.Select(note => note.Id).ShouldBe(new[] { BobNoteId });
    }

    [Fact]
    public async Task NoNotes_ReturnsEmptyListAsync()
    {
        // -------------------------------------------------------------
        // Arrange
        // -------------------------------------------------------------
        using var fixture = await CreateDatabaseWithUsersAsync();
        var listNotes = new ListNotes(fixture.Database);

        // -------------------------------------------------------------
        // Act
        // -------------------------------------------------------------
        var result = await listNotes.Presentation.ExecuteAsync(Alice);

        // -------------------------------------------------------------
        // Assert
        // -------------------------------------------------------------
        result.ShouldBeEmpty();
    }

    private static async Task<TestSqliteDatabase> CreateDatabaseWithNotesAsync()
    {
        var fixture = await CreateDatabaseWithUsersAsync();
        await using var connection = await fixture.Database.OpenAsync();
        await connection.ExecuteAsync("""
            INSERT INTO notes (id, owner_id, title, body, version, updated_at)
            VALUES
                (@OldId, 'alice', 'old', 'old body', 1, '2026-01-01T00:00:00Z'),
                (@NewId, 'alice', 'new', 'new body', 2, '2026-01-03T00:00:00Z'),
                (@BobId, 'bob', 'bob', 'bob body', 1, '2026-01-04T00:00:00Z')
            """, new { OldId = AliceOldNoteId, NewId = AliceNewNoteId, BobId = BobNoteId });
        return fixture;
    }

    private static async Task<TestSqliteDatabase> CreateDatabaseWithUsersAsync()
    {
        var fixture = await TestSqliteDatabase.CreateAsync();
        await using var connection = await fixture.Database.OpenAsync();
        await connection.ExecuteAsync("INSERT INTO users (id, name) VALUES ('alice', 'Alice'), ('bob', 'Bob')");
        return fixture;
    }
}
