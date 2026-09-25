using NotesSample.Infrastructure.Persistence;
using Shouldly;
using Xunit;

namespace NotesSample.UnitTests.Infrastructure.Persistence;

public sealed class DatabaseCheckTests
{
    public sealed class IsHealthy
    {
        [Fact]
        public void AllResultsAreOk_ReturnsTrue()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            var check = new DatabaseCheck(1, new[] { "ok", "ok" });

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            var result = check.IsHealthy;

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            result.ShouldBeTrue();
        }

        [Fact]
        public void EmptyResults_ReturnsFalse()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            var check = new DatabaseCheck(1, Array.Empty<string>());

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            var result = check.IsHealthy;

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            result.ShouldBeFalse();
        }

        [Fact]
        public void AnyResultOtherThanOk_ReturnsFalse()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            var check = new DatabaseCheck(1, new[] { "ok", "error" });

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            var result = check.IsHealthy;

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            result.ShouldBeFalse();
        }
    }
}
