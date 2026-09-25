using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using System.Text.Json;

namespace NotesSample.Hosting;

internal static class AppLifecycle
{
    internal static async Task StartAndWaitAsync(this WebApplication app)
    {
        await app.StartAsync();
        // 開発・E2Eツールが動的に割り当てられた待受URLを取得できるよう通知する。
        var addresses = app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>();
        var url = addresses?.Addresses.SingleOrDefault()
            ?? throw new InvalidOperationException("起動URLを取得できませんでした。");
        Console.WriteLine("AIDD_READY " + JsonSerializer.Serialize(new { url }));
        Console.Out.Flush();

        if (Environment.GetEnvironmentVariable("AIDD_CONTROL_STDIN") == "1")
            _ = ReadControlInputAsync(app.Lifetime);

        await app.WaitForShutdownAsync();
    }

    private static Task ReadControlInputAsync(IHostApplicationLifetime lifetime) => Task.Run(async () =>
    {
        while (await Console.In.ReadLineAsync() is { } line)
        {
            if (line == "shutdown")
            {
                lifetime.StopApplication();
                return;
            }
        }
    });
}
