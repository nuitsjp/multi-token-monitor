using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using MultiTokenMonitor.Presentation.Http;
using Shouldly;
using Xunit;

namespace MultiTokenMonitor.UnitTests.Presentation.Http;

public sealed class ProblemResponsesTests
{
    public sealed class WriteAsync
    {
        [Fact]
        public async Task NotFound_WritesStatusTitleAndDetailJsonAsync()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            const string detail = "対象が見つかりません。";
            using var body = new MemoryStream();
            var context = new DefaultHttpContext();
            context.Response.Body = body;
            using var services = new ServiceCollection().AddLogging().AddProblemDetails().BuildServiceProvider();
            context.RequestServices = services;

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            await ProblemResponses.WriteAsync(context, StatusCodes.Status404NotFound, detail);
            body.Position = 0;
            using var document = await JsonDocument.ParseAsync(
                body, cancellationToken: TestContext.Current.CancellationToken);

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            context.Response.StatusCode.ShouldBe(StatusCodes.Status404NotFound);
            document.RootElement.GetProperty("status").GetInt32().ShouldBe(StatusCodes.Status404NotFound);
            document.RootElement.GetProperty("title").GetString().ShouldBe("見つかりません。");
            document.RootElement.GetProperty("detail").GetString().ShouldBe(detail);
        }
    }
}
