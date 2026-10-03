using System.Globalization;
using System.Text.Json;

namespace MultiTokenMonitor.Features.HubSync;

internal sealed record DeviceHistoryDay(string DeviceId, string Date, IReadOnlyList<DailyModelUsage> Models);
internal sealed record DailyModelUsage(string Model, long Tokens, double? CostUsd);

// 外部APIの境界で型と利用量を確認し、保存する日次明細だけを取り出す。
internal static class HubDeviceHistory
{
    internal static IReadOnlyList<DeviceHistoryDay> Read(string json, HubStats stats, DateTimeOffset receivedAt)
    {
        var payload = JsonSerializer.Deserialize<DeviceHistoryOutput>(json, HubNotification.Options)
            ?? throw new JsonException("Device history is empty.");
        var ids = payload.Devices.Select(device => device.DeviceId).ToArray();
        if (ids.Any(string.IsNullOrWhiteSpace) || ids.Distinct().Count() != ids.Length ||
            !ids.ToHashSet().SetEquals(stats.Devices.Select(device => device.DeviceId)))
            throw new JsonException("Device inventory differs from the notification.");

        var result = new List<DeviceHistoryDay>();
        foreach (var record in payload.Devices)
        {
            if (record.HistoryAvailable != true || record.History is null) continue;
            var days = new Dictionary<string, DeviceHistoryDay>();
            var totals = new Dictionary<string, long>();
            foreach (var day in record.History.Daily)
            {
                if (!ValidDate(day.Date) || day.Tokens < 0 || days.ContainsKey(day.Date))
                    throw new JsonException("Invalid history day.");
                var models = day.PerModel.Select(pair => ValidUsage(pair.Key, pair.Value.Tokens, pair.Value.Cost)).ToArray();
                days.Add(day.Date, new DeviceHistoryDay(record.DeviceId, day.Date, models));
                totals.Add(day.Date, day.Tokens);
            }

            var device = stats.Devices.Single(device => device.DeviceId == record.DeviceId);
            var previous = totals.GetValueOrDefault(device.PeriodWindows?.Today?.Key ?? "");
            if (LiveDay(device, previous, receivedAt) is { } liveDay) days[liveDay.Date] = liveDay;
            result.AddRange(days.Values);
        }
        return result;
    }

    internal static DeviceHistoryDay? LiveDay(HubDevice device, long previousTokens, DateTimeOffset receivedAt)
    {
        if (device.PeriodWindows?.Today is not { Key: { } key } window || !ValidDate(key) || window.EndsAt <= receivedAt)
            return null;
        var live = device.Periods.Today;
        if (live.TotalTokens < 0) throw new JsonException("Invalid live token total.");
        if (live.TotalTokens < previousTokens) return null;
        var usages = live.ClientModels.SelectMany(tool => tool.Value.Select(model =>
            ValidUsage(model.Key, model.Value,
                live.ClientModelCosts.TryGetValue(tool.Key, out var costs) && costs.TryGetValue(model.Key, out var cost)
                    ? cost : null)));
        var models = usages.GroupBy(usage => usage.Model).Select(group =>
        {
            var costs = group.Where(usage => usage.CostUsd is not null).ToArray();
            return ValidUsage(group.Key, group.Sum(usage => usage.Tokens),
                costs.Length == 0 ? null : costs.Sum(usage => usage.CostUsd!.Value));
        }).ToArray();
        return new DeviceHistoryDay(device.DeviceId, key, models);
    }

    private static bool ValidDate(string date) =>
        DateOnly.TryParseExact(date, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out _);

    private static DailyModelUsage ValidUsage(string model, long tokens, double? cost)
    {
        if (string.IsNullOrWhiteSpace(model) || tokens < 0 || cost is { } value && (!double.IsFinite(value) || value < 0))
            throw new JsonException("Invalid model usage.");
        return new DailyModelUsage(model, tokens, cost);
    }

    private sealed record DeviceHistoryOutput(IReadOnlyList<DeviceHistoryRecord> Devices);
    private sealed record DeviceHistoryRecord(string DeviceId, bool? HistoryAvailable = null, HistoryOutput? History = null);
    private sealed record HistoryOutput(IReadOnlyList<HistoryDay> Daily);
    private sealed record HistoryDay(string Date, long Tokens, IReadOnlyDictionary<string, HistoryModel> PerModel);
    private sealed record HistoryModel(long Tokens, double? Cost = null);
}
