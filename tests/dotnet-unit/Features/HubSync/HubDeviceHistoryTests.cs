using System.Text.Json;
using Dapper;
using MultiTokenMonitor.Features.HubSync;
using MultiTokenMonitor.Features.HubRegistration;
using MultiTokenMonitor.Infrastructure.Persistence;
using Shouldly;
using Xunit;

namespace MultiTokenMonitor.UnitTests.Features.HubSync;

public sealed class HubDeviceHistoryTests
{
    private static readonly DateTimeOffset ReceivedAt = DateTimeOffset.Parse("2026-10-03T03:00:00Z");
    private const string HistoryJson = """
        {"devices":[{"deviceId":"device","historyAvailable":true,"history":{"daily":[
          {"date":"2026-10-02","tokens":3,"perModel":{"old":{"tokens":3,"cost":null}}},
          {"date":"2026-10-03","tokens":4,"perModel":{"old":{"tokens":4,"cost":2}}}
        ]}}]}
        """;

    [Fact]
    public void LiveToday_ReplacesSameDateAndCombinesToolsWithoutDoubleCounting()
    {
        var days = HubDeviceHistory.Read(HistoryJson, Stats(), ReceivedAt);

        days.Single(day => day.Date == "2026-10-02").Models.Single().CostUsd.ShouldBeNull();
        var today = days.Single(day => day.Date == "2026-10-03");
        today.Models.ShouldBe([new DailyModelUsage("model", 7, 3)]);
    }

    [Theory]
    [InlineData("2026-10-03T03:00:00Z", "2026-10-03")]
    [InlineData("2026-10-04T00:00:00Z", "invalid")]
    public void ExpiredOrInvalidTodayKey_DoesNotOverlayHistory(string endsAt, string key)
    {
        var days = HubDeviceHistory.Read(HistoryJson, Stats(endsAt, key), ReceivedAt);

        days.Single(day => day.Date == "2026-10-03").Models.ShouldBe([new DailyModelUsage("old", 4, 2)]);
    }

    [Fact]
    public void SmallerLiveSnapshot_PreservesLargerRetainedDay()
    {
        var stats = Stats();
        var device = stats.Devices.Single();
        stats = stats with { Devices = [device with { Periods = device.Periods with { Today = device.Periods.Today with { TotalTokens = 1 } } }] };

        HubDeviceHistory.Read(HistoryJson, stats, ReceivedAt)
            .Single(day => day.Date == "2026-10-03").Models.Single().Model.ShouldBe("old");
    }

    [Theory]
    [InlineData("{\"devices\":[{\"deviceId\":\"device\"}]}")]
    [InlineData("{\"devices\":[{\"deviceId\":\"device\",\"historyAvailable\":false}]}")]
    [InlineData("{\"devices\":[{\"deviceId\":\"device\",\"historyAvailable\":true,\"history\":null}]}")]
    public void UnavailableHistory_DoesNotInventLiveDailyRows(string json)
    {
        HubDeviceHistory.Read(json, Stats(), ReceivedAt).ShouldBeEmpty();
    }

    [Theory]
    [InlineData("{\"devices\":[]}")]
    [InlineData("{\"devices\":[{\"deviceId\":\"other\"}]}")]
    [InlineData("{\"devices\":[{\"deviceId\":\"device\",\"historyAvailable\":true,\"history\":{\"daily\":[{\"date\":\"2026-02-30\",\"tokens\":0,\"perModel\":{}}]}}]}")]
    [InlineData("{\"devices\":[{\"deviceId\":\"device\",\"historyAvailable\":true,\"history\":{\"daily\":[{\"date\":\"2026-10-01\",\"tokens\":1,\"perModel\":{\"x\":{\"tokens\":-1}}}]}}]}")]
    public void InvalidExternalHistory_IsRejected(string json)
    {
        Should.Throw<JsonException>(() => HubDeviceHistory.Read(json, Stats(), ReceivedAt));
    }

    [Fact]
    public async Task Save_ReplacesReportedDayOnlyAndRetainsHistoryThroughFreshnessAndStatsAsync()
    {
        using var fixture = await SavedHistory.CreateAsync();
        await fixture.SaveAsync([
            new("device", "2026-10-01", [new("first", 2, null)]),
            new("device", "2026-10-02", [new("removed", 4, 1)])]);
        await fixture.SaveAsync([new("device", "2026-10-02", [new("replacement", 8, 2)])]);
        await fixture.SaveAsync(null);
        await HubStateStore.SaveFreshnessAsync(fixture.Database, "hub",
            new HubFreshness("2026-10-03T04:00:00Z", 1000, [new("device", "2026-10-03T04:00:00Z", "2026-10-03T04:00:00Z", 0, true)]),
            "2026-10-03T04:00:00Z");

        await using var connection = await fixture.Database.OpenAsync();
        var rows = (await connection.QueryAsync<(string Date, string Model, long Tokens, double? Cost)>(
            "SELECT date, model, tokens, cost_usd FROM device_daily_model_usages ORDER BY date")).ToArray();
        rows.ShouldBe([("2026-10-01", "first", 2L, null), ("2026-10-02", "replacement", 8L, 2d)]);

        await fixture.SaveAsync(null, removeDevice: true);
        (await connection.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM device_daily_model_usages")).ShouldBe(0);
    }

    [Fact]
    public async Task SameRevision_UpdatesLiveTodayButMissingRevisionKeepsSavedDaysAsync()
    {
        using var fixture = await SavedHistory.CreateAsync();
        await fixture.SaveAsync([
            new("device", "2026-10-01", [new("past", 2, null)]),
            new("device", "2026-10-03", [new("old", 4, 1)])], revision: "same");
        await fixture.SaveAsync(null, revision: "same", liveTokens: 12);
        await fixture.SaveAsync(null, liveTokens: 20);

        await using var connection = await fixture.Database.OpenAsync();
        var rows = (await connection.QueryAsync<(string Date, string Model, long Tokens)>(
            "SELECT date, model, tokens FROM device_daily_model_usages ORDER BY date")).ToArray();
        rows.ShouldBe([("2026-10-01", "past", 2L), ("2026-10-03", "live", 12L)]);
    }

    [Fact]
    public async Task RevisionWithoutSavedHistory_DoesNotInventDailyRowsAsync()
    {
        using var fixture = await SavedHistory.CreateAsync();
        await fixture.SaveAsync(null, revision: "same", liveTokens: 12);

        await using var connection = await fixture.Database.OpenAsync();
        (await connection.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM device_daily_model_usages")).ShouldBe(0);
    }

    [Fact]
    public async Task FailedDailyWrite_RollsBackSnapshotAndRetainsOldHistoryAsync()
    {
        using var fixture = await SavedHistory.CreateAsync();
        await fixture.SaveAsync([new("device", "2026-10-01", [new("kept", 2, 1)])]);

        await Should.ThrowAsync<Microsoft.Data.Sqlite.SqliteException>(() => fixture.SaveAsync(
            [new("missing-device", "2026-10-01", [new("invalid", 3, 2)])], receivedAt: "2026-10-03T05:00:00Z"));

        await using var connection = await fixture.Database.OpenAsync();
        (await connection.ExecuteScalarAsync<string>("SELECT received_at FROM hub_states")).ShouldBe("2026-10-03T03:00:00Z");
        (await connection.ExecuteScalarAsync<string>("SELECT model FROM device_daily_model_usages")).ShouldBe("kept");
    }

    private static HubStats Stats(string endsAt = "2026-10-04T00:00:00Z", string key = "2026-10-03")
    {
        var period = new HubPeriod(7,
            new Dictionary<string, IReadOnlyDictionary<string, long>>
            {
                ["a"] = new Dictionary<string, long> { ["model"] = 3 },
                ["b"] = new Dictionary<string, long> { ["model"] = 4 },
            },
            new Dictionary<string, IReadOnlyDictionary<string, double>>
            {
                ["a"] = new Dictionary<string, double> { ["model"] = 1 },
                ["b"] = new Dictionary<string, double> { ["model"] = 2 },
            });
        var periods = new HubPeriods(period, period, period);
        var device = new HubDevice("device", "host", "2026-10-03T03:00:00Z", false, periods,
            PeriodWindows: new HubPeriodWindows(new HubPeriodWindow(DateTimeOffset.Parse(endsAt), key)));
        return new HubStats(device.UpdatedAt, periods, [device], new HubLimits(device.UpdatedAt, []));
    }

    private sealed class SavedHistory : IDisposable
    {
        private readonly string directory = Path.Combine(Path.GetTempPath(), $"hub-daily-{Guid.NewGuid():N}");
        internal Database Database { get; private set; } = null!;
        internal static async Task<SavedHistory> CreateAsync()
        {
            var fixture = new SavedHistory();
            fixture.Database = new Database(Path.Combine(fixture.directory, "app.sqlite"));
            await fixture.Database.InitializeAsync();
            await HubRegistry.RegisterAsync(fixture.Database, new HubConnection("hub", "Hub", new Uri("http://127.0.0.1"), "token"));
            return fixture;
        }
        internal Task SaveAsync(IReadOnlyList<DeviceHistoryDay>? days, bool removeDevice = false, string receivedAt = "2026-10-03T03:00:00Z",
            string? revision = null, long? liveTokens = null)
        {
            var stats = Stats() with { DeviceHistoryRevision = revision };
            if (liveTokens is { } tokens)
            {
                var device = stats.Devices.Single();
                var today = new HubPeriod(tokens,
                    new Dictionary<string, IReadOnlyDictionary<string, long>> { ["tool"] = new Dictionary<string, long> { ["live"] = tokens } },
                    new Dictionary<string, IReadOnlyDictionary<string, double>>());
                stats = stats with { Devices = [device with { Periods = device.Periods with { Today = today } }] };
            }
            if (removeDevice) stats = stats with { Devices = [] };
            var json = JsonSerializer.SerializeToNode(stats, HubNotification.Options)!.AsObject();
            return HubStateStore.SaveAsync(Database, "hub", new HubNotification(HubNotificationKind.Stats, json), receivedAt, days);
        }
        public void Dispose() => Directory.Delete(directory, true);
    }
}
