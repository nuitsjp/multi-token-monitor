using NotesSample.Infrastructure.Persistence;
using Shouldly;
using Xunit;

namespace NotesSample.UnitTests.Infrastructure.Persistence;

public sealed class DatabaseCommandsTests
{
    public sealed class RunAsync
    {
        [Fact]
        public async Task CheckHealthyDatabase_ReturnsSuccessAsync()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            var directory = Path.Combine(Path.GetTempPath(), $"aidd-db-command-{Guid.NewGuid():N}");
            var path = Path.Combine(directory, "app.sqlite");
            await new Database(path).InitializeAsync();
            try
            {
                // -------------------------------------------------------------
                // Act
                // -------------------------------------------------------------
                var exitCode = await DatabaseCommands.RunAsync(["db:check", path]);

                // -------------------------------------------------------------
                // Assert
                // -------------------------------------------------------------
                exitCode.ShouldBe(0);
            }
            finally
            {
                Directory.Delete(directory, true);
            }
        }

        [Fact]
        public async Task UnsupportedCommand_ThrowsUsageErrorAsync()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            string[] args = ["unknown"];

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            var error = await Record.ExceptionAsync(() => DatabaseCommands.RunAsync(args));

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            error.ShouldBeOfType<InvalidOperationException>().Message.ShouldContain("db:check");
        }
    }
}
