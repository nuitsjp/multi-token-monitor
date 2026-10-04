using System.Globalization;
using System.Text.Json;
using Dapper;
using Microsoft.Data.Sqlite;
using MultiTokenMonitor.Features.Overview;
using MultiTokenMonitor.Infrastructure.Persistence;

namespace MultiTokenMonitor.Features.LimitHistory;

internal static class LimitHistoryStore
{
    // 同梱の価格一覧を価格表へ適用する。価格表に無いプランと、同梱の最終更新日時の方が新しいプランだけを書き込む。
    internal static async Task ApplyBundledPricesAsync(Database database)
    {
        await using var stream = typeof(LimitHistoryStore).Assembly.GetManifestResourceStream("MultiTokenMonitor.plan-prices.json")
            ?? throw new InvalidOperationException("同梱の価格一覧が見つかりません。");
        var prices = await JsonSerializer.DeserializeAsync<PlanPrice[]>(stream, JsonSerializerOptions.Web)
            ?? throw new InvalidOperationException("同梱の価格一覧を読めません。");
        await database.InTransactionAsync(connection => connection.ExecuteAsync(
            """
            INSERT INTO plan_prices (provider, plan, monthly_usd, updated_at)
            VALUES (@Provider, @Plan, @MonthlyUsd, @UpdatedAt)
            ON CONFLICT (provider, plan) DO UPDATE SET
                monthly_usd = excluded.monthly_usd,
                updated_at = excluded.updated_at
            WHERE excluded.updated_at > plan_prices.updated_at
            """,
            prices));
    }

    // 契約の枠グループごとの月換算上限額と、その時点の支払額を、受信した日の現地日付の行へ上書きする。
    // 月換算上限額が求まらない枠グループは、その日の既存の行を変えない。
    internal static async Task RecordAsync(SqliteConnection connection, string hubId, string receivedAt)
    {
        var date = DateTimeOffset.Parse(receivedAt, CultureInfo.InvariantCulture).ToLocalTime()
            .ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        var windows = await LimitWindowEstimates.ReadAsync(connection, hubId);
        foreach (var contract in windows.GroupBy(window => (window.Provider, window.AccountKey)))
        {
            var first = contract.First();
            var plan = !string.IsNullOrEmpty(first.PlanLabel) ? first.PlanLabel
                : !string.IsNullOrEmpty(first.AccountLabel) ? first.AccountLabel
                : null;
            var price = plan is null
                ? null
                : await connection.ExecuteScalarAsync<double?>(
                    "SELECT monthly_usd FROM plan_prices WHERE provider = @Provider AND plan = @plan",
                    new { contract.Key.Provider, plan });
            foreach (var group in contract.GroupBy(window => LimitEstimator.GroupOf(window.Label)))
            {
                var monthly = MonthlyLimit.Of(group.Select(window => (window.Kind, window.WindowMinutes, window.Estimate.LimitUsd)));
                if (monthly is null) continue;
                await connection.ExecuteAsync(
                    """
                    INSERT INTO daily_monthly_limits (
                        hub_id, provider, account_key, limit_group, date, plan, monthly_limit_usd, price_usd, recorded_at)
                    VALUES (@hubId, @Provider, @AccountKey, @group, @date, @plan, @monthly, @price, @receivedAt)
                    ON CONFLICT (hub_id, provider, account_key, limit_group, date) DO UPDATE SET
                        plan = excluded.plan,
                        monthly_limit_usd = excluded.monthly_limit_usd,
                        price_usd = excluded.price_usd,
                        recorded_at = excluded.recorded_at
                    """,
                    new { hubId, contract.Key.Provider, contract.Key.AccountKey, group = group.Key, date, plan, monthly, price, receivedAt });
            }
        }
    }

    private sealed record PlanPrice(string Provider, string Plan, double MonthlyUsd, string UpdatedAt);
}
