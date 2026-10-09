using System.Text.Json;
using Dapper;
using MultiTokenMonitor.Features.HubSync;
using MultiTokenMonitor.Features.Overview;
using MultiTokenMonitor.Features.HubRegistration;
using MultiTokenMonitor.Infrastructure.Persistence;
using MultiTokenMonitor.Presentation.Http;
using Shouldly;
using Xunit;

namespace MultiTokenMonitor.UnitTests.Features.HubSync;

// 利用枠の最新値と、未報告枠の保持を実DBで検証する。
public sealed class HubStateStoreLimitTests
{
    private const string Start = "2026-10-01T00:00:00.000Z";
    private const string Later = "2026-10-01T01:00:00.000Z";
    private const string Resets = "2026-10-01T05:00:00.000Z";

    [Fact]
    public async Task NewWindow_StoresTheReportedMeterAndReadsItInOverviewAsync()
    {
        using var fixture = await SavedHub.CreateAsync();

        await fixture.SaveAsync(Start, Provider("codex", "a", Window("session", "Session", 90, Resets, 300)));

        (await fixture.WindowsAsync()).Single().ShouldBe(new WindowRow("a", "session", "Session", 90, 10, Resets, Start, 300));
        (await fixture.OverviewAsync()).Single().ShouldBe(new OverviewLimitWindowOutput(
            "hub", "codex", "a", "Account a", "Pro", "session", "Session", "Session", 90, Resets, 300));
    }

    [Fact]
    public async Task SameCycle_UpdatesEachWindowsLatestMeterAsync()
    {
        using var fixture = await SavedHub.CreateAsync();
        await fixture.SaveAsync(Start,
            Provider("codex", "a", Window("session", "", 90, Resets), Window("weekly", "", 70, Resets)));

        await fixture.SaveAsync(Later,
            Provider("codex", "a", Window("session", "", 85, Resets), Window("weekly", "", 75, Resets)));

        var windows = await fixture.WindowsAsync();
        windows.Single(row => row.Kind == "session").ShouldBe(new WindowRow("a", "session", "", 85, 15, Resets, Later, null));
        windows.Single(row => row.Kind == "weekly").ShouldBe(new WindowRow("a", "weekly", "", 75, 25, Resets, Later, null));
    }

    [Fact]
    public async Task ResetsAtJitterWithUnchangedMeter_KeepsTheMeterChangedTimeAsync()
    {
        using var fixture = await SavedHub.CreateAsync();
        await fixture.SaveAsync(Start, Provider("codex", "a", Window("session", "", 90, "2026-10-01T05:00:00.100Z")));

        await fixture.SaveAsync(Later, Provider("codex", "a", Window("session", "", 90, "2026-10-01T05:00:00.900Z", 300)));

        (await fixture.WindowsAsync()).Single().ShouldBe(new WindowRow(
            "a", "session", "", 90, 10, "2026-10-01T05:00:00.900Z", Start, 300));
    }

    [Fact]
    public async Task RemainingIncreased_UpdatesTheLatestMeterAndChangedTimeAsync()
    {
        using var fixture = await SavedHub.CreateAsync();
        await fixture.SaveAsync(Start, Provider("codex", "a", Window("session", "", 50, Resets)));

        await fixture.SaveAsync(Later, Provider("codex", "a", Window("session", "", 60, Resets)));

        (await fixture.WindowsAsync()).Single().ShouldBe(new WindowRow("a", "session", "", 60, 40, Resets, Later, null));
    }

    [Fact]
    public async Task WindowNoLongerReported_IsKeptBeforeItsResetTimeAsync()
    {
        using var fixture = await SavedHub.CreateAsync();
        await fixture.SaveAsync(Start,
            Provider("codex", "a", Window("session", "", 90, Resets), Window("weekly", "", 70, Resets)));

        await fixture.SaveAsync(Later, Provider("codex", "a", Window("weekly", "", 65, Resets)));

        var windows = await fixture.WindowsAsync();
        windows.Select(row => row.Kind).ShouldBe(["session", "weekly"], ignoreOrder: true);
        windows.Single(row => row.Kind == "session").ShouldBe(new WindowRow("a", "session", "", 90, 10, Resets, Start, null));
        (await fixture.OverviewAsync()).Select(row => row.Kind).ShouldBe(["session", "weekly"], ignoreOrder: true);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("2026-10-01T00:30:00.000Z")]
    public async Task WindowNoLongerReportedWithoutAFutureReset_IsRemovedAsync(string? resetsAt)
    {
        using var fixture = await SavedHub.CreateAsync();
        await fixture.SaveAsync(Start, Provider("codex", "a", Window("session", "", 90, resetsAt)));

        await fixture.SaveAsync(Later);

        (await fixture.WindowsAsync()).ShouldBeEmpty();
        (await fixture.OverviewAsync()).ShouldBeEmpty();
        (await fixture.AccountKeysAsync()).ShouldBe(["a"]);
    }

    [Fact]
    public async Task AccountNoLongerReported_KeepsItsAccountAndWindowsBeforeTheResetTimeAsync()
    {
        using var fixture = await SavedHub.CreateAsync();
        await fixture.SaveAsync(Start,
            Provider("codex", "a", Window("weekly", "", 90, Resets)),
            Provider("codex", "b", Window("weekly", "", 80, Resets)));

        await fixture.SaveAsync(Later, Provider("codex", "b", Window("weekly", "", 79, Resets)));

        (await fixture.AccountKeysAsync()).ShouldBe(["a", "b"]);
        (await fixture.WindowsAsync()).Select(row => row.AccountKey).ShouldBe(["a", "b"]);
        (await fixture.OverviewAsync()).Select(row => row.AccountKey).ShouldBe(["a", "b"]);
    }

    [Fact]
    public async Task AccountsOfTheSameProvider_KeepSeparateMetersAsync()
    {
        using var fixture = await SavedHub.CreateAsync();

        await fixture.SaveAsync(Start,
            Provider("codex", "a", Window("weekly", "", 90, Resets)),
            Provider("codex", "b", Window("weekly", "", 80, Resets)));

        (await fixture.AccountKeysAsync()).ShouldBe(["a", "b"]);
        (await fixture.WindowsAsync()).Select(row => (row.AccountKey, row.Remaining)).ShouldBe([("a", 90.0), ("b", 80.0)]);
    }

    [Fact]
    public async Task ProviderWithoutAMeterWindow_HasNoAccountRowAsync()
    {
        using var fixture = await SavedHub.CreateAsync();
        var hidden = new Dictionary<string, object?>(Window("weekly", "", 90, Resets)) { ["showMeter"] = false };

        await fixture.SaveAsync(Start, Provider("codex", "a", hidden));

        (await fixture.AccountKeysAsync()).ShouldBeEmpty();
        (await fixture.WindowsAsync()).ShouldBeEmpty();
    }

    private static Dictionary<string, object?> Window(
        string kind, string label, double remaining, string? resetsAt, double? windowMinutes = null) => new()
    {
        ["kind"] = kind,
        ["label"] = label,
        ["showMeter"] = true,
        ["remainingPercent"] = remaining,
        ["usedPercent"] = 100 - remaining,
        ["resetsAt"] = resetsAt,
        ["windowMinutes"] = windowMinutes,
    };

    private static Dictionary<string, object?> Provider(
        string provider, string account, params Dictionary<string, object?>[] windows) => new()
    {
        ["provider"] = provider,
        ["accountKey"] = account,
        ["accountLabel"] = $"Account {account}",
        ["planLabel"] = "Pro",
        ["windows"] = windows,
    };

    private sealed record WindowRow(
        string AccountKey,
        string Kind,
        string LimitKey,
        double Remaining,
        double? Used,
        string? ResetsAt,
        string MeterChangedAt,
        double? WindowMinutes);

    private sealed class SavedHub : IDisposable
    {
        private readonly string directory = Path.Combine(Path.GetTempPath(), $"aidd-hub-limits-{Guid.NewGuid():N}");

        internal Database Database { get; private set; } = null!;

        internal static async Task<SavedHub> CreateAsync()
        {
            var fixture = new SavedHub { };
            fixture.Database = new Database(Path.Combine(fixture.directory, "app.sqlite"));
            await fixture.Database.InitializeAsync();
            await HubRegistry.RegisterAsync(
                fixture.Database, new HubConnection("hub", "Hub", new Uri("http://127.0.0.1"), "token"));
            return fixture;
        }

        internal Task SaveAsync(string receivedAt, params Dictionary<string, object?>[] providers)
        {
            var emptyPeriod = new { totalTokens = 0, clientModels = new { }, clientModelCosts = new { } };
            var data = JsonSerializer.Serialize(new
            {
                type = "stats",
                reason = "snapshot",
                at = receivedAt,
                stats = new
                {
                    updatedAt = receivedAt,
                    periods = new { today = emptyPeriod, month = emptyPeriod, allTime = emptyPeriod },
                    devices = Array.Empty<object>(),
                    limits = new { updatedAt = receivedAt, providers },
                },
            });
            return HubStateStore.SaveAsync(Database, "hub", HubNotification.Parse("snapshot", data), receivedAt);
        }

        internal async Task<WindowRow[]> WindowsAsync()
        {
            await using var connection = await Database.OpenAsync();
            return (await connection.QueryAsync<WindowRow>(
                """
                SELECT account_key AS AccountKey, kind AS Kind, limit_key AS LimitKey,
                       remaining_percent AS Remaining, used_percent AS Used, resets_at AS ResetsAt,
                       meter_changed_at AS MeterChangedAt, window_minutes AS WindowMinutes
                FROM latest_limit_windows ORDER BY account_key, kind, limit_key
                """)).ToArray();
        }

        internal async Task<string[]> AccountKeysAsync()
        {
            await using var connection = await Database.OpenAsync();
            return (await connection.QueryAsync<string>(
                "SELECT account_key FROM hub_accounts ORDER BY account_key")).ToArray();
        }

        internal async Task<IReadOnlyList<OverviewLimitWindowOutput>> OverviewAsync() =>
            (await OverviewQuery.ReadAsync(Database)).LimitWindows;

        public void Dispose()
        {
            if (Directory.Exists(directory)) Directory.Delete(directory, true);
        }
    }
}
