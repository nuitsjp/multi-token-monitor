using System.Globalization;
using Dapper;
using MultiTokenMonitor.Infrastructure.Persistence;
using MultiTokenMonitor.Presentation.Http;

namespace MultiTokenMonitor.Features.LimitHistory;

internal static class LimitHistoryQuery
{
    // 契約は、Hubの登録順、Homeの利用枠と同じ契約の順（現在の枠の最小残量の昇順。報告されなくなった契約は最後）に並べる。
    // 日次記録は枠グループごとの行を契約・日付ごとに合計する。契約の記録に現れた枠グループのうち、その日に行のないものがあれば下限値とする。
    internal static Task<LimitHistoryOutput> ReadAsync(Database database) =>
        database.InReadTransactionAsync(async connection =>
        {
            var hubs = (await connection.QueryAsync<(string HubId, string Name)>(
                "SELECT hub_id, name FROM hubs ORDER BY rowid")).AsList();
            var records = (await connection.QueryAsync<RecordRow>(
                """
                SELECT
                    hub_id AS HubId, provider AS Provider, account_key AS AccountKey, limit_group AS LimitGroup,
                    date AS Date, plan AS Plan, monthly_limit_usd AS MonthlyLimitUsd, price_usd AS PriceUsd
                FROM daily_monthly_limits
                ORDER BY date, recorded_at
                """)).AsList();
            var windows = (await connection.QueryAsync<WindowRow>(
                """
                SELECT hub_id AS HubId, provider AS Provider, account_key AS AccountKey,
                       remaining_percent AS RemainingPercent
                FROM latest_limit_windows
                """)).AsList();
            var contractRanks = windows.GroupBy(window => (window.HubId, window.Provider, window.AccountKey))
                .ToDictionary(contract => contract.Key, contract => contract.Min(window => window.RemainingPercent));
            var hubIndexes = hubs.Select((hub, index) => (hub.HubId, index)).ToDictionary(item => item.HubId, item => item.index);
            var names = hubs.ToDictionary(hub => hub.HubId, hub => hub.Name);

            var contracts = records
                .GroupBy(record => (record.HubId, record.Provider, record.AccountKey))
                .OrderBy(contract => hubIndexes[contract.Key.HubId])
                .ThenBy(contract => contractRanks.GetValueOrDefault(contract.Key, double.PositiveInfinity))
                .ThenBy(contract => contract.Key.Provider, StringComparer.Ordinal)
                .ThenBy(contract => contract.Key.AccountKey, StringComparer.Ordinal)
                .ToList();

            var days = new List<LimitHistoryDayOutput>();
            foreach (var contract in contracts)
            {
                var key = KeyOf(contract.Key.HubId, contract.Key.Provider, contract.Key.AccountKey);
                var groups = contract.Select(record => record.LimitGroup).Distinct().Count();
                // 同じ日の行は記録順に並ぶため、支払額はその日に最後に記録した行の値を使う。
                days.AddRange(contract.GroupBy(record => record.Date).Select(day => new LimitHistoryDayOutput(
                    key,
                    day.Key,
                    day.Sum(record => record.MonthlyLimitUsd),
                    day.Last().PriceUsd,
                    day.Count() < groups)));
            }

            return new LimitHistoryOutput(
                DateTime.Today.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                contracts.Select(contract => new LimitHistoryContractOutput(
                    KeyOf(contract.Key.HubId, contract.Key.Provider, contract.Key.AccountKey),
                    contract.Key.HubId,
                    names[contract.Key.HubId],
                    contract.Key.Provider,
                    contract.Last().Plan)).ToList(),
                days);
        });

    private static string KeyOf(string hubId, string provider, string accountKey) =>
        string.Join('/', hubId, provider, accountKey);

    private sealed record RecordRow(
        string HubId,
        string Provider,
        string AccountKey,
        string LimitGroup,
        string Date,
        string? Plan,
        double MonthlyLimitUsd,
        double? PriceUsd);

    private sealed record WindowRow(string HubId, string Provider, string AccountKey, double RemainingPercent);
}
