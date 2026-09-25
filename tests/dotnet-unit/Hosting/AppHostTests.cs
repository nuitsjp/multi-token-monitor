using Microsoft.AspNetCore.OpenApi;
using Microsoft.Extensions.DependencyInjection;
using MultiTokenMonitor.Hosting;
using MultiTokenMonitor.Infrastructure.Configuration;
using Shouldly;
using Xunit;

namespace MultiTokenMonitor.UnitTests.Hosting;

public sealed class AppHostTests
{
    public sealed class BuildAppAsync
    {
        [Fact]
        public async Task ContractMode_RegistersEndpointsWithoutCreatingDatabaseOrStartingServerAsync()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            var directory = Path.Combine(Path.GetTempPath(), $"aidd-openapi-{Guid.NewGuid():N}");
            var config = AppConfig.FromValues(key => key == "DB_PATH" ? Path.Combine(directory, "app.sqlite") : null);

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            await using var app = await AppHost.BuildAppAsync(config, initializeDatabase: false);
            var provider = app.Services.GetRequiredKeyedService<IOpenApiDocumentProvider>("v1");
            var document = await provider.GetOpenApiDocumentAsync(TestContext.Current.CancellationToken);

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            document.Paths.Keys.ShouldContain("/health");
            Directory.Exists(directory).ShouldBeFalse();
            app.Lifetime.ApplicationStarted.IsCancellationRequested.ShouldBeFalse();
        }
    }
}
