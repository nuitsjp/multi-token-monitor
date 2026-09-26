using System.Text.Json.Serialization;
using MultiTokenMonitor.Infrastructure.Configuration;

namespace MultiTokenMonitor.Presentation.Http;

internal static class HttpPresentationRegistration
{
    internal static List<EndpointDataSource>? AddHttpPresentation(this WebApplicationBuilder builder, bool exportOpenApi)
    {
        // ループバック以外の名前を拒み、DNSリバインディング経由の閲覧を防ぐ。
        builder.Configuration["AllowedHosts"] = "localhost;127.0.0.1;[::1]";
        builder.Services.AddProblemDetails();
        // 数値を文字列でも受け付ける既定を外し、契約の数値型を number だけにする。
        builder.Services.ConfigureHttpJsonOptions(options =>
            options.SerializerOptions.NumberHandling = JsonNumberHandling.Strict);
        builder.Services.AddOpenApi();

        if (!exportOpenApi) return null;
        // DB未初期化の契約生成時にも、ビルド後に登録するエンドポイントを列挙できるようにする。
        var contractSources = new List<EndpointDataSource>();
        builder.Services.AddSingleton<EndpointDataSource>(_ => new CompositeEndpointDataSource(contractSources));
        return contractSources;
    }

    internal static void UseHttpPresentation(
        this WebApplication app,
        AppConfig config,
        List<EndpointDataSource>? contractSources)
    {
        app.UseHttpErrorHandling();

        ApiEndpoints.MapApplicationEndpoints(app);
        app.UseDefaultFiles();
        app.UseStaticFiles();
        app.MapFallback(async context =>
        {
            // HTMLを要求する画面URLだけSPAに渡し、未知のAPIは404にする。
            if (HttpMethods.IsGet(context.Request.Method) &&
                !context.Request.Path.StartsWithSegments("/api") &&
                context.Request.GetTypedHeaders().Accept?.Any(value => value.MediaType.Value == "text/html") == true)
            {
                var index = Path.Combine(config.WebRootPath, "index.html");
                if (File.Exists(index))
                {
                    context.Response.Headers.CacheControl = "no-store";
                    context.Response.ContentType = "text/html; charset=utf-8";
                    await context.Response.SendFileAsync(index, context.RequestAborted);
                    return;
                }
            }

            await ProblemResponses.WriteAsync(
                context,
                StatusCodes.Status404NotFound,
                "見つかりません。");
        });
        // 契約生成用プロバイダーに、Build後に登録したルートを渡す。
        if (contractSources is not null)
            contractSources.AddRange(((IEndpointRouteBuilder)app).DataSources);
    }
}
