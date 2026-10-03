using Dapper;
using MultiTokenMonitor.Features.HubUsage;
using MultiTokenMonitor.Infrastructure.Persistence;
using Shouldly;
using Xunit;

namespace MultiTokenMonitor.UnitTests.Features.HubUsage;

public sealed class HubUsageQueryTests
{
    [Fact]
    public async Task ReadAsync_ReturnsRegisteredHubsAndDomainHistoryWithoutReadingRawStats()
    {
        var directory = Path.Combine(Path.GetTempPath(), "multi-token-monitor-hub-query-" + Guid.NewGuid().ToString("N"));
        var database = new Database(Path.Combine(directory, "app.sqlite"));
        try
        {
            await database.InitializeAsync();
            await database.InTransactionAsync(connection => connection.ExecuteAsync(
                """
                INSERT INTO hubs VALUES ('first', 'Z Hub', 1), ('second', 'A Hub', 0);
                INSERT INTO hub_states VALUES ('first', 'not-json-secret', '2026-10-03T03:42:00Z');
                INSERT INTO devices VALUES ('first', 'desktop', 'Desktop', 'Windows 11', '2026-10-03T03:41:00Z', 0),
                                           ('first', 'no-history', 'Laptop', NULL, '2026-10-03T01:00:00Z', 1);
                INSERT INTO device_daily_model_usages VALUES
                    ('first', 'desktop', '2026-10-01', 'Model A', 1234567, 2.5),
                    ('first', 'desktop', '2026-10-02', 'Model B', 20, NULL);
                """));

            var result = await HubUsageQuery.ReadAsync(database);

            result.Hubs.Select(hub => hub.HubId).ShouldBe(["first", "second"]);
            var first = result.Hubs[0];
            first.Connected.ShouldBeTrue();
            first.Devices.Count.ShouldBe(2);
            first.Devices.Single(device => device.DeviceId == "no-history").Stale.ShouldBeTrue();
            first.Days.Count.ShouldBe(2);
            first.Days[0].Tokens.ShouldBe(1234567);
            first.Days[1].CostUsd.ShouldBeNull();
            result.Hubs[1].ReceivedAt.ShouldBeNull();
            result.Hubs[1].Days.ShouldBeEmpty();
            await database.InReadTransactionAsync(async connection =>
            {
                (await connection.ExecuteScalarAsync<string>("SELECT stats_json FROM hub_states WHERE hub_id='first'"))
                    .ShouldBe("not-json-secret");
                return true;
            });
        }
        finally
        {
            Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
            if (Directory.Exists(directory)) Directory.Delete(directory, recursive: true);
        }
    }
}
