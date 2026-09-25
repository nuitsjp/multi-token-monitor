using NotesSample.Application.Authentication;
using NotesSample.Domain;
using NotesSample.Features.Notes;
using Shouldly;
using Xunit;

namespace NotesSample.IntegrationTests;

public sealed class PreviewNotesTests
{
    private static readonly Principal Alice = new("alice", "Alice");

    [Fact]
    public async Task NormalizesTitlesAndPreservesBodyAsync()
    {
        // -------------------------------------------------------------
        // Arrange
        // -------------------------------------------------------------
        var previewNotes = new PreviewNotes();
        var input = new BulkInput("  first  \r\nsecond\n \r\n third ", "body");

        // -------------------------------------------------------------
        // Act
        // -------------------------------------------------------------
        var result = await previewNotes.Presentation.ExecuteAsync(Alice, input);

        // -------------------------------------------------------------
        // Assert
        // -------------------------------------------------------------
        result.Titles.ShouldBe(new[] { "first", "second", "third" });
        result.Body.ShouldBe("body");
    }

    [Fact]
    public async Task DuplicateTitlesAfterNormalization_ThrowsValidationAsync()
    {
        // -------------------------------------------------------------
        // Arrange
        // -------------------------------------------------------------
        var previewNotes = new PreviewNotes();
        var input = new BulkInput("alpha\n alpha \r\nbeta", "body");

        // -------------------------------------------------------------
        // Act
        // -------------------------------------------------------------
        var error = await Record.ExceptionAsync(() => previewNotes.Presentation.ExecuteAsync(Alice, input));

        // -------------------------------------------------------------
        // Assert
        // -------------------------------------------------------------
        error.ShouldBeOfType<AppFaultException>().Code.ShouldBe("VALIDATION");
    }

    [Fact]
    public async Task InvalidBody_ThrowsValidationAsync()
    {
        // -------------------------------------------------------------
        // Arrange
        // -------------------------------------------------------------
        var previewNotes = new PreviewNotes();
        var input = new BulkInput("title", new string('x', 10_001));

        // -------------------------------------------------------------
        // Act
        // -------------------------------------------------------------
        var error = await Record.ExceptionAsync(() => previewNotes.Presentation.ExecuteAsync(Alice, input));

        // -------------------------------------------------------------
        // Assert
        // -------------------------------------------------------------
        error.ShouldBeOfType<AppFaultException>().Code.ShouldBe("VALIDATION");
    }

    [Fact]
    public async Task EmptyTitles_ThrowsValidationAsync()
    {
        // -------------------------------------------------------------
        // Arrange
        // -------------------------------------------------------------
        var previewNotes = new PreviewNotes();
        var input = new BulkInput("  \r\n \n", "body");

        // -------------------------------------------------------------
        // Act
        // -------------------------------------------------------------
        var error = await Record.ExceptionAsync(() => previewNotes.Presentation.ExecuteAsync(Alice, input));

        // -------------------------------------------------------------
        // Assert
        // -------------------------------------------------------------
        error.ShouldBeOfType<AppFaultException>().Code.ShouldBe("VALIDATION");
    }

    [Fact]
    public async Task OverOneHundredTitles_ThrowsValidationAsync()
    {
        // -------------------------------------------------------------
        // Arrange
        // -------------------------------------------------------------
        var previewNotes = new PreviewNotes();
        var input = new BulkInput(string.Join('\n', Enumerable.Range(1, 101).Select(index => $"title-{index}")), "body");

        // -------------------------------------------------------------
        // Act
        // -------------------------------------------------------------
        var error = await Record.ExceptionAsync(() => previewNotes.Presentation.ExecuteAsync(Alice, input));

        // -------------------------------------------------------------
        // Assert
        // -------------------------------------------------------------
        error.ShouldBeOfType<AppFaultException>().Message.ShouldBe("タイトルは1〜100件で入力してください。");
    }

    [Fact]
    public async Task OverlongTitle_ThrowsValidationAsync()
    {
        // -------------------------------------------------------------
        // Arrange
        // -------------------------------------------------------------
        var previewNotes = new PreviewNotes();
        var input = new BulkInput(new string('x', 101), "body");

        // -------------------------------------------------------------
        // Act
        // -------------------------------------------------------------
        var error = await Record.ExceptionAsync(() => previewNotes.Presentation.ExecuteAsync(Alice, input));

        // -------------------------------------------------------------
        // Assert
        // -------------------------------------------------------------
        error.ShouldBeOfType<AppFaultException>().Code.ShouldBe("VALIDATION");
    }
}
