using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace MultiTokenMonitor.Features.Overview;

/// <summary>推定の状態。Estimating は、範囲は確定できるが金額の条件を満たしていない。</summary>
[JsonConverter(typeof(JsonStringEnumConverter<EstimateStatus>))]
internal enum EstimateStatus
{
    [JsonStringEnumMemberName("estimated")] Estimated,
    [JsonStringEnumMemberName("estimating")] Estimating,
    [JsonStringEnumMemberName("unavailable")] Unavailable,
}

/// <summary>コストの範囲を確定できない理由。</summary>
[JsonConverter(typeof(JsonStringEnumConverter<UnavailableReason>))]
internal enum UnavailableReason
{
    [JsonStringEnumMemberName("unknown-source-device")] UnknownSourceDevice,
    [JsonStringEnumMemberName("shared-source-device")] SharedSourceDevice,
    [JsonStringEnumMemberName("no-matching-model")] NoMatchingModel,
    [JsonStringEnumMemberName("not-countable")] NotCountable,
}

internal sealed record WindowKey(string AccountKey, string Kind, string LimitKey);

/// <summary>推定に使う枠の情報。SourceDeviceId は契約（アカウント）の属性で、同じ契約の枠で同じ値を持つ。</summary>
internal sealed record LimitWindowInput(
    WindowKey Key,
    string? Label,
    double RemainingPercent,
    double BaseRemainingPercent,
    string? SourceDeviceId);

/// <summary>端末×モデルごとの累計の推定コスト。</summary>
internal sealed record CostEntry(string DeviceId, string Model, double CostUsd);

internal sealed record EstimateResult(EstimateStatus Status, double? LimitUsd = null, UnavailableReason? Reason = null);

/// <summary>
/// 枠のコストの範囲を決め、推定上限額を求める純粋関数（DB・時刻に触れない）。
/// 規則は「保存済みの最新利用状況を1画面で見る」の「枠のコストの範囲」と、UCP-1 の個別ルールに従う。
/// </summary>
internal static class LimitEstimator
{
    // 画面（frontend/src/limits.ts の groupOf）と同じ規則。JSの \b と同じく、単語文字をASCIIに限る。
    private static readonly Regex WindowWord = new(
        @"\s*\b(5-hour|5h|session|weekly|daily|monthly)$",
        RegexOptions.ECMAScript | RegexOptions.IgnoreCase);

    /// <summary>枠のラベルから末尾の枠名を除いた部分。除いて空なら名前のないグループ（空文字）。</summary>
    internal static string GroupOf(string? label) => WindowWord.Replace(label ?? "", "").Trim();

    // 枠グループのモデルの範囲。
    private abstract record Rule;

    /// <summary>モデル名に語のどれかを（大文字小文字を区別せず）含むモデル。requireMatch なら、1つも該当しない枠を N/A にする。</summary>
    private sealed record Positive(IReadOnlyList<string> Tokens, bool RequireMatch) : Rule;

    /// <summary>同じ契約の他のグループに数えなかったモデルすべて。</summary>
    private sealed record Complement : Rule;

    /// <summary>契約のすべてのモデル（グループが1つの契約）。</summary>
    private sealed record All : Rule;

    /// <summary>範囲を確定できない。</summary>
    private sealed record NotCountable : Rule;

    // 提供元ごとの個別ルール。キーは（提供元、小文字の枠グループ名）。基本ルールより優先する。
    private static readonly Dictionary<(string Provider, string Group), Rule> IndividualRules = new()
    {
        [("cursor", "cursor models")] = new Positive(["grok", "composer"], RequireMatch: false),
        [("cursor", "other models")] = new Complement(),
        [("cursor", "grok bot")] = new NotCountable(),
    };

    /// <summary>
    /// 同じHub・同じ提供元の全契約の枠について、推定上限額を求める。
    /// current は現在の端末×モデル別コスト、baselines は枠ごとの1つ目の計測点の端末×モデル別コスト（無い枠は空）。
    /// </summary>
    internal static IReadOnlyDictionary<WindowKey, EstimateResult> Estimate(
        string provider,
        IReadOnlyList<LimitWindowInput> windows,
        IReadOnlyList<CostEntry> current,
        IReadOnlyDictionary<WindowKey, IReadOnlyList<CostEntry>> baselines)
    {
        var accounts = windows.GroupBy(window => window.Key.AccountKey).ToDictionary(group => group.Key, group => group.ToList());
        var sourceDevices = accounts.ToDictionary(
            account => account.Key,
            account => account.Value.Select(window => window.SourceDeviceId).FirstOrDefault(id => !string.IsNullOrEmpty(id)));

        var results = new Dictionary<WindowKey, EstimateResult>();
        foreach (var window in windows)
        {
            var baseline = baselines.TryGetValue(window.Key, out var found) ? found : [];
            results[window.Key] = EstimateWindow(provider, window, accounts, sourceDevices, current, baseline);
        }

        return results;
    }

    private static EstimateResult EstimateWindow(
        string provider,
        LimitWindowInput window,
        IReadOnlyDictionary<string, List<LimitWindowInput>> accounts,
        IReadOnlyDictionary<string, string?> sourceDevices,
        IReadOnlyList<CostEntry> current,
        IReadOnlyList<CostEntry> baseline)
    {
        var groups = accounts[window.Key.AccountKey].Select(other => GroupOf(other.Label)).Distinct().ToList();
        var group = GroupOf(window.Label);
        var rule = RuleOf(provider, group, groups);
        if (rule is NotCountable) return Unavailable(UnavailableReason.NotCountable);

        // アカウントが複数なら、取得元の端末のコストだけを数える。
        string? device = null;
        if (accounts.Count > 1)
        {
            device = sourceDevices[window.Key.AccountKey];
            if (device is null) return Unavailable(UnavailableReason.UnknownSourceDevice);
            if (sourceDevices.Any(other => other.Key != window.Key.AccountKey && other.Value == device))
                return Unavailable(UnavailableReason.SharedSourceDevice);
        }

        var currentInDevice = current.Where(cost => device is null || cost.DeviceId == device).ToList();
        var baselineInDevice = baseline.Where(cost => device is null || cost.DeviceId == device).ToList();

        var models = currentInDevice.Select(cost => cost.Model).Concat(baselineInDevice.Select(cost => cost.Model)).Distinct().ToList();
        // 他のグループが正の条件で数えるモデルは、補集合のグループには数えない。
        var othersPositive = groups.Where(other => other != group)
            .Select(other => RuleOf(provider, other, groups))
            .OfType<Positive>()
            .ToList();
        bool InScope(string model) => rule switch
        {
            Positive positive => Matches(positive, model),
            Complement => !othersPositive.Any(other => Matches(other, model)),
            _ => true,
        };
        if (rule is Positive { RequireMatch: true } && !models.Any(InScope))
            return Unavailable(UnavailableReason.NoMatchingModel);

        // 組ごとの増加は0を下限とし、1つ目の計測点にない組は0として扱う。
        var baselineByKey = baselineInDevice.ToDictionary(cost => (cost.DeviceId, cost.Model), cost => cost.CostUsd);
        var currentByKey = currentInDevice.ToDictionary(cost => (cost.DeviceId, cost.Model), cost => cost.CostUsd);
        var increase = currentByKey.Keys.Concat(baselineByKey.Keys).Distinct()
            .Where(key => InScope(key.Model))
            .Sum(key => Math.Max(0, currentByKey.GetValueOrDefault(key) - baselineByKey.GetValueOrDefault(key)));

        var usedPercent = window.BaseRemainingPercent - window.RemainingPercent;
        return usedPercent >= 1 && increase > 0
            ? new EstimateResult(EstimateStatus.Estimated, increase / usedPercent * 100)
            : new EstimateResult(EstimateStatus.Estimating);
    }

    private static Rule RuleOf(string provider, string group, IReadOnlyList<string> accountGroups)
    {
        if (IndividualRules.TryGetValue((provider, group.ToLowerInvariant()), out var individual)) return individual;
        if (accountGroups.Count == 1) return new All();
        // 名前のないグループは、他のグループに数えなかったモデルすべて。名前のあるグループは、名前の語を含むモデル。
        if (group.Length == 0) return new Complement();
        var tokens = group.Split([' ', '/'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        return new Positive(tokens, RequireMatch: true);
    }

    private static bool Matches(Positive rule, string model) =>
        rule.Tokens.Any(token => model.Contains(token, StringComparison.OrdinalIgnoreCase));

    private static EstimateResult Unavailable(UnavailableReason reason) =>
        new(EstimateStatus.Unavailable, Reason: reason);
}
