using Microsoft.AspNetCore.OpenApi;
using Microsoft.OpenApi;
using NotesSample.Features.Notes;
using NotesSample.Infrastructure.Authentication;
using NotesSample.Infrastructure.Configuration;
using NotesSample.Infrastructure.Notifications;
using NotesSample.Infrastructure.Persistence;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace NotesSample.Presentation.Http;

internal static class HttpPresentationRegistration
{
    internal static List<EndpointDataSource>? AddHttpPresentation(this WebApplicationBuilder builder, bool exportOpenApi)
    {
        builder.Services.AddProblemDetails();
        builder.Services.AddValidation();
        builder.Services.AddOpenApi(options =>
        {
            // 入れ子の契約型を区別し、null不可の指定を生成契約にも反映する。
            options.CreateSchemaReferenceId = type => type.Type.IsNested
                ? type.Type.DeclaringType!.Name + type.Type.Name
                : OpenApiOptions.CreateDefaultSchemaReferenceId(type);
            options.AddSchemaTransformer((schema, context, _) =>
            {
                foreach (var property in context.JsonTypeInfo.Type.GetProperties())
                {
                    if (property.SetMethod?.GetParameters().LastOrDefault()?.IsDefined(
                            typeof(System.Diagnostics.CodeAnalysis.DisallowNullAttribute), true) == true
                        && schema.Properties?.TryGetValue(JsonNamingPolicy.CamelCase.ConvertName(property.Name), out var propertySchema) == true
                        && propertySchema is OpenApiSchema value)
                        value.Type &= ~JsonSchemaType.Null;
                }
                return Task.CompletedTask;
            });
        });
        builder.Services.Configure<RouteHandlerOptions>(options => options.ThrowOnBadRequest = true);
        // 未知の項目や曖昧なJSONを受け入れず、公開契約どおりにバインドする。
        builder.Services.ConfigureHttpJsonOptions(options =>
        {
            options.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
            options.SerializerOptions.PropertyNameCaseInsensitive = false;
            options.SerializerOptions.UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow;
            options.SerializerOptions.AllowDuplicateProperties = false;
            options.SerializerOptions.RespectNullableAnnotations = true;
            options.SerializerOptions.NumberHandling = JsonNumberHandling.Strict;
        });

        if (!exportOpenApi) return null;
        // DB未初期化の契約生成時にも、ビルド後に登録するエンドポイントを列挙できるようにする。
        var contractSources = new List<EndpointDataSource>();
        builder.Services.AddSingleton<EndpointDataSource>(_ => new CompositeEndpointDataSource(contractSources));
        return contractSources;
    }

    internal static void UseHttpPresentation(
        this WebApplication app,
        AppConfig config,
        Database database,
        IdentityService identity,
        ChangeNotifications notifications,
        List<EndpointDataSource>? contractSources)
    {
        app.UseHttpErrorHandling();
        app.UseApiRequestGuard(config);

        new SaveNote(database, notifications).Map(app, identity);
        ApiEndpoints.MapApplicationEndpoints(app, config, identity);
        new ListNotes(database).Map(app, identity);
        new GetNote(database).Map(app, identity);
        new RemoveNote(database, notifications).Map(app, identity);
        // 一括登録はプレビューと同じ入力準備処理を使う。
        var previewNotes = new PreviewNotes();
        previewNotes.Map(app, identity);
        new ImportNotes(database, notifications, previewNotes.Application).Map(app, identity);
        ApiEndpoints.MapEventEndpoints(app, identity, notifications, app.Lifetime.ApplicationStopping);
        app.UseDefaultFiles();
        app.UseStaticFiles();
        app.MapFallback(async context =>
        {
            // HTMLを要求する画面URLだけSPAに渡し、未知のAPIやイベントは404にする。
            if (HttpMethods.IsGet(context.Request.Method) &&
                !context.Request.Path.StartsWithSegments("/api") &&
                !context.Request.Path.StartsWithSegments("/events") &&
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
