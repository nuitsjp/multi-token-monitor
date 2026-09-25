using NotesSample.Presentation.Http.Validation;
using Shouldly;
using Xunit;

namespace NotesSample.UnitTests.Presentation.Http.Validation;

public sealed class NoteTitleAttributeTests
{
    public sealed class IsValid
    {
        [Fact]
        public void OneHundredEmojiCharacters_ReturnsTrue()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            var value = string.Concat(Enumerable.Repeat("😀", 100));
            var attribute = new NoteTitleAttribute();

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            var result = attribute.IsValid(value);

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            result.ShouldBeTrue();
        }

        [Fact]
        public void OneHundredAndOneEmojiCharacters_ReturnsFalse()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            var value = string.Concat(Enumerable.Repeat("😀", 101));
            var attribute = new NoteTitleAttribute();

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            var result = attribute.IsValid(value);

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            result.ShouldBeFalse();
        }

        [Fact]
        public void OneHundredCharactersWithSurroundingWhitespace_ReturnsTrue()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            var value = $" {new string('あ', 100)} ";
            var attribute = new NoteTitleAttribute();

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            var result = attribute.IsValid(value);

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            result.ShouldBeTrue();
        }

        [Fact]
        public void WhitespaceOnly_ReturnsFalse()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            var value = "  ";
            var attribute = new NoteTitleAttribute();

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            var result = attribute.IsValid(value);

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            result.ShouldBeFalse();
        }

        [Fact]
        public void Null_ReturnsFalse()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            string? value = null;
            var attribute = new NoteTitleAttribute();

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            var result = attribute.IsValid(value);

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            result.ShouldBeFalse();
        }

        [Fact]
        public void NonStringValue_ReturnsFalse()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            object value = 123;
            var attribute = new NoteTitleAttribute();

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            var result = attribute.IsValid(value);

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            result.ShouldBeFalse();
        }
    }
}
