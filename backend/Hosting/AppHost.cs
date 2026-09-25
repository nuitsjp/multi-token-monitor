using MultiTokenMonitor.Infrastructure.Configuration;
using MultiTokenMonitor.Infrastructure.Persistence;
using MultiTokenMonitor.Presentation.Http;

namespace MultiTokenMonitor.Hosting;

internal static class AppHost
{
    internal static async Task<int> RunAsync(string[] args)
    {
        try
        {
            if (args is ["openapi", var output])
            {
                await using var schemaApp = await BuildAppAsync(AppConfig.FromValues(_ => null), initializeDatabase: false);
                await schemaApp.ExportOpenApiAsync(output);
                return 0;
            }

            if (args.Length > 0)
                return await DatabaseCommands.RunAsync(args);

            await using var app = await BuildAppAsync(AppConfig.FromEnvironment());
            await app.StartAndWaitAsync();
            return 0;
        }
        catch (Exception error)
        {
            Console.Error.WriteLine(error.Message);
            return 1;
        }
    }

    internal static async Task<WebApplication> BuildAppAsync(AppConfig config, bool initializeDatabase = true)
    {
        if (initializeDatabase) await new Database(config.DatabasePath).InitializeAsync();

        var builder = config.CreateWebApplicationBuilder();
        var contractSources = builder.AddHttpPresentation(exportOpenApi: !initializeDatabase);
        var app = builder.Build();
        app.UseHttpPresentation(config, contractSources);
        return app;
    }
}
