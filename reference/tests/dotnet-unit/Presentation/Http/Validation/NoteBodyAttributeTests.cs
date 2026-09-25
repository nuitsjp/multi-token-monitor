using NotesSample.Presentation.Http.Validation;
using Shouldly;
using Xunit;

namespace NotesSample.UnitTests.Presentation.Http.Validation;

public sealed class NoteBodyAttributeTests
{
    public sealed class IsValid
    {
        [Fact]
        public void TenThousandEmojiCharacters_ReturnsTrue()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            var value = string.Concat(Enumerable.Repeat("😀", 10_000));
            var attribute = new NoteBodyAttribute();

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
        public void TenThousandAndOneEmojiCharacters_ReturnsFalse()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            var value = string.Concat(Enumerable.Repeat("😀", 10_001));
            var attribute = new NoteBodyAttribute();

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
        public void EmptyString_ReturnsTrue()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            var value = string.Empty;
            var attribute = new NoteBodyAttribute();

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
        public void Null_ReturnsFalse()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            string? value = null;
            var attribute = new NoteBodyAttribute();

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
            var attribute = new NoteBodyAttribute();

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
