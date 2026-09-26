using System.Globalization;
using System.Text.Json.Nodes;
using Dapper;
using Microsoft.Data.Sqlite;
using MultiTokenMonitor.Infrastructure.Configuration;
using MultiTokenMonitor.Infrastructure.Persistence;

namespace MultiTokenMonitor.Features.HubSync;

internal static class HubStateStore
{
    // 同じIDは表示名を更新して受信状態を受信中に戻し、設定から外れたHubは削除しない。
    internal static Task RegisterHubsAsync(Database database, IReadOnlyList<HubConnection> hubs) =>
        database.InTransactionAsync(connection => connection.ExecuteAsync(
            """
            INSERT INTO hubs (hub_id, name, connected)
            VALUES (@Id, @Name, 1)
            ON CONFLICT (hub_id) DO UPDATE SET name = excluded.name, connected = 1
            """,
            hubs.Select(hub => new { hub.Id, hub.Name })));

    internal static Task MarkReconnectingAsync(Database database, string hubId) =>
        database.InTransactionAsync(connection => connection.ExecuteAsync(
            "UPDATE hubs SET connected = 0 WHERE hub_id = @hubId", new { hubId }));

    // 受信データと、そこから作り直したドメインモデルを1トランザクションで保存する。
    internal static Task SaveAsync(Database database, string hubId, HubNotification notification, string receivedAt) =>
        database.InTransactionAsync(async connection =>
        {
            var statsJson = notification.Stats;
            if (notification.Kind == HubNotificationKind.Freshness)
            {
                var current = await connection.QuerySingleOrDefaultAsync<string>(
                    "SELECT stats_json FROM hub_states WHERE hub_id = @hubId", new { hubId })
                    ?? throw new InvalidOperationException("freshnessを適用する保存済みの状態がありません。");
                statsJson = HubNotification.ApplyFreshness(JsonNode.Parse(current)!.AsObject(), notification.Stats);
            }

            var stats = HubNotification.ReadStats(statsJson);
            await connection.ExecuteAsync(
                """
                INSERT INTO hub_states (hub_id, stats_json, received_at)
                VALUES (@hubId, @statsJson, @receivedAt)
                ON CONFLICT (hub_id) DO UPDATE SET
                    stats_json = excluded.stats_json,
                    received_at = excluded.received_at
                """,
                new { hubId, statsJson = statsJson.ToJsonString(), receivedAt });
            // 保存できた接続は受信中。再接続後の最初の保存で受信中に戻る。
            await connection.ExecuteAsync("UPDATE hubs SET connected = 1 WHERE hub_id = @hubId", new { hubId });
            await ReplaceDomainAsync(connection, hubId, stats, receivedAt);
        });

    private static async Task ReplaceDomainAsync(SqliteConnection connection, string hubId, HubStats stats, string receivedAt)
    {
        var previousMeters = (await connection.QueryAsync<LimitWindowRow>(
                """
                SELECT
                    hub_id AS HubId,
                    provider AS Provider,
                    account_key AS AccountKey,
                    kind AS Kind,
                    limit_key AS LimitKey,
                    label AS Label,
                    remaining_percent AS RemainingPercent,
                    used_percent AS UsedPercent,
                    resets_at AS ResetsAt,
                    meter_changed_at AS MeterChangedAt
                FROM
                    latest_limit_windows
                WHERE
                    hub_id = @hubId
                """,
                new { hubId }))
            .ToDictionary(row => (row.Provider, row.AccountKey, row.Kind, row.LimitKey));

        await connection.ExecuteAsync(
            """
            DELETE FROM latest_limit_windows WHERE hub_id = @hubId;
            DELETE FROM latest_token_usages WHERE hub_id = @hubId;
            DELETE FROM devices WHERE hub_id = @hubId;
            DELETE FROM hub_summaries WHERE hub_id = @hubId;
            """,
            new { hubId });

        await connection.ExecuteAsync(
            "INSERT INTO hub_summaries (hub_id, updated_at, active_days) VALUES (@hubId, @updatedAt, @activeDays)",
            new { hubId, updatedAt = stats.UpdatedAt, activeDays = stats.HistoryPreview?.Summary.ActiveDays });

        await connection.ExecuteAsync(
            """
            INSERT INTO devices (hub_id, device_id, hostname, os_name, updated_at, stale)
            VALUES (@HubId, @DeviceId, @Hostname, @OsName, @UpdatedAt, @Stale)
            """,
            stats.Devices.Select(device => new
            {
                HubId = hubId,
                device.DeviceId,
                device.Hostname,
                device.OsName,
                device.UpdatedAt,
                Stale = device.Stale ? 1 : 0,
            }));

        await connection.ExecuteAsync(
            """
            INSERT INTO latest_token_usages (hub_id, device_id, period, tool, model, tokens, cost_usd)
            VALUES (@HubId, @DeviceId, @Period, @Tool, @Model, @Tokens, @CostUsd)
            """,
            stats.Devices.SelectMany(device => TokenUsages(hubId, device, DateTimeOffset.Parse(receivedAt, CultureInfo.InvariantCulture))));

        var windows = stats.Limits.Providers
            .SelectMany(provider => provider.Windows
                .Where(window => window.ShowMeter && window.RemainingPercent is not null)
                .Select(window => (Provider: provider, Window: window)))
            .ToArray();

        await connection.ExecuteAsync(
            """
            INSERT INTO accounts (provider, account_key, account_label, plan_label)
            VALUES (@Provider, @AccountKey, @AccountLabel, @PlanLabel)
            ON CONFLICT (provider, account_key) DO UPDATE SET
                account_label = excluded.account_label,
                plan_label = excluded.plan_label
            """,
            windows.Select(item => item.Provider).Distinct().Select(provider => new
            {
                provider.Provider,
                provider.AccountKey,
                provider.AccountLabel,
                provider.PlanLabel,
            }));

        await connection.ExecuteAsync(
            """
            INSERT INTO latest_limit_windows (
                hub_id, provider, account_key, kind, limit_key, label,
                remaining_percent, used_percent, resets_at, meter_changed_at)
            VALUES (
                @HubId, @Provider, @AccountKey, @Kind, @LimitKey, @Label,
                @RemainingPercent, @UsedPercent, @ResetsAt, @MeterChangedAt)
            """,
            windows.Select(item =>
            {
                var (provider, window) = item;
                var limitKey = (string.IsNullOrEmpty(window.LimitId) ? window.Label : window.LimitId) ?? "";
                var remaining = window.RemainingPercent!.Value;
                // 残量・使用量が前回の行と同じなら、最後に変わった時刻を引き継ぐ。
                var meterChangedAt =
                    previousMeters.TryGetValue((provider.Provider, provider.AccountKey, window.Kind, limitKey), out var previous) &&
                    previous.RemainingPercent == remaining && previous.UsedPercent == window.UsedPercent
                        ? previous.MeterChangedAt
                        : receivedAt;
                return new LimitWindowRow(
                    hubId, provider.Provider, provider.AccountKey, window.Kind, limitKey, window.Label,
                    remaining, window.UsedPercent, window.ResetsAt, meterChangedAt);
            }));
    }

    private static IEnumerable<object> TokenUsages(string hubId, HubDevice device, DateTimeOffset receivedAt)
    {
        // 期限切れの today・month は、Hubが自身の集計から除くのと同じ規則で行を作らない。
        var updatedAt = DateTimeOffset.Parse(device.UpdatedAt, CultureInfo.InvariantCulture).UtcDateTime;
        var now = receivedAt.UtcDateTime;
        var todayExpired = device.PeriodWindows?.Today is { } today ? today.EndsAt <= receivedAt : updatedAt.Date != now.Date;
        var monthExpired = device.PeriodWindows?.Month is { } month
            ? month.EndsAt <= receivedAt
            : (updatedAt.Year, updatedAt.Month) != (now.Year, now.Month);
        (string Period, HubPeriod Usage, bool Expired)[] periods =
        [
            ("today", device.Periods.Today, todayExpired),
            ("month", device.Periods.Month, monthExpired),
            ("all_time", device.Periods.AllTime, false),
        ];
        foreach (var (period, usage, _) in periods.Where(item => !item.Expired))
        {
            foreach (var (tool, models) in usage.ClientModels)
            {
                foreach (var (model, tokens) in models)
                {
                    double? cost = usage.ClientModelCosts.TryGetValue(tool, out var costs) && costs.TryGetValue(model, out var value)
                        ? value
                        : null;
                    yield return new
                    {
                        HubId = hubId,
                        device.DeviceId,
                        Period = period,
                        Tool = tool,
                        Model = model,
                        Tokens = tokens,
                        CostUsd = cost,
                    };
                }
            }
        }
    }

    private sealed record LimitWindowRow(
        string HubId,
        string Provider,
        string AccountKey,
        string Kind,
        string LimitKey,
        string? Label,
        double RemainingPercent,
        double? UsedPercent,
        string? ResetsAt,
        string MeterChangedAt);
}
