using Microsoft.AspNetCore.OpenApi;
using Microsoft.OpenApi;

namespace NotesSample.Presentation.Http;

internal static class OpenApiExporter
{
    internal static async Task ExportOpenApiAsync(this WebApplication app, string output)
    {
        var provider = app.Services.GetRequiredKeyedService<IOpenApiDocumentProvider>("v1");
        var document = await provider.GetOpenApiDocumentAsync();
        await using var stream = File.Create(output);
        await document.SerializeAsJsonAsync(stream, OpenApiSpecVersion.OpenApi3_0);
    }
}
