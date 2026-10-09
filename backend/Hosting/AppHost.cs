using MultiTokenMonitor.Features.HubRegistration;
using MultiTokenMonitor.Features.HubSync;
using MultiTokenMonitor.Infrastructure.Configuration;
using MultiTokenMonitor.Infrastructure.Notifications;
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
            // DBを準備し、登録済みのHubの受信状態を整えてから受信を開始する。
            var database = new Database(config.DatabasePath);
            await database.InitializeAsync();
            await HubRegistry.ResetReceiveStatusAsync(database);
            builder.Services.AddSingleton(database);
            builder.Services.AddSingleton<ChangeNotifications>();
            builder.Services.AddSingleton(services => new HubReceivers(
                database,
                services.GetRequiredService<ChangeNotifications>(),
                services.GetRequiredService<ILogger<HubReceivers>>(),
                config.RetryTimeScale));
            builder.Services.AddHostedService(services => services.GetRequiredService<HubReceivers>());
        }

        var contractSources = builder.AddHttpPresentation(exportOpenApi: !initializeDatabase);
        var app = builder.Build();
        app.UseHttpPresentation(config, contractSources);
        return app;
    }
}
