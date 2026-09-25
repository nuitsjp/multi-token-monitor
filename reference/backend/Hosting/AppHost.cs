using NotesSample.Infrastructure.Authentication;
using NotesSample.Infrastructure.Configuration;
using NotesSample.Infrastructure.Notifications;
using NotesSample.Infrastructure.Persistence;
using NotesSample.Presentation.Http;

namespace NotesSample.Hosting;

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
        var database = new Database(config.DatabasePath);
        if (initializeDatabase) await database.InitializeAsync();

        var builder = config.CreateWebApplicationBuilder();
        var contractSources = builder.AddHttpPresentation(exportOpenApi: !initializeDatabase);
        var app = builder.Build();
        var notifications = new ChangeNotifications(error => app.Logger.LogWarning(error, "変更通知に失敗しました"));
        var identity = new IdentityService(database, config.AuthMode);
        app.UseHttpPresentation(config, database, identity, notifications, contractSources);
        return app;
    }
}
