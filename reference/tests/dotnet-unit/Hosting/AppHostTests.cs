using Microsoft.AspNetCore.OpenApi;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.OpenApi;
using NotesSample.Hosting;
using NotesSample.Infrastructure.Configuration;
using Shouldly;
using Xunit;

namespace NotesSample.UnitTests.Hosting;

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
            document.Paths.Keys.ShouldContain("/api/notes/save");
            document.Paths.Keys.ShouldContain("/api/notes/remove");
            document.Paths.Keys.ShouldContain("/api/notes/import");
            var input = document.Components!.Schemas!["SaveNoteRequest"];
            input.Required.ShouldNotBeNull();
            input.Required!.ShouldContain("title");
            input.Required.ShouldContain("body");
            input.Required.ShouldNotContain("id");
            input.Required.ShouldNotContain("version");
            input.Properties!["id"].Type.ShouldBe(JsonSchemaType.String);
            input.Properties["version"].Type.ShouldBe(JsonSchemaType.Integer);
            Directory.Exists(directory).ShouldBeFalse();
            app.Lifetime.ApplicationStarted.IsCancellationRequested.ShouldBeFalse();
        }
    }
}
