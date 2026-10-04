namespace MultiTokenMonitor.Features.LimitHistory;

/// <summary>月換算上限額を求める純粋関数。規則は画面（frontend/src/limits.ts の lengthOf・monthlyLimitUsd）と同じ。</summary>
internal static class MonthlyLimit
{
    // 枠の長さ（分）。Hubが windowMinutes を送らない枠だけ、この表から補う。
    private static readonly Dictionary<string, double> KindMinutes = new()
    {
        ["session"] = 300,
        ["daily"] = 1440,
        ["weekly"] = 10080,
        ["billing"] = 43200,
    };

    private const double Day = 1440;
    private const double Month = 31 * Day;

    internal static double? LengthOf(string kind, double? windowMinutes) =>
        windowMinutes ?? (KindMinutes.TryGetValue(kind, out var minutes) ? minutes : null);

    /// <summary>
    /// 推定上限額が金額で長さが分かる各枠を31日に比例換算し、最小値を採用する。約1か月（28〜31日）の枠はそのまま。
    /// 候補がなければ null。
    /// </summary>
    internal static double? Of(IEnumerable<(string Kind, double? WindowMinutes, double? LimitUsd)> windows)
    {
        double? minimum = null;
        foreach (var (kind, windowMinutes, limitUsd) in windows)
        {
            var minutes = LengthOf(kind, windowMinutes);
            if (minutes is null || limitUsd is null) continue;
            var monthly = minutes >= 28 * Day && minutes <= Month ? limitUsd.Value : limitUsd.Value / minutes.Value * Month;
            minimum = minimum is null ? monthly : Math.Min(minimum.Value, monthly);
        }

        return minimum;
    }
}
