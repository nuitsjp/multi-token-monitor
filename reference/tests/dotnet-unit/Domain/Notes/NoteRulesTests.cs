using NotesSample.Domain;
using NotesSample.Domain.Notes;
using Shouldly;
using Xunit;

namespace NotesSample.UnitTests.Domain.Notes;

public sealed class NoteRulesTests
{
    public sealed class ValidateTitle
    {
        [Fact]
        public void OneHundredUnicodeCharacters_AreAccepted()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            var hiragana = new string('あ', 100);
            var emoji = string.Concat(Enumerable.Repeat("😀", 100));

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            var hiraganaError = Record.Exception(() => NoteRules.ValidateTitle(hiragana));
            var emojiError = Record.Exception(() => NoteRules.ValidateTitle(emoji));

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            hiraganaError.ShouldBeNull();
            emojiError.ShouldBeNull();
        }

        [Fact]
        public void OneHundredAndOneUnicodeCharacters_ThrowValidationFault()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            var title = string.Concat(Enumerable.Repeat("😀", 101));

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            var error = Record.Exception(() => NoteRules.ValidateTitle(title));

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            error.ShouldBeOfType<AppFaultException>().Code.ShouldBe("VALIDATION");
        }

        [Fact]
        public void WhitespaceOnly_ThrowsValidationFault()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            var title = "  ";

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            var error = Record.Exception(() => NoteRules.ValidateTitle(title));

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            error.ShouldBeOfType<AppFaultException>().Code.ShouldBe("VALIDATION");
        }
    }

    public sealed class IsValidTitle
    {
        [Fact]
        public void OneHundredCharactersWithSurroundingWhitespace_ReturnsTrue()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            var title = $"　{new string('あ', 100)} ";

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            var result = NoteRules.IsValidTitle(title);

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            result.ShouldBeTrue();
        }

        [Fact]
        public void Null_ReturnsFalse()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            string? title = null;

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            var result = NoteRules.IsValidTitle(title);

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            result.ShouldBeFalse();
        }
    }

    public sealed class ValidateBody
    {
        [Fact]
        public void TenThousandUnicodeCharacters_AreAccepted()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            var body = string.Concat(Enumerable.Repeat("😀", 10_000));

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            var error = Record.Exception(() => NoteRules.ValidateBody(body));

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            error.ShouldBeNull();
        }

        [Fact]
        public void TenThousandAndOneUnicodeCharacters_ThrowValidationFault()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            var body = string.Concat(Enumerable.Repeat("😀", 10_001));

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            var error = Record.Exception(() => NoteRules.ValidateBody(body));

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            error.ShouldBeOfType<AppFaultException>().Code.ShouldBe("VALIDATION");
        }
    }

    public sealed class IsValidBody
    {
        [Fact]
        public void Null_ReturnsFalse()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            string? body = null;

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            var result = NoteRules.IsValidBody(body);

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            result.ShouldBeFalse();
        }
    }
}
