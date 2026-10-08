using System.Text.Json;
using Dapper;
using MultiTokenMonitor.Features.HubSync;
using MultiTokenMonitor.Features.Overview;
using MultiTokenMonitor.Features.HubRegistration;
using MultiTokenMonitor.Infrastructure.Persistence;
using Shouldly;
using Xunit;

namespace MultiTokenMonitor.UnitTests.Features.HubSync;

// 利用枠の保存（契約・枠・1つ目の計測点のコスト）と、保存から閲覧までの推定を、実DBで検証する。
public sealed class HubStateStoreLimitTests
{
    private const string Start = "2026-10-01T00:00:00.000Z";
    private const string Later = "2026-10-01T01:00:00.000Z";
    private const string Resets = "2026-10-01T05:00:00.000Z";

    public sealed class Baseline
    {
        [Fact]
        public async Task NewWindow_StoresTheAllTimeCostsOfItsToolPerDeviceAndModelAsync()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            using var fixture = await SavedHub.CreateAsync();
            var devices = new[]
            {
                Device("d1", ("codex", "gpt-5", 3.0), ("codex", "mini", 1.0), ("claude", "opus", 99.0)),
                Device("d2", ("codex", "gpt-5", 5.0)),
            };

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            await fixture.SaveAsync(Start, [Provider("codex", "a", "d1", Window("session", "", 90, Resets))], devices);

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            (await fixture.BaselineAsync("session", ""))
                .ShouldBe([("d1", "gpt-5", 3.0), ("d1", "mini", 1.0), ("d2", "gpt-5", 5.0)]);
        }

        [Fact]
        public async Task PairsWithoutACost_AreNotStoredAsync()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            using var fixture = await SavedHub.CreateAsync();
            var device = Device("d1", ("codex", "priced", 2.0));
            device.Tokens["codex"]["unpriced"] = 10;

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            await fixture.SaveAsync(Start, [Provider("codex", "a", "d1", Window("session", "", 90, Resets))], [device]);

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            (await fixture.BaselineAsync("session", "")).ShouldBe([("d1", "priced", 2.0)]);
        }

        [Fact]
        public async Task SameCycle_KeepsTheBaselineWhileCurrentCostsGrowAsync()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            using var fixture = await SavedHub.CreateAsync();
            var provider = Provider("codex", "a", "d1", Window("session", "", 90, Resets));
            await fixture.SaveAsync(Start, [provider], [Device("d1", ("codex", "gpt-5", 3.0))]);

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            await fixture.SaveAsync(
                Later, [Provider("codex", "a", "d1", Window("session", "", 80, Resets))], [Device("d1", ("codex", "gpt-5", 9.0))]);

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            (await fixture.BaselineAsync("session", "")).ShouldBe([("d1", "gpt-5", 3.0)]);
            var row = (await fixture.WindowsAsync()).Single();
            row.BaseReceivedAt.ShouldBe(Start);
            row.BaseRemaining.ShouldBe(90);
            row.Remaining.ShouldBe(80);
        }

        [Fact]
        public async Task ResetsAtJitterWithinTheSameCycle_KeepsTheBaselineAsync()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            using var fixture = await SavedHub.CreateAsync();
            await fixture.SaveAsync(
                Start, [Provider("codex", "a", "d1", Window("session", "", 90, "2026-10-01T05:00:00.100Z"))], [Device("d1", ("codex", "m", 1.0))]);

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            await fixture.SaveAsync(
                Later, [Provider("codex", "a", "d1", Window("session", "", 85, "2026-10-01T05:00:00.900Z"))], [Device("d1", ("codex", "m", 2.0))]);

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            (await fixture.BaselineAsync("session", "")).ShouldBe([("d1", "m", 1.0)]);
            (await fixture.WindowsAsync()).Single().BaseReceivedAt.ShouldBe(Start);
        }

        [Fact]
        public async Task RemainingIncreased_ReplacesTheBaselineWithTheCurrentCostsAsync()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            using var fixture = await SavedHub.CreateAsync();
            await fixture.SaveAsync(
                Start, [Provider("codex", "a", "d1", Window("session", "", 50, Resets))], [Device("d1", ("codex", "m", 1.0), ("codex", "old", 4.0))]);

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            await fixture.SaveAsync(
                Later, [Provider("codex", "a", "d1", Window("session", "", 60, Resets))], [Device("d1", ("codex", "m", 7.0), ("codex", "new", 2.0))]);

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            (await fixture.BaselineAsync("session", "")).ShouldBe([("d1", "m", 7.0), ("d1", "new", 2.0)]);
            var row = (await fixture.WindowsAsync()).Single();
            row.BaseReceivedAt.ShouldBe(Later);
            row.BaseRemaining.ShouldBe(60);
        }

        [Fact]
        public async Task ResetsAtPassed_ReplacesTheBaselineWithTheCurrentCostsAsync()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            using var fixture = await SavedHub.CreateAsync();
            await fixture.SaveAsync(
                Start, [Provider("codex", "a", "d1", Window("session", "", 50, "2026-10-01T00:30:00.000Z"))], [Device("d1", ("codex", "m", 1.0))]);

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            await fixture.SaveAsync(
                Later, [Provider("codex", "a", "d1", Window("session", "", 40, Resets))], [Device("d1", ("codex", "m", 6.0))]);

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            (await fixture.BaselineAsync("session", "")).ShouldBe([("d1", "m", 6.0)]);
            (await fixture.WindowsAsync()).Single().BaseReceivedAt.ShouldBe(Later);
        }

        [Fact]
        public async Task EachWindow_KeepsItsOwnBaselineAsync()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            using var fixture = await SavedHub.CreateAsync();
            await fixture.SaveAsync(
                Start,
                [Provider("codex", "a", "d1", Window("session", "", 90, Resets), Window("weekly", "", 70, Resets))],
                [Device("d1", ("codex", "m", 1.0))]);

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            // weekly の使用率だけが減り（残量が増え）、その枠だけ基準点が取り直される。
            await fixture.SaveAsync(
                Later,
                [Provider("codex", "a", "d1", Window("session", "", 85, Resets), Window("weekly", "", 75, Resets))],
                [Device("d1", ("codex", "m", 4.0))]);

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            (await fixture.BaselineAsync("session", "")).ShouldBe([("d1", "m", 1.0)]);
            (await fixture.BaselineAsync("weekly", "")).ShouldBe([("d1", "m", 4.0)]);
        }

        [Fact]
        public async Task WindowNoLongerReported_IsKeptWithItsBaselineBeforeItsResetTimeAsync()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            using var fixture = await SavedHub.CreateAsync();
            await fixture.SaveAsync(
                Start,
                [Provider("codex", "a", "d1", Window("session", "", 90, Resets), Window("weekly", "", 70, Resets))],
                [Device("d1", ("codex", "m", 1.0))]);

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            await fixture.SaveAsync(
                Later, [Provider("codex", "a", "d1", Window("weekly", "", 65, Resets))], [Device("d1", ("codex", "m", 2.0))]);

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            var windows = await fixture.WindowsAsync();
            windows.Select(row => row.Kind).ShouldBe(["session", "weekly"], ignoreOrder: true);
            windows.Single(row => row.Kind == "session").Remaining.ShouldBe(90);
            (await fixture.BaselineAsync("session", "")).ShouldBe([("d1", "m", 1.0)]);
            (await fixture.BaselineAsync("weekly", "")).ShouldBe([("d1", "m", 1.0)]);
        }

        [Fact]
        public async Task AccountNoLongerReported_KeepsItsAccountWindowsAndBaselinesBeforeTheResetTimeAsync()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            using var fixture = await SavedHub.CreateAsync();
            await fixture.SaveAsync(
                Start,
                [Provider("codex", "a", "d1", Window("weekly", "", 90, Resets)), Provider("codex", "b", "d2", Window("weekly", "", 80, Resets))],
                [Device("d1", ("codex", "m", 1.0)), Device("d2", ("codex", "m", 2.0))]);

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            await fixture.SaveAsync(
                Later, [Provider("codex", "b", "d2", Window("weekly", "", 79, Resets))], [Device("d1", ("codex", "m", 1.0)), Device("d2", ("codex", "m", 3.0))]);

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            (await fixture.HubAccountsAsync()).Select(row => row.AccountKey).ShouldBe(["a", "b"], ignoreOrder: true);
            (await fixture.WindowsAsync()).Select(row => row.AccountKey).ShouldBe(["a", "b"], ignoreOrder: true);
            (await fixture.CountAsync("limit_window_baseline_costs WHERE account_key = 'a'")).ShouldBe(2);
            (await fixture.CountAsync("limit_window_baseline_costs WHERE account_key = 'b'")).ShouldBe(2);
        }

        [Fact]
        public async Task AccountsOfTheSameProvider_KeepSeparateBaselinesAsync()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            using var fixture = await SavedHub.CreateAsync();

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            await fixture.SaveAsync(
                Start,
                [Provider("codex", "a", "d1", Window("weekly", "", 90, Resets)), Provider("codex", "b", "d2", Window("weekly", "", 80, Resets))],
                [Device("d1", ("codex", "m", 1.0)), Device("d2", ("codex", "m", 2.0))]);

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            (await fixture.CountAsync("limit_window_baseline_costs WHERE account_key = 'a'")).ShouldBe(2);
            (await fixture.CountAsync("limit_window_baseline_costs WHERE account_key = 'b'")).ShouldBe(2);
            (await fixture.CountAsync("hub_accounts")).ShouldBe(2);
        }
    }

    public sealed class HubAccounts
    {
        [Fact]
        public async Task SourceDeviceId_IsSavedAndUpdatedAsync()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            using var fixture = await SavedHub.CreateAsync();
            await fixture.SaveAsync(Start, [Provider("codex", "a", "d1", Window("weekly", "", 90, Resets))], [Device("d1", ("codex", "m", 1.0))]);

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            var first = await fixture.HubAccountsAsync();
            await fixture.SaveAsync(Later, [Provider("codex", "a", "d2", Window("weekly", "", 89, Resets))], [Device("d1", ("codex", "m", 1.0))]);
            var second = await fixture.HubAccountsAsync();

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            first.Select(row => row.SourceDeviceId).ShouldBe(["d1"]);
            second.Select(row => row.SourceDeviceId).ShouldBe(["d2"]);
        }

        [Fact]
        public async Task MissingSourceDeviceId_IsStoredAsNullAsync()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            using var fixture = await SavedHub.CreateAsync();

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            await fixture.SaveAsync(Start, [Provider("codex", "a", null, Window("weekly", "", 90, Resets))], [Device("d1", ("codex", "m", 1.0))]);

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            (await fixture.HubAccountsAsync()).Single().SourceDeviceId.ShouldBeNull();
        }

        [Fact]
        public async Task ProviderWithoutAMeterWindow_HasNoAccountRowAsync()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            using var fixture = await SavedHub.CreateAsync();
            var hidden = new Dictionary<string, object?>(Window("weekly", "", 90, Resets)) { ["showMeter"] = false };

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            await fixture.SaveAsync(Start, [Provider("codex", "a", "d1", hidden)], [Device("d1", ("codex", "m", 1.0))]);

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            (await fixture.CountAsync("hub_accounts")).ShouldBe(0);
            (await fixture.CountAsync("latest_limit_windows")).ShouldBe(0);
        }
    }

    public sealed class EstimateFromSavedState
    {
        [Fact]
        public async Task SingleGroup_EstimatesFromTheProviderWideCostIncreaseAsync()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            using var fixture = await SavedHub.CreateAsync();
            await fixture.SaveAsync(
                Start, [Provider("codex", "a", "d1", Window("session", "", 100, Resets))], [Device("d1", ("codex", "m", 1.0)), Device("d2", ("codex", "m", 1.0))]);

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            await fixture.SaveAsync(
                Later, [Provider("codex", "a", "d1", Window("session", "", 96, Resets))], [Device("d1", ("codex", "m", 1.5)), Device("d2", ("codex", "m", 1.34))]);
            var window = (await fixture.OverviewAsync()).Single();

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            // 増加は 0.5 + 0.34 = 0.84 を使用率4pt。
            window.Estimate.ShouldBe(EstimateStatus.Estimated);
            window.EstimatedLimitUsd.ShouldNotBeNull().ShouldBe(21, 1e-9);
        }

        [Fact]
        public async Task JustAfterTheBaseline_IsEstimatingAsync()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            using var fixture = await SavedHub.CreateAsync();

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            await fixture.SaveAsync(Start, [Provider("codex", "a", "d1", Window("session", "", 100, Resets))], [Device("d1", ("codex", "m", 1.0))]);
            var window = (await fixture.OverviewAsync()).Single();

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            window.Estimate.ShouldBe(EstimateStatus.Estimating);
            window.EstimatedLimitUsd.ShouldBeNull();
            window.UnavailableReason.ShouldBeNull();
        }

        [Fact]
        public async Task MultipleGroups_AreIndependentOfEachOthersUsageAsync()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            using var fixture = await SavedHub.CreateAsync();
            var gemini = Window("weekly", "Gemini weekly", 100, Resets);
            var claude = Window("weekly", "Claude/GPT weekly", 100, Resets);
            await fixture.SaveAsync(
                Start,
                [Provider("antigravity", "a", "d1", gemini, claude)],
                [Device("d1", ("antigravity", "gemini-3.8-flash", 10.0), ("antigravity", "claude-sonnet-5-5-medium", 2.0))]);

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            await fixture.SaveAsync(
                Later,
                [Provider("antigravity", "a", "d1", Window("weekly", "Gemini weekly", 97, Resets), Window("weekly", "Claude/GPT weekly", 95, Resets))],
                [Device("d1", ("antigravity", "gemini-3.8-flash", 10.3), ("antigravity", "claude-sonnet-5-5-medium", 7.0))]);
            var windows = (await fixture.OverviewAsync()).ToDictionary(window => window.Label!);

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            windows["Gemini weekly"].EstimatedLimitUsd.ShouldNotBeNull().ShouldBe(10, 1e-9);
            windows["Claude/GPT weekly"].EstimatedLimitUsd.ShouldNotBeNull().ShouldBe(100, 1e-9);
        }

        [Fact]
        public async Task AccountsSharingASourceDevice_AreUnavailableAsync()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            using var fixture = await SavedHub.CreateAsync();

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            await fixture.SaveAsync(
                Start,
                [Provider("codex", "a", "d1", Window("weekly", "", 90, Resets)), Provider("codex", "b", "d1", Window("weekly", "", 80, Resets))],
                [Device("d1", ("codex", "m", 1.0))]);
            var windows = await fixture.OverviewAsync();

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            windows.ShouldAllBe(window => window.Estimate == EstimateStatus.Unavailable);
            windows.ShouldAllBe(window => window.UnavailableReason == UnavailableReason.SharedSourceDevice);
        }
    }

    // ---- 偽の受信データと実DBの照会 ----

    private static Dictionary<string, object?> Window(string kind, string label, double remaining, string resetsAt) => new()
    {
        ["kind"] = kind,
        ["label"] = label,
        ["showMeter"] = true,
        ["remainingPercent"] = remaining,
        ["usedPercent"] = 100 - remaining,
        ["resetsAt"] = resetsAt,
    };

    private static Dictionary<string, object?> Provider(
        string provider, string account, string? sourceDeviceId, params Dictionary<string, object?>[] windows) => new()
    {
        ["provider"] = provider,
        ["accountKey"] = account,
        ["accountLabel"] = $"Account {account}",
        ["planLabel"] = "Pro",
        ["sourceDeviceId"] = sourceDeviceId,
        ["windows"] = windows,
    };

    private sealed record FakeDevice(string DeviceId, Dictionary<string, Dictionary<string, long>> Tokens, Dictionary<string, Dictionary<string, double>> Costs);

    private static FakeDevice Device(string deviceId, params (string Tool, string Model, double Cost)[] costs)
    {
        var tokens = new Dictionary<string, Dictionary<string, long>>();
        var costTable = new Dictionary<string, Dictionary<string, double>>();
        foreach (var (tool, model, cost) in costs)
        {
            if (!tokens.TryGetValue(tool, out var tokenModels)) tokens[tool] = tokenModels = [];
            if (!costTable.TryGetValue(tool, out var costModels)) costTable[tool] = costModels = [];
            tokenModels[model] = 1;
            costModels[model] = cost;
        }

        return new FakeDevice(deviceId, tokens, costTable);
    }

    private sealed record WindowRow(string AccountKey, string Kind, string LimitKey, string BaseReceivedAt, double BaseRemaining, double Remaining);

    private sealed record HubAccountRow(string AccountKey, string? SourceDeviceId);

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

        internal Task SaveAsync(string receivedAt, Dictionary<string, object?>[] providers, FakeDevice[] devices)
        {
            object AllTime(FakeDevice device) => new
            {
                totalTokens = 1,
                clientModels = device.Tokens,
                clientModelCosts = device.Costs,
            };
            // 1つ目の計測点は allTime の累計だけを使うことを確かめるため、today・month には別の値を入れる。
            object Distractor() => new
            {
                totalTokens = 1,
                clientModels = new { codex = new { decoy = 1 } },
                clientModelCosts = new { codex = new { decoy = 1000 } },
            };
            var data = JsonSerializer.Serialize(new
            {
                type = "stats",
                reason = "snapshot",
                at = receivedAt,
                stats = new
                {
                    updatedAt = receivedAt,
                    periods = new { today = Distractor(), month = Distractor(), allTime = Distractor() },
                    devices = devices.Select(device => new
                    {
                        deviceId = device.DeviceId,
                        hostname = $"host-{device.DeviceId}",
                        updatedAt = receivedAt,
                        stale = false,
                        periods = new { today = Distractor(), month = Distractor(), allTime = AllTime(device) },
                        periodWindows = new
                        {
                            today = new { endsAt = "2099-01-01T00:00:00.000Z" },
                            month = new { endsAt = "2099-01-01T00:00:00.000Z" },
                        },
                    }),
                    limits = new { updatedAt = receivedAt, providers },
                },
            });
            return HubStateStore.SaveAsync(Database, "hub", HubNotification.Parse("snapshot", data), receivedAt);
        }

        internal async Task<(string Device, string Model, double Cost)[]> BaselineAsync(string kind, string limitKey)
        {
            await using var connection = await Database.OpenAsync();
            return (await connection.QueryAsync<(string, string, double)>(
                """
                SELECT device_id, model, cost_usd FROM limit_window_baseline_costs
                WHERE kind = @kind AND limit_key = @limitKey ORDER BY device_id, model
                """,
                new { kind, limitKey })).ToArray();
        }

        internal async Task<WindowRow[]> WindowsAsync()
        {
            await using var connection = await Database.OpenAsync();
            return (await connection.QueryAsync<WindowRow>(
                """
                SELECT account_key AS AccountKey, kind AS Kind, limit_key AS LimitKey, base_received_at AS BaseReceivedAt,
                       base_remaining_percent AS BaseRemaining, remaining_percent AS Remaining
                FROM latest_limit_windows ORDER BY account_key, kind, limit_key
                """)).ToArray();
        }

        internal async Task<HubAccountRow[]> HubAccountsAsync()
        {
            await using var connection = await Database.OpenAsync();
            return (await connection.QueryAsync<HubAccountRow>(
                "SELECT account_key AS AccountKey, source_device_id AS SourceDeviceId FROM hub_accounts ORDER BY account_key")).ToArray();
        }

        internal async Task<long> CountAsync(string fromAndWhere)
        {
            await using var connection = await Database.OpenAsync();
            return await connection.ExecuteScalarAsync<long>($"SELECT COUNT(*) FROM {fromAndWhere}");
        }

        internal async Task<IReadOnlyList<MultiTokenMonitor.Presentation.Http.OverviewLimitWindowOutput>> OverviewAsync() =>
            (await OverviewQuery.ReadAsync(Database)).LimitWindows;

        public void Dispose()
        {
            if (Directory.Exists(directory)) Directory.Delete(directory, true);
        }
    }
}
