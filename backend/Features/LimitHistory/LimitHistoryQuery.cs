using System.Globalization;
using Dapper;
using MultiTokenMonitor.Features.Overview;
using MultiTokenMonitor.Infrastructure.Persistence;
using MultiTokenMonitor.Presentation.Http;

namespace MultiTokenMonitor.Features.LimitHistory;

internal static class LimitHistoryQuery
{
    // 製品は、Hubの登録順、Homeの利用枠と同じ契約の順（現在の枠の最小残量の昇順。報告されなくなった契約は最後）、枠グループの順に並べる。
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
                ORDER BY date
                """)).AsList();
            var windows = (await connection.QueryAsync<WindowRow>(
                """
                SELECT hub_id AS HubId, provider AS Provider, account_key AS AccountKey, label AS Label,
                       remaining_percent AS RemainingPercent
                FROM latest_limit_windows
                ORDER BY hub_id, provider, account_key, kind, limit_key
                """)).AsList();
            var contractRanks = windows.GroupBy(window => (window.HubId, window.Provider, window.AccountKey))
                .ToDictionary(contract => contract.Key, contract => contract.Min(window => window.RemainingPercent));
            var groupRanks = windows
                .Select(window => (window.HubId, window.Provider, window.AccountKey, Group: LimitEstimator.GroupOf(window.Label)))
                .Distinct()
                .Select((key, index) => (key, index))
                .ToDictionary(item => item.key, item => item.index);
            var hubIndexes = hubs.Select((hub, index) => (hub.HubId, index)).ToDictionary(item => item.HubId, item => item.index);
            var names = hubs.ToDictionary(hub => hub.HubId, hub => hub.Name);

            var products = records
                .GroupBy(record => (record.HubId, record.Provider, record.AccountKey, record.LimitGroup))
                .Select(product => (
                    product.Key,
                    Plan: product.Last().Plan,
                    Single: records.Where(record => (record.HubId, record.Provider, record.AccountKey) ==
                            (product.Key.HubId, product.Key.Provider, product.Key.AccountKey))
                        .Select(record => record.LimitGroup).Distinct().Count() == 1))
                .OrderBy(product => hubIndexes[product.Key.HubId])
                .ThenBy(product => contractRanks.GetValueOrDefault(
                    (product.Key.HubId, product.Key.Provider, product.Key.AccountKey), double.PositiveInfinity))
                .ThenBy(product => product.Key.Provider, StringComparer.Ordinal)
                .ThenBy(product => product.Key.AccountKey, StringComparer.Ordinal)
                .ThenBy(product => groupRanks.GetValueOrDefault(product.Key, int.MaxValue))
                .ThenBy(product => product.Key.LimitGroup, StringComparer.Ordinal)
                .Select(product => new LimitHistoryProductOutput(
                    KeyOf(product.Key.HubId, product.Key.Provider, product.Key.AccountKey, product.Key.LimitGroup),
                    product.Key.HubId,
                    names[product.Key.HubId],
                    product.Key.Provider,
                    product.Plan,
                    product.Single ? null : product.Key.LimitGroup))
                .ToList();

            return new LimitHistoryOutput(
                DateTime.Today.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                products,
                records.Select(record => new LimitHistoryDayOutput(
                    KeyOf(record.HubId, record.Provider, record.AccountKey, record.LimitGroup),
                    record.Date,
                    record.MonthlyLimitUsd,
                    record.PriceUsd)).ToList());
        });

    private static string KeyOf(string hubId, string provider, string accountKey, string group) =>
        string.Join('/', hubId, provider, accountKey, group);

    private sealed record RecordRow(
        string HubId,
        string Provider,
        string AccountKey,
        string LimitGroup,
        string Date,
        string? Plan,
        double MonthlyLimitUsd,
        double? PriceUsd);

    private sealed record WindowRow(string HubId, string Provider, string AccountKey, string? Label, double RemainingPercent);
}
