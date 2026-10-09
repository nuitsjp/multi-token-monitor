using System.Globalization;
using Dapper;
using Microsoft.Data.Sqlite;
using MultiTokenMonitor.Infrastructure.Persistence;

namespace MultiTokenMonitor.Features.HubSync;

internal static class HubStateStore
{
    internal static Task MarkReconnectingAsync(Database database, string hubId) =>
        database.InTransactionAsync(connection => connection.ExecuteAsync(
            "UPDATE hubs SET connected = 0 WHERE hub_id = @hubId", new { hubId }));

    // 受信データと、そこから作り直したドメインモデルを1トランザクションで保存する。
    internal static Task SaveAsync(Database database, string hubId, HubNotification notification, string receivedAt,
        IReadOnlyList<DeviceHistoryDay>? history = null) =>
        database.InTransactionAsync(async connection =>
        {
            var stats = HubNotification.ReadStats(notification.Stats);
            await connection.ExecuteAsync(
                """
                INSERT INTO hub_states (hub_id, stats_json, received_at)
                VALUES (@hubId, @statsJson, @receivedAt)
                ON CONFLICT (hub_id) DO UPDATE SET
                    stats_json = excluded.stats_json,
                    received_at = excluded.received_at
                """,
                new { hubId, statsJson = notification.Stats.ToJsonString(), receivedAt });
            // 保存できた接続は受信中。再接続後の最初の保存で受信中に戻る。
            await connection.ExecuteAsync("UPDATE hubs SET connected = 1 WHERE hub_id = @hubId", new { hubId });
            await ReplaceDomainAsync(connection, hubId, stats, receivedAt);
            // 同じ履歴revisionの通知でも当日の利用は進む。取得済み端末だけを補完する。
            if (history is null && stats.DeviceHistoryRevision is not null)
            {
                var liveDays = new List<DeviceHistoryDay>();
                foreach (var device in stats.Devices)
                {
                    var hasHistory = await connection.ExecuteScalarAsync<bool>(
                        "SELECT EXISTS(SELECT 1 FROM device_daily_model_usages WHERE hub_id = @hubId AND device_id = @DeviceId)",
                        new { hubId, device.DeviceId });
                    if (!hasHistory) continue;
                    var previous = await connection.ExecuteScalarAsync<long>(
                        "SELECT COALESCE(SUM(tokens), 0) FROM device_daily_model_usages WHERE hub_id = @hubId AND device_id = @DeviceId AND date = @date",
                        new { hubId, device.DeviceId, date = device.PeriodWindows?.Today?.Key });
                    if (HubDeviceHistory.LiveDay(device, previous, DateTimeOffset.Parse(receivedAt, CultureInfo.InvariantCulture)) is { } day)
                        liveDays.Add(day);
                }
                history = liveDays;
            }
            if (history is not null)
            {
                foreach (var day in history)
                {
                    await connection.ExecuteAsync(
                        "DELETE FROM device_daily_model_usages WHERE hub_id = @hubId AND device_id = @DeviceId AND date = @Date",
                        new { hubId, day.DeviceId, day.Date });
                    await connection.ExecuteAsync(
                        """
                        INSERT INTO device_daily_model_usages (hub_id, device_id, date, model, tokens, cost_usd)
                        VALUES (@HubId, @DeviceId, @Date, @Model, @Tokens, @CostUsd)
                        """,
                        day.Models.Select(model => new { HubId = hubId, day.DeviceId, day.Date, model.Model, model.Tokens, model.CostUsd }));
                }
            }
        });

    // freshness は保存済みの状態を読まず、受信時刻とHub・端末の時刻・古さだけを更新する。
    // 利用量・利用枠と受信データ（stats全体）は次の snapshot・stats で置き換わるまで維持する。
    internal static Task SaveFreshnessAsync(Database database, string hubId, HubFreshness freshness, string receivedAt) =>
        database.InTransactionAsync(async connection =>
        {
            await connection.ExecuteAsync(
                """
                UPDATE hub_states SET received_at = @receivedAt WHERE hub_id = @hubId;
                UPDATE hub_summaries SET updated_at = @updatedAt WHERE hub_id = @hubId;
                """,
                new { hubId, receivedAt, updatedAt = freshness.UpdatedAt });
            await connection.ExecuteAsync(
                "UPDATE devices SET updated_at = @UpdatedAt, stale = @Stale WHERE hub_id = @HubId AND device_id = @DeviceId",
                freshness.Devices.Select(device => new
                {
                    HubId = hubId,
                    device.DeviceId,
                    device.UpdatedAt,
                    Stale = device.Stale ? 1 : 0,
                }));
        });

    private static async Task ReplaceDomainAsync(SqliteConnection connection, string hubId, HubStats stats, string receivedAt)
    {
        var previousWindows = (await connection.QueryAsync<LimitWindowRow>(
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
                    meter_changed_at AS MeterChangedAt,
                    window_minutes AS WindowMinutes
                FROM
                    latest_limit_windows
                WHERE
                    hub_id = @hubId
                """,
                new { hubId }))
            .ToDictionary(row => (row.Provider, row.AccountKey, row.Kind, row.LimitKey));

        // 利用実績は受信のたびに作り直す。契約・利用枠は、未報告枠の最後の値を残すため作り直さない。
        await connection.ExecuteAsync(
            """
            DELETE FROM latest_token_usages WHERE hub_id = @hubId;
            DELETE FROM hub_summaries WHERE hub_id = @hubId;
            """,
            new { hubId });

        // 既存端末は保持し、通知から消えた端末だけを日次明細と一緒に削除する。
        await connection.ExecuteAsync("DELETE FROM devices WHERE hub_id = @hubId AND device_id NOT IN @ids",
            new { hubId, ids = stats.Devices.Select(device => device.DeviceId).ToArray() });

        // 日別の集計は、受け取った日付だけを上書きまたは追加する。受け取っていない日付の行は消さない。
        if (stats.HistoryPreview?.Daily is { } daily)
        {
            await connection.ExecuteAsync(
                """
                INSERT INTO daily_token_usages (hub_id, date, tokens, cost_usd)
                VALUES (@hubId, @Date, @Tokens, @Cost)
                ON CONFLICT (hub_id, date) DO UPDATE SET tokens = excluded.tokens, cost_usd = excluded.cost_usd
                """,
                daily.Select(day => new { hubId, day.Date, day.Tokens, day.Cost }));
        }

        await connection.ExecuteAsync(
            "INSERT INTO hub_summaries (hub_id, updated_at, active_days) VALUES (@hubId, @updatedAt, @activeDays)",
            new { hubId, updatedAt = stats.UpdatedAt, activeDays = stats.HistoryPreview?.Summary.ActiveDays });

        await connection.ExecuteAsync(
            """
            INSERT INTO devices (hub_id, device_id, hostname, os_name, updated_at, stale)
            VALUES (@HubId, @DeviceId, @Hostname, @OsName, @UpdatedAt, @Stale)
            ON CONFLICT (hub_id, device_id) DO UPDATE SET
                hostname = excluded.hostname, os_name = excluded.os_name,
                updated_at = excluded.updated_at, stale = excluded.stale
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

        var now = DateTimeOffset.Parse(receivedAt, CultureInfo.InvariantCulture);
        var windows = stats.Limits.Providers
            .SelectMany(provider => provider.Windows
                .Where(window => window.ShowMeter && window.RemainingPercent is not null)
                .Select(window => (Provider: provider, Window: window)))
            .ToArray();
        var providers = windows.Select(item => item.Provider).Distinct().ToArray();

        await connection.ExecuteAsync(
            """
            INSERT INTO accounts (provider, account_key, account_label, plan_label)
            VALUES (@Provider, @AccountKey, @AccountLabel, @PlanLabel)
            ON CONFLICT (provider, account_key) DO UPDATE SET
                account_label = excluded.account_label,
                plan_label = excluded.plan_label
            """,
            providers.Select(provider => new
            {
                provider.Provider,
                provider.AccountKey,
                provider.AccountLabel,
                provider.PlanLabel,
            }));

        // 契約は、報告されなくなっても削除しない（保持する枠の親のため。Hubの削除で消える）。
        await connection.ExecuteAsync(
            """
            INSERT INTO hub_accounts (hub_id, provider, account_key)
            VALUES (@HubId, @Provider, @AccountKey)
            ON CONFLICT (hub_id, provider, account_key) DO NOTHING
            """,
            providers.Select(provider => new
            {
                HubId = hubId,
                provider.Provider,
                provider.AccountKey,
            }));

        var rows = windows.Select(item =>
        {
            var (provider, window) = item;
            var limitKey = (string.IsNullOrEmpty(window.LimitId) ? window.Label : window.LimitId) ?? "";
            var remaining = window.RemainingPercent!.Value;
            var found = previousWindows.TryGetValue((provider.Provider, provider.AccountKey, window.Kind, limitKey), out var previous);
            // 残量・使用量が前回の行と同じなら、最後に変わった時刻を引き継ぐ。
            var meterChangedAt = found && previous!.RemainingPercent == remaining && previous.UsedPercent == window.UsedPercent
                ? previous.MeterChangedAt
                : receivedAt;
            return new LimitWindowRow(
                hubId, provider.Provider, provider.AccountKey, window.Kind, limitKey, window.Label,
                remaining, window.UsedPercent, window.ResetsAt, meterChangedAt,
                window.WindowMinutes);
        }).ToArray();

        // 報告されなくなった枠は、最後に記録した次のリセット時刻を過ぎるまで、最後の値のまま行を残す。
        // 次のリセット時刻を持たない枠は、期限を決められないため、報告されなくなった時点で削除する。
        var reportedWindows = rows.Select(row => (row.Provider, row.AccountKey, row.Kind, row.LimitKey)).ToHashSet();
        await connection.ExecuteAsync(
            """
            DELETE FROM latest_limit_windows
            WHERE hub_id = @HubId AND provider = @Provider AND account_key = @AccountKey AND kind = @Kind AND limit_key = @LimitKey
            """,
            previousWindows.Where(entry => !reportedWindows.Contains(entry.Key) && IsExpired(entry.Value.ResetsAt, now))
                .Select(entry => new { HubId = hubId, entry.Key.Provider, entry.Key.AccountKey, entry.Key.Kind, entry.Key.LimitKey }));

        await connection.ExecuteAsync(
            """
            INSERT INTO latest_limit_windows (
                hub_id, provider, account_key, kind, limit_key, label,
                remaining_percent, used_percent, resets_at, meter_changed_at, window_minutes)
            VALUES (
                @HubId, @Provider, @AccountKey, @Kind, @LimitKey, @Label,
                @RemainingPercent, @UsedPercent, @ResetsAt, @MeterChangedAt, @WindowMinutes)
            ON CONFLICT (hub_id, provider, account_key, kind, limit_key) DO UPDATE SET
                label = excluded.label,
                remaining_percent = excluded.remaining_percent,
                used_percent = excluded.used_percent,
                resets_at = excluded.resets_at,
                meter_changed_at = excluded.meter_changed_at,
                window_minutes = excluded.window_minutes
            """,
            rows);
    }

    private static bool IsExpired(string? resetsAt, DateTimeOffset now) =>
        resetsAt is null || now >= DateTimeOffset.Parse(resetsAt, CultureInfo.InvariantCulture);

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
        string MeterChangedAt,
        double? WindowMinutes);
}
