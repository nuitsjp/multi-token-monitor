using System.Text.Json;
using System.Text.Json.Nodes;

namespace MultiTokenMonitor.Features.HubSync;

internal enum HubNotificationKind
{
    Snapshot,
    Stats,
    Freshness,
}

// stats はHubから受け取ったJSONをそのまま保持し、保存時に型付きの HubStats へ読み替える。
internal sealed record HubNotification(HubNotificationKind Kind, JsonObject Stats)
{
    internal static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        RespectNullableAnnotations = true,
        RespectRequiredConstructorParameters = true,
    };

    private static readonly string[] FreshnessDeviceFields = ["updatedAt", "receivedAt", "ageMs", "stale"];

    // 不正な場合は JsonException を投げる。
    internal static HubNotification Parse(string eventName, string data)
    {
        var kind = eventName switch
        {
            "snapshot" => HubNotificationKind.Snapshot,
            "stats" => HubNotificationKind.Stats,
            "freshness" => HubNotificationKind.Freshness,
            _ => throw new JsonException("未対応のイベントです。"),
        };
        var envelope = JsonSerializer.Deserialize<Envelope>(data, Options) ?? throw new JsonException("通知が空です。");
        if (envelope.Type != (kind == HubNotificationKind.Freshness ? "freshness" : "stats"))
            throw new JsonException("通知の種類が不正です。");

        if (kind == HubNotificationKind.Freshness)
            _ = envelope.Stats.Deserialize<HubFreshness>(Options) ?? throw new JsonException("通知が空です。");
        else
            _ = ReadStats(envelope.Stats);
        return new HubNotification(kind, envelope.Stats);
    }

    internal static HubStats ReadStats(JsonObject stats) =>
        stats.Deserialize<HubStats>(Options) ?? throw new JsonException("通知が空です。");

    // freshness は時刻・鮮度情報だけを既存の stats に適用する。利用量・上限などは維持する。
    internal static JsonObject ApplyFreshness(JsonObject current, JsonObject freshness)
    {
        var next = current.DeepClone().AsObject();
        next["updatedAt"] = freshness["updatedAt"]!.DeepClone();
        next["staleAfterMs"] = freshness["staleAfterMs"]!.DeepClone();
        if (freshness["limits"] is JsonObject limits && limits.ContainsKey("updatedAt"))
            next["limits"]!["updatedAt"] = limits["updatedAt"]!.DeepClone();

        var updates = freshness["devices"]!.AsArray()
            .Select(device => device!.AsObject())
            .ToDictionary(device => device["deviceId"]!.GetValue<string>(), StringComparer.Ordinal);
        foreach (var device in next["devices"]!.AsArray().Select(device => device!.AsObject()))
        {
            if (!updates.TryGetValue(device["deviceId"]!.GetValue<string>(), out var update)) continue;
            foreach (var field in FreshnessDeviceFields)
                device[field] = update[field]?.DeepClone();
        }

        return next;
    }

    private sealed record Envelope(string Type, string Reason, JsonObject Stats, string At);
}

internal sealed record HubStats(
    string UpdatedAt,
    HubPeriods Periods,
    IReadOnlyList<HubDevice> Devices,
    HubLimits Limits,
    HubHistoryPreview? HistoryPreview = null);

internal sealed record HubPeriods(HubPeriod Today, HubPeriod Month, HubPeriod AllTime);

internal sealed record HubPeriod(
    long TotalTokens,
    IReadOnlyDictionary<string, IReadOnlyDictionary<string, long>> ClientModels,
    IReadOnlyDictionary<string, IReadOnlyDictionary<string, double>> ClientModelCosts);

internal sealed record HubDevice(
    string DeviceId,
    string Hostname,
    string UpdatedAt,
    bool Stale,
    HubPeriods Periods,
    string? OsName = null,
    HubPeriodWindows? PeriodWindows = null);

internal sealed record HubPeriodWindows(HubPeriodWindow? Today = null, HubPeriodWindow? Month = null);

internal sealed record HubPeriodWindow(DateTimeOffset EndsAt);

internal sealed record HubLimits(string UpdatedAt, IReadOnlyList<HubLimitProvider> Providers);

internal sealed record HubLimitProvider(
    string Provider,
    string AccountKey,
    IReadOnlyList<HubLimitWindow> Windows,
    string? AccountLabel = null,
    string? PlanLabel = null);

internal sealed record HubLimitWindow(
    string Kind,
    bool ShowMeter,
    double? RemainingPercent,
    double? UsedPercent,
    string? ResetsAt,
    string? LimitId = null,
    string? Label = null);

internal sealed record HubHistoryPreview(HubHistorySummary Summary);

internal sealed record HubHistorySummary(long? ActiveDays = null);

internal sealed record HubFreshness(
    string UpdatedAt,
    double StaleAfterMs,
    IReadOnlyList<HubFreshnessDevice> Devices,
    HubFreshnessLimits? Limits = null);

internal sealed record HubFreshnessDevice(string DeviceId, string UpdatedAt, string ReceivedAt, double? AgeMs, bool Stale);

internal sealed record HubFreshnessLimits(string UpdatedAt);
