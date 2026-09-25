using NotesSample.Domain;
using Shouldly;
using Xunit;

namespace NotesSample.UnitTests.Domain;

public sealed class AppFaultExceptionTests
{
    public sealed class Constructor
    {
        [Fact]
        public void AssignsCodeAndMessage()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            const string code = "SAMPLE";
            const string message = "sample message";

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            var exception = new AppFaultException(code, message);

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            exception.Code.ShouldBe(code);
            exception.Message.ShouldBe(message);
        }
    }

    public sealed class Validation
    {
        [Fact]
        public void DefaultMessage_UsesValidationCode()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            const string expectedMessage = "入力の形式を確認してください。";

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            var exception = AppFaultException.Validation();

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            exception.Code.ShouldBe("VALIDATION");
            exception.Message.ShouldBe(expectedMessage);
        }

        [Fact]
        public void CustomMessage_IsPreserved()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            const string message = "custom validation message";

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            var exception = AppFaultException.Validation(message);

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            exception.Code.ShouldBe("VALIDATION");
            exception.Message.ShouldBe(message);
        }
    }
}
