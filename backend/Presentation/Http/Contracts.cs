namespace MultiTokenMonitor.Presentation.Http;

internal sealed record HealthOutput(string Status);

/// <summary>設定画面に表示する登録済みのHub。認証トークンは含めない。Status は reconnecting・notReceived・connected。</summary>
internal sealed record HubRegistrationOutput(string HubId, string Name, string Url, string Status);

internal sealed record AddHubInput(string? Name, string? Url, string? Token);

/// <summary>Hubの変更。Token が空なら登録済みの認証トークンを変更しない。</summary>
internal sealed record UpdateHubInput(string? Name, string? Url, string? Token);

internal sealed record HubUsageDataOutput(string Today, IReadOnlyList<HubUsageHubOutput> Hubs);

internal sealed record HubUsageHubOutput(
    string HubId,
    string Name,
    bool Connected,
    string? ReceivedAt,
    IReadOnlyList<HubUsageDeviceOutput> Devices,
    IReadOnlyList<HubUsageDayOutput> Days);

internal sealed record HubUsageDeviceOutput(
    string DeviceId,
    string Hostname,
    string? OsName,
    string UpdatedAt,
    bool Stale);

internal sealed record HubUsageDayOutput(string Date, string DeviceId, string Model, long Tokens, double? CostUsd);

internal sealed record OverviewOutput(
    IReadOnlyList<OverviewHubOutput> Hubs,
    OverviewPeriodsOutput Periods,
    IReadOnlyList<OverviewLimitWindowOutput> LimitWindows,
    IReadOnlyList<OverviewDeviceOutput> Devices,
    OverviewActivityOutput Activity);

/// <summary>Hubが送る日別の集計を全Hubで合算した行。Date は YYYY-MM-DD で、CostUsd は推定コストのある実績が1件もなければ null。</summary>
internal sealed record OverviewActivityOutput(IReadOnlyList<ActivityDayOutput> Days);

internal sealed record ActivityDayOutput(string Date, long Tokens, double? CostUsd);

/// <summary>未受信のHubは ReceivedAt と UpdatedAt が null。Connected は受信中なら true、再接続中なら false。</summary>
internal sealed record OverviewHubOutput(string HubId, string Name, bool Connected, string? ReceivedAt, string? UpdatedAt);

internal sealed record OverviewPeriodsOutput(
    OverviewPeriodOutput Today,
    OverviewPeriodOutput Month,
    OverviewPeriodOutput AllTime);

internal sealed record OverviewPeriodOutput(
    UsageOutput Total,
    IReadOnlyList<HubUsageOutput> Hubs,
    IReadOnlyList<ModelUsageOutput> Models);

/// <summary>CostUsd は推定コストのある実績が1件もなければ null。</summary>
internal sealed record UsageOutput(long Tokens, double? CostUsd);

internal sealed record HubUsageOutput(string HubId, long Tokens, double? CostUsd);

internal sealed record ModelUsageOutput(string Tool, string Model, long Tokens, double? CostUsd);

/// <summary>
/// WindowMinutes は枠の長さ（分）で、Hubが送らない枠は null。
/// </summary>
internal sealed record OverviewLimitWindowOutput(
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
    double? WindowMinutes);

internal sealed record OverviewDeviceOutput(
    string HubId,
    string DeviceId,
    string Hostname,
    string? OsName,
    string UpdatedAt,
    bool Stale);
