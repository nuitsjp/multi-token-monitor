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
                    CAST(SUM(tokens) AS INTEGER) AS Tokens,
                    SUM(cost_usd) AS CostUsd
                FROM
                    latest_token_usages
                GROUP BY
                    period, hub_id, tool, model
                """)).AsList();

            // 利用枠はHubごとに返し、画面でHubを切り替えて表示する。
            var limitWindows = (await LimitWindowEstimates.ReadAsync(connection, hubId: null))
                .Select(row => new OverviewLimitWindowOutput(
                    row.HubId, row.Provider, row.AccountKey, row.AccountLabel, row.PlanLabel, row.Kind, row.LimitKey,
                    row.Label, row.RemainingPercent, row.ResetsAt, row.Estimate.LimitUsd, row.Estimate.Status,
                    row.Estimate.Reason, row.WindowMinutes))
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

            // 全Hubの日別の集計を日付ごとに合算する。コストは、どのHubも値がない日だけNULLにする。
            var activity = (await connection.QueryAsync<ActivityRow>(
                """
                SELECT
                    date AS Date,
                    CAST(SUM(tokens) AS INTEGER) AS Tokens,
                    CAST(CASE WHEN COUNT(cost_usd) = 0 THEN NULL ELSE SUM(cost_usd) END AS REAL) AS CostUsd
                FROM
                    daily_token_usages
                GROUP BY
                    date
                ORDER BY
                    date
                """))
                .Select(row => new ActivityDayOutput(row.Date, row.Tokens, row.CostUsd))
                .ToList();

            return new OverviewOutput(
                hubs,
                new OverviewPeriodsOutput(
                    Period(hubs, usages, "today"),
                    Period(hubs, usages, "month"),
                    Period(hubs, usages, "all_time")),
                limitWindows,
                devices,
                new OverviewActivityOutput(activity));
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

    // 行がないとき集計式の型が分からず、コンストラクターの引数と対応づけられないため、プロパティで受ける。
    private sealed class ActivityRow
    {
        public string Date { get; init; } = "";
        public long Tokens { get; init; }
        public double? CostUsd { get; init; }
    }

    private sealed record HubRow(string HubId, string Name, long Connected, string? ReceivedAt, string? UpdatedAt);

    private sealed record DeviceRow(
        string HubId,
        string DeviceId,
        string Hostname,
        string? OsName,
        string UpdatedAt,
        long Stale);
}
