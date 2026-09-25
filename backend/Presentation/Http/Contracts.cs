namespace MultiTokenMonitor.Presentation.Http;

internal sealed record HealthOutput(string Status);

internal sealed record OverviewOutput(
    IReadOnlyList<OverviewHubOutput> Hubs,
    OverviewPeriodsOutput Periods,
    IReadOnlyList<OverviewLimitWindowOutput> LimitWindows,
    IReadOnlyList<OverviewDeviceOutput> Devices);

/// <summary>未受信のHubは ReceivedAt と UpdatedAt が null。</summary>
internal sealed record OverviewHubOutput(string HubId, string Name, string? ReceivedAt, string? UpdatedAt);

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
    string? ResetsAt);

internal sealed record OverviewDeviceOutput(
    string HubId,
    string DeviceId,
    string Hostname,
    string? OsName,
    string UpdatedAt,
    bool Stale);
