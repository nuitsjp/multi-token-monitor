using System.Text.Json;

namespace MultiTokenMonitor.Infrastructure.Configuration;

internal sealed record HubConnection(string Id, string Name, Uri Origin, string Token);

internal static class HubConfigFile
{
    private static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        RespectNullableAnnotations = true,
        RespectRequiredConstructorParameters = true,
    };

    // 例外メッセージにURLと認証トークンを含めない。
    internal static IReadOnlyList<HubConnection> Read(string? path)
    {
        if (path is null) throw new InvalidOperationException("HUB_CONFIG_PATHにHub接続設定ファイルを指定してください。");

        ConfigDocument document;
        try
        {
            document = JsonSerializer.Deserialize<ConfigDocument>(File.ReadAllText(path), Options)
                ?? throw new JsonException();
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            throw new InvalidOperationException("Hub接続設定ファイルを読み込めません。");
        }
        catch (JsonException)
        {
            throw new InvalidOperationException("Hub接続設定ファイルの形式が不正です。");
        }

        if (document.Hubs.Count == 0 || document.Hubs.Any(hub =>
                string.IsNullOrWhiteSpace(hub.Id) || string.IsNullOrWhiteSpace(hub.Name) ||
                string.IsNullOrWhiteSpace(hub.Token) || hub.Token.Trim().Any(char.IsControl)))
        {
            throw new InvalidOperationException("Hub接続設定ファイルの形式が不正です。");
        }

        if (document.Hubs.Select(hub => hub.Id.Trim()).Distinct(StringComparer.Ordinal).Count() != document.Hubs.Count)
        {
            throw new InvalidOperationException("Hub接続設定ファイルのHub IDが重複しています。");
        }

        return document.Hubs
            .Select(hub => new HubConnection(hub.Id.Trim(), hub.Name.Trim(), ParseOrigin(hub.Url), hub.Token.Trim()))
            .ToArray();
    }

    private static Uri ParseOrigin(string value)
    {
        if (!Uri.TryCreate(value.Trim(), UriKind.Absolute, out var url) ||
            url.Scheme is not ("http" or "https") ||
            url.UserInfo.Length > 0 || url.AbsolutePath != "/" || url.Query.Length > 0 || url.Fragment.Length > 0)
        {
            throw new InvalidOperationException("Hub接続設定ファイルのURLが不正です。");
        }

        return new Uri(url.GetLeftPart(UriPartial.Authority));
    }

    private sealed record ConfigDocument(IReadOnlyList<HubEntry> Hubs);

    private sealed record HubEntry(string Id, string Name, string Url, string Token);
}
