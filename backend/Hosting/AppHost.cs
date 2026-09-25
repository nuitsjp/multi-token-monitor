using MultiTokenMonitor.Features.HubSync;
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
        var builder = config.CreateWebApplicationBuilder();
        if (initializeDatabase)
        {
            // 接続設定とDBを準備し、全Hubを登録してから受信を開始する。
            var hubs = HubConfigFile.Read(config.HubConfigPath);
            var database = new Database(config.DatabasePath);
            await database.InitializeAsync();
            await HubStateStore.RegisterHubsAsync(database, hubs);
            builder.Services.AddSingleton(database);
            builder.Services.AddHostedService(services =>
                new HubReceivers(hubs, database, services.GetRequiredService<ILogger<HubReceivers>>()));
        }

        var contractSources = builder.AddHttpPresentation(exportOpenApi: !initializeDatabase);
        var app = builder.Build();
        app.UseHttpPresentation(config, contractSources);
        return app;
    }
}
