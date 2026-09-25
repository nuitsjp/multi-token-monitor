namespace NotesSample.Infrastructure.Configuration;

internal static class WebHostBuilderExtensions
{
    internal static WebApplicationBuilder CreateWebApplicationBuilder(this AppConfig config)
    {
        // 配布先でも静的ファイルを実行ファイルの配置場所から解決する。
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions
        {
            ContentRootPath = AppContext.BaseDirectory,
            WebRootPath = config.WebRootPath,
        });
        builder.WebHost.ConfigureKestrel(options =>
        {
            options.Limits.MaxRequestBodySize = 1024 * 1024;
            options.Listen(config.BindAddress, config.Port);
        });
        builder.WebHost.UseShutdownTimeout(TimeSpan.FromSeconds(10));
        return builder;
    }
}
