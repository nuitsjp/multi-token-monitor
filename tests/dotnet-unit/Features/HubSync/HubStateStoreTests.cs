using System.Text.Json;
using Dapper;
using MultiTokenMonitor.Features.HubSync;
using MultiTokenMonitor.Infrastructure.Configuration;
using MultiTokenMonitor.Infrastructure.Persistence;
using Shouldly;
using Xunit;

namespace MultiTokenMonitor.UnitTests.Features.HubSync;

public sealed class HubStateStoreTests
{
    public sealed class SaveAsync
    {
        [Theory]
        [InlineData("2026-09-25T15:00:00.000Z", "2026-09-25T14:59:59.999Z", true)]
        [InlineData("2026-09-25T15:00:00.000Z", "2026-09-25T15:00:00.000Z", false)]
        [InlineData("2026-09-25T15:00:00.000Z", "2026-09-25T15:00:00.001Z", false)]
        public async Task PeriodWindowEndsAt_ExpiresTodayOnceReceivedTimeReachesEndsAtAsync(
            string endsAt, string receivedAt, bool todayKept)
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            using var fixture = await SavedHub.CreateAsync();
            var periodWindows = new { today = new { endsAt }, month = new { endsAt = "2026-10-31T15:00:00.000Z" } };

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            await fixture.SaveAsync("2026-09-25T10:00:00.000Z", periodWindows, receivedAt);

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            (await fixture.PeriodsAsync()).ShouldBe(todayKept ? ["all_time", "month", "today"] : ["all_time", "month"]);
        }

        [Theory]
        [InlineData("2026-09-25T23:59:59.999Z", "2026-09-25T00:00:00.000Z", new[] { "all_time", "month", "today" })]
        [InlineData("2026-09-24T23:59:59.999Z", "2026-09-25T00:00:00.000Z", new[] { "all_time", "month" })]
        [InlineData("2026-08-31T23:59:59.999Z", "2026-09-01T00:00:00.000Z", new[] { "all_time" })]
        [InlineData("2026-09-25T08:00:00.000+09:00", "2026-09-24T23:30:00.000Z", new[] { "all_time", "month", "today" })]
        public async Task WithoutPeriodWindows_ComparesUtcDateAndMonthAsync(
            string updatedAt, string receivedAt, string[] expected)
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            using var fixture = await SavedHub.CreateAsync();

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            await fixture.SaveAsync(updatedAt, null, receivedAt);

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            (await fixture.PeriodsAsync()).ShouldBe(expected);
        }
    }

    private sealed class SavedHub : IDisposable
    {
        private readonly string directory = Path.Combine(Path.GetTempPath(), $"aidd-hub-state-{Guid.NewGuid():N}");
        private Database database = null!;

        internal static async Task<SavedHub> CreateAsync()
        {
            var fixture = new SavedHub();
            fixture.database = new Database(Path.Combine(fixture.directory, "app.sqlite"));
            await fixture.database.InitializeAsync();
            await HubStateStore.RegisterHubsAsync(
                fixture.database, [new HubConnection("hub", "Hub", new Uri("http://127.0.0.1"), "token")]);
            return fixture;
        }

        internal Task SaveAsync(string updatedAt, object? periodWindows, string receivedAt)
        {
            object Period() => new
            {
                totalTokens = 1,
                clientModels = new { codex = new { model = 1 } },
                clientModelCosts = new { },
            };
            var device = new Dictionary<string, object?>
            {
                ["deviceId"] = "device",
                ["hostname"] = "host",
                ["updatedAt"] = updatedAt,
                ["stale"] = false,
                ["periods"] = new { today = Period(), month = Period(), allTime = Period() },
            };
            if (periodWindows is not null) device["periodWindows"] = periodWindows;
            var data = JsonSerializer.Serialize(new
            {
                type = "stats",
                reason = "snapshot",
                at = receivedAt,
                stats = new
                {
                    updatedAt = receivedAt,
                    periods = new { today = Period(), month = Period(), allTime = Period() },
                    devices = new[] { device },
                    limits = new { updatedAt = receivedAt, providers = Array.Empty<object>() },
                },
            });
            return HubStateStore.SaveAsync(database, "hub", HubNotification.Parse("snapshot", data), receivedAt);
        }

        internal async Task<string[]> PeriodsAsync()
        {
            await using var connection = await database.OpenAsync();
            return (await connection.QueryAsync<string>(
                "SELECT period FROM latest_token_usages WHERE hub_id = 'hub' ORDER BY period")).ToArray();
        }

        public void Dispose()
        {
            if (Directory.Exists(directory)) Directory.Delete(directory, true);
        }
    }
}
