using Dapper;
using MultiTokenMonitor.Infrastructure.Persistence;
using MultiTokenMonitor.Presentation.Http;

namespace MultiTokenMonitor.Features.Overview;

internal static class OverviewQuery
{
    // ドメインモデルのテーブルだけを読む。受信データ（hub_states.stats_json）は読まない。
    internal static Task<OverviewOutput> ReadAsync(Database database) =>
        database.InReadTransactionAsync(async connection =>
        {
            var hubs = (await connection.QueryAsync<HubRow>(
                """
                SELECT
                    h.hub_id AS HubId,
                    h.name AS Name,
                    h.connected AS Connected,
                    s.received_at AS ReceivedAt,
                    m.updated_at AS UpdatedAt
                FROM
                    hubs h
                    LEFT JOIN hub_states s USING (hub_id)
                    LEFT JOIN hub_summaries m USING (hub_id)
                ORDER BY
                    h.name, h.hub_id
                """))
                .Select(row => new OverviewHubOutput(row.HubId, row.Name, row.Connected != 0, row.ReceivedAt, row.UpdatedAt))
                .ToList();

            var usages = (await connection.QueryAsync<UsageRow>(
                """
                SELECT
                    period AS Period,
                    hub_id AS HubId,
                    tool AS Tool,
                    model AS Model,
                    SUM(tokens) AS Tokens,
                    SUM(cost_usd) AS CostUsd
                FROM
                    latest_token_usages
                GROUP BY
                    period, hub_id, tool, model
                """)).AsList();

            // 利用枠はHubごとに返し、画面でHubを切り替えて表示する。推定上限額は、同じHub・同じ提供元の全契約をまとめて純粋関数で求める。
            var windowRows = (await connection.QueryAsync<LimitWindowRow>(
                """
                SELECT
                    w.hub_id AS HubId,
                    w.provider AS Provider,
                    w.account_key AS AccountKey,
                    a.account_label AS AccountLabel,
                    a.plan_label AS PlanLabel,
                    w.kind AS Kind,
                    w.limit_key AS LimitKey,
                    w.label AS Label,
                    w.remaining_percent AS RemainingPercent,
                    w.resets_at AS ResetsAt,
                    w.window_minutes AS WindowMinutes,
                    w.base_remaining_percent AS BaseRemainingPercent,
                    h.source_device_id AS SourceDeviceId
                FROM
                    latest_limit_windows w
                    JOIN hub_accounts h USING (hub_id, provider, account_key)
                    JOIN accounts a USING (provider, account_key)
                ORDER BY
                    w.hub_id, w.provider, w.account_key, w.kind, w.limit_key
                """)).AsList();
            var currentCosts = (await connection.QueryAsync<CostRow>(
                """
                SELECT hub_id AS HubId, tool AS Tool, device_id AS DeviceId, model AS Model, cost_usd AS CostUsd
                FROM latest_token_usages
                WHERE period = 'all_time' AND cost_usd IS NOT NULL
                """))
                .ToLookup(row => (row.HubId, row.Tool), row => new CostEntry(row.DeviceId, row.Model, row.CostUsd));
            var baselineCosts = (await connection.QueryAsync<BaselineCostRow>(
                """
                SELECT
                    hub_id AS HubId, provider AS Provider, account_key AS AccountKey, kind AS Kind, limit_key AS LimitKey,
                    device_id AS DeviceId, model AS Model, cost_usd AS CostUsd
                FROM limit_window_baseline_costs
                """))
                .ToLookup(
                    row => (row.HubId, row.Provider, new WindowKey(row.AccountKey, row.Kind, row.LimitKey)),
                    row => new CostEntry(row.DeviceId, row.Model, row.CostUsd));
            var estimates = new Dictionary<(string HubId, string Provider, WindowKey Key), EstimateResult>();
            foreach (var group in windowRows.GroupBy(row => (row.HubId, row.Provider)))
            {
                var results = LimitEstimator.Estimate(
                    group.Key.Provider,
                    group.Select(row => new LimitWindowInput(
                        new WindowKey(row.AccountKey, row.Kind, row.LimitKey),
                        row.Label, row.RemainingPercent, row.BaseRemainingPercent, row.SourceDeviceId)).ToList(),
                    currentCosts[(group.Key.HubId, group.Key.Provider)].ToList(),
                    group.Select(row => new WindowKey(row.AccountKey, row.Kind, row.LimitKey)).ToDictionary(
                        key => key,
                        key => (IReadOnlyList<CostEntry>)baselineCosts[(group.Key.HubId, group.Key.Provider, key)].ToList()));
                foreach (var (key, result) in results) estimates[(group.Key.HubId, group.Key.Provider, key)] = result;
            }

            var limitWindows = windowRows
                .Select(row =>
                {
                    var estimate = estimates[(row.HubId, row.Provider, new WindowKey(row.AccountKey, row.Kind, row.LimitKey))];
                    return new OverviewLimitWindowOutput(
                        row.HubId, row.Provider, row.AccountKey, row.AccountLabel, row.PlanLabel, row.Kind, row.LimitKey,
                        row.Label, row.RemainingPercent, row.ResetsAt, estimate.LimitUsd, estimate.Status,
                        estimate.Reason, row.WindowMinutes);
                })
                .ToList();

            var devices = (await connection.QueryAsync<DeviceRow>(
                """
                SELECT
                    hub_id AS HubId,
                    device_id AS DeviceId,
                    hostname AS Hostname,
                    os_name AS OsName,
                    updated_at AS UpdatedAt,
                    stale AS Stale
                FROM
                    devices
                ORDER BY
                    hub_id, hostname, device_id
                """))
                .Select(row => new OverviewDeviceOutput(
                    row.HubId, row.DeviceId, row.Hostname, row.OsName, row.UpdatedAt, row.Stale != 0))
                .ToList();

            return new OverviewOutput(
                hubs,
                new OverviewPeriodsOutput(
                    Period(hubs, usages, "today"),
                    Period(hubs, usages, "month"),
                    Period(hubs, usages, "all_time")),
                limitWindows,
                devices);
        });

    private static OverviewPeriodOutput Period(
        IReadOnlyList<OverviewHubOutput> hubs,
        IReadOnlyList<UsageRow> usages,
        string period)
    {
        var rows = usages.Where(row => row.Period == period).ToList();
        return new OverviewPeriodOutput(
            new UsageOutput(rows.Sum(row => row.Tokens), SumCost(rows)),
            hubs.Select(hub =>
                {
                    var hubRows = rows.Where(row => row.HubId == hub.HubId).ToList();
                    return new HubUsageOutput(hub.HubId, hubRows.Sum(row => row.Tokens), SumCost(hubRows));
                })
                .ToList(),
            rows.GroupBy(row => (row.Tool, row.Model))
                .Select(group => new ModelUsageOutput(
                    group.Key.Tool, group.Key.Model, group.Sum(row => row.Tokens), SumCost(group)))
                .OrderByDescending(row => row.Tokens)
                .ToList());
    }

    // 推定コストの無い実績は合計に含めない。1件も無ければ null。
    private static double? SumCost(IEnumerable<UsageRow> rows)
    {
        var costs = rows.Where(row => row.CostUsd is not null).Select(row => row.CostUsd!.Value).ToList();
        return costs.Count == 0 ? null : costs.Sum();
    }

    // SUMの列は宣言型を持たず、行が0件だと型を推定できないため、コンストラクターではなくプロパティで受ける。
    private sealed class UsageRow
    {
        public string Period { get; set; } = "";
        public string HubId { get; set; } = "";
        public string Tool { get; set; } = "";
        public string Model { get; set; } = "";
        public long Tokens { get; set; }
        public double? CostUsd { get; set; }
    }

    private sealed record LimitWindowRow(
        string HubId,
        string Provider,
        string AccountKey,
        string? AccountLabel,
        string? PlanLabel,
        string Kind,
        string LimitKey,
        string? Label,
        double RemainingPercent,
        string? ResetsAt,
        double? WindowMinutes,
        double BaseRemainingPercent,
        string? SourceDeviceId);

    private sealed record CostRow(string HubId, string Tool, string DeviceId, string Model, double CostUsd);

    private sealed record BaselineCostRow(
        string HubId,
        string Provider,
        string AccountKey,
        string Kind,
        string LimitKey,
        string DeviceId,
        string Model,
        double CostUsd);

    private sealed record HubRow(string HubId, string Name, long Connected, string? ReceivedAt, string? UpdatedAt);

    private sealed record DeviceRow(
        string HubId,
        string DeviceId,
        string Hostname,
        string? OsName,
        string UpdatedAt,
        long Stale);
}
