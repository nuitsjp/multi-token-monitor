using Dapper;
using NotesSample.Application.Authentication;
using NotesSample.Domain;
using NotesSample.Features.Notes;
using Shouldly;
using Xunit;

namespace NotesSample.IntegrationTests;

public sealed class GetNoteTests
{
    private static readonly Principal Alice = new("alice", "Alice");
    private static readonly Principal Bob = new("bob", "Bob");
    private const string NoteId = "00000000-0000-4000-8000-000000000001";
    private const string MissingNoteId = "00000000-0000-4000-8000-000000000099";

    [Fact]
    public async Task MatchingOwner_ReturnsNoteAsync()
    {
        // -------------------------------------------------------------
        // Arrange
        // -------------------------------------------------------------
        using var fixture = await CreateDatabaseWithNoteAsync();
        var getNote = new GetNote(fixture.Database);

        // -------------------------------------------------------------
        // Act
        // -------------------------------------------------------------
        var result = await getNote.Presentation.ExecuteAsync(Alice, NoteId);

        // -------------------------------------------------------------
        // Assert
        // -------------------------------------------------------------
        result.Id.ShouldBe(NoteId);
        result.Title.ShouldBe("target");
        result.Body.ShouldBe("body");
        result.Version.ShouldBe(1);
        result.UpdatedAt.ShouldBe("2026-01-01T00:00:00Z");
    }

    [Fact]
    public async Task OtherOwner_ReturnsNotFoundAsync()
    {
        // -------------------------------------------------------------
        // Arrange
        // -------------------------------------------------------------
        using var fixture = await CreateDatabaseWithNoteAsync();
        var getNote = new GetNote(fixture.Database);

        // -------------------------------------------------------------
        // Act
        // -------------------------------------------------------------
        var error = await Record.ExceptionAsync(() => getNote.Presentation.ExecuteAsync(Bob, NoteId));

        // -------------------------------------------------------------
        // Assert
        // -------------------------------------------------------------
        error.ShouldBeOfType<AppFaultException>().Code.ShouldBe("NOT_FOUND");
    }

    [Fact]
    public async Task MissingNote_ReturnsNotFoundAsync()
    {
        // -------------------------------------------------------------
        // Arrange
        // -------------------------------------------------------------
        using var fixture = await CreateDatabaseWithNoteAsync();
        var getNote = new GetNote(fixture.Database);

        // -------------------------------------------------------------
        // Act
        // -------------------------------------------------------------
        var error = await Record.ExceptionAsync(() => getNote.Presentation.ExecuteAsync(Alice, MissingNoteId));

        // -------------------------------------------------------------
        // Assert
        // -------------------------------------------------------------
        error.ShouldBeOfType<AppFaultException>().Code.ShouldBe("NOT_FOUND");
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
}
