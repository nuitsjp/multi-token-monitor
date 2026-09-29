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
// freshness は型付きの HubFreshness だけを持つ。
internal sealed record HubNotification(HubNotificationKind Kind, JsonObject Stats, HubFreshness? Freshness = null)
{
    internal static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        RespectNullableAnnotations = true,
        RespectRequiredConstructorParameters = true,
    };

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
            return new HubNotification(kind, envelope.Stats,
                envelope.Stats.Deserialize<HubFreshness>(Options) ?? throw new JsonException("通知が空です。"));
        _ = ReadStats(envelope.Stats);
        return new HubNotification(kind, envelope.Stats);
    }

    internal static HubStats ReadStats(JsonObject stats) =>
        stats.Deserialize<HubStats>(Options) ?? throw new JsonException("通知が空です。");

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
    string? Label = null,
    double? WindowMinutes = null);

internal sealed record HubHistoryPreview(HubHistorySummary Summary);

internal sealed record HubHistorySummary(long? ActiveDays = null);

internal sealed record HubFreshness(
    string UpdatedAt,
    double StaleAfterMs,
    IReadOnlyList<HubFreshnessDevice> Devices,
    HubFreshnessLimits? Limits = null);

internal sealed record HubFreshnessDevice(string DeviceId, string UpdatedAt, string ReceivedAt, double? AgeMs, bool Stale);

internal sealed record HubFreshnessLimits(string UpdatedAt);
