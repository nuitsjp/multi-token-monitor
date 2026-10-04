using Dapper;
using Microsoft.Data.Sqlite;

namespace MultiTokenMonitor.Features.Overview;

/// <summary>保存済みの利用枠と、その推定上限額。閲覧クエリと、月換算上限額の日次記録が共用する。</summary>
internal sealed record EstimatedLimitWindow(
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
    EstimateResult Estimate);

internal static class LimitWindowEstimates
{
    // hubId が null なら全Hubの枠を読む。推定上限額は、同じHub・同じ提供元の全契約をまとめて純粋関数で求める。
    internal static async Task<IReadOnlyList<EstimatedLimitWindow>> ReadAsync(SqliteConnection connection, string? hubId)
    {
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
            WHERE
                @hubId IS NULL OR w.hub_id = @hubId
            ORDER BY
                w.hub_id, w.provider, w.account_key, w.kind, w.limit_key
            """,
            new { hubId })).AsList();
        var currentCosts = (await connection.QueryAsync<CostRow>(
            """
            SELECT hub_id AS HubId, tool AS Tool, device_id AS DeviceId, model AS Model, cost_usd AS CostUsd
            FROM latest_token_usages
            WHERE period = 'all_time' AND cost_usd IS NOT NULL AND (@hubId IS NULL OR hub_id = @hubId)
            """,
            new { hubId }))
            .ToLookup(row => (row.HubId, row.Tool), row => new CostEntry(row.DeviceId, row.Model, row.CostUsd));
        var baselineCosts = (await connection.QueryAsync<BaselineCostRow>(
            """
            SELECT
                hub_id AS HubId, provider AS Provider, account_key AS AccountKey, kind AS Kind, limit_key AS LimitKey,
                device_id AS DeviceId, model AS Model, cost_usd AS CostUsd
            FROM limit_window_baseline_costs
            WHERE @hubId IS NULL OR hub_id = @hubId
            """,
            new { hubId }))
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

        return windowRows
            .Select(row => new EstimatedLimitWindow(
                row.HubId, row.Provider, row.AccountKey, row.AccountLabel, row.PlanLabel, row.Kind, row.LimitKey,
                row.Label, row.RemainingPercent, row.ResetsAt, row.WindowMinutes,
                estimates[(row.HubId, row.Provider, new WindowKey(row.AccountKey, row.Kind, row.LimitKey))]))
            .ToList();
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
}
