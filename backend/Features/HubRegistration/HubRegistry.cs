using Dapper;
using MultiTokenMonitor.Infrastructure.Persistence;
using MultiTokenMonitor.Presentation.Http;

namespace MultiTokenMonitor.Features.HubRegistration;

internal sealed record HubConnection(string Id, string Name, Uri Origin, string Token);

// 利用者が設定画面から登録したHubの接続情報をDBで管理する。認証トークンは一覧へ返さない。
internal static class HubRegistry
{
    // 条件とメッセージは、接続するHubを管理するユースケースの共通の受け入れ条件に従う。
    internal static (Dictionary<string, string[]> Errors, Uri? Origin) Validate(string? name, string? url, string? token)
    {
        var errors = new Dictionary<string, string[]>();
        if (string.IsNullOrWhiteSpace(name)) errors["name"] = ["Enter a name."];
        var origin = ParseOrigin(url);
        if (origin is null) errors["url"] = ["Enter a URL like http(s)://host[:port]."];
        if (string.IsNullOrEmpty(token?.Trim()) || token.Trim().Any(char.IsControl)) errors["token"] = ["Enter a valid token."];
        return (errors, origin);
    }

    // パス・クエリ・フラグメント・ユーザー情報を含まない http(s)://ホスト[:ポート] だけを受け付ける。
    private static Uri? ParseOrigin(string? value) =>
        Uri.TryCreate(value?.Trim(), UriKind.Absolute, out var url) &&
        url.Scheme is "http" or "https" && url.Host.Length > 0 &&
        url.UserInfo.Length == 0 && url.AbsolutePath == "/" && url.Query.Length == 0 && url.Fragment.Length == 0
            ? new Uri(url.GetLeftPart(UriPartial.Authority))
            : null;

    // IDを採番してHubを登録する。呼び出し側が入力を検証済みであること。
    internal static async Task<HubConnection> AddAsync(Database database, string name, Uri origin, string token)
    {
        var hub = new HubConnection(Guid.NewGuid().ToString(), name.Trim(), origin, token.Trim());
        await RegisterAsync(database, hub);
        return hub;
    }

    // 受信中として登録する。登録順は行の登録順（rowid）で表す。
    internal static Task RegisterAsync(Database database, HubConnection hub) =>
        database.InTransactionAsync(connection => connection.ExecuteAsync(
            "INSERT INTO hubs (hub_id, name, url, token, connected) VALUES (@Id, @Name, @Url, @Token, 1)",
            new { hub.Id, hub.Name, Url = hub.Origin.GetLeftPart(UriPartial.Authority), hub.Token }));

    // 接続情報を持つHubだけを受信中に、持たないHub（移行前から存在するHub）を再接続中にする。
    internal static Task ResetReceiveStatusAsync(Database database) =>
        database.InTransactionAsync(connection => connection.ExecuteAsync(
            "UPDATE hubs SET connected = (url <> '' AND token <> '')"));

    internal static async Task<IReadOnlyList<HubConnection>> LoadConnectionsAsync(Database database) =>
        (await database.InReadTransactionAsync(connection => connection.QueryAsync<ConnectionRow>(
            """
            SELECT hub_id AS Id, name AS Name, url AS Url, token AS Token
            FROM hubs WHERE url <> '' AND token <> '' ORDER BY rowid
            """)))
        .Select(row => new HubConnection(row.Id, row.Name, new Uri(row.Url), row.Token))
        .ToList();

    // 認証トークンを含めない。受信状態は、再接続中のHub、最初の全体状態を受ける前のHub、受信済みのHubに分ける。
    internal static async Task<IReadOnlyList<HubRegistrationOutput>> ListAsync(Database database) =>
        (await database.InReadTransactionAsync(connection => connection.QueryAsync<ListRow>(
            """
            SELECT h.hub_id AS HubId, h.name AS Name, h.url AS Url, h.connected AS Connected,
                   s.hub_id IS NOT NULL AS Received
            FROM hubs h LEFT JOIN hub_states s USING (hub_id)
            ORDER BY h.rowid
            """)))
        .Select(row => new HubRegistrationOutput(
            row.HubId, row.Name, row.Url,
            row.Connected == 0 ? "reconnecting" : row.Received != 0 ? "connected" : "notReceived"))
        .ToList();

    private sealed record ConnectionRow(string Id, string Name, string Url, string Token);
    private sealed record ListRow(string HubId, string Name, string Url, long Connected, long Received);
}
