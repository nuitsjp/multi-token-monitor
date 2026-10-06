using Dapper;
using MultiTokenMonitor.Features.HubRegistration;
using MultiTokenMonitor.Infrastructure.Persistence;
using Shouldly;
using Xunit;

namespace MultiTokenMonitor.UnitTests.Features.HubRegistration;

public sealed class HubRegistryTests
{
    public sealed class Validate
    {
        [Theory]
        [InlineData("https://hub.example.com")]
        [InlineData("http://10.0.0.5:8080")]
        [InlineData("https://hub.example.com/")]
        [InlineData("  http://localhost:3000  ")]
        public void Origin_IsAccepted(string url)
        {
            var (errors, origin) = HubRegistry.Validate("Hub", url, "token");

            errors.ShouldBeEmpty();
            origin.ShouldNotBeNull();
        }

        [Theory]
        [InlineData("")]
        [InlineData("hub.example.com")]
        [InlineData("ftp://hub.example.com")]
        [InlineData("https://hub.example.com/path")]
        [InlineData("https://hub.example.com?x=1")]
        [InlineData("https://hub.example.com#x")]
        [InlineData("https://user@hub.example.com")]
        public void NotAnOrigin_IsRejected(string url)
        {
            var (errors, origin) = HubRegistry.Validate("Hub", url, "token");

            errors.Keys.ShouldBe(["url"]);
            errors["url"].ShouldBe(["Enter a URL like http(s)://host[:port]."]);
            origin.ShouldBeNull();
        }

        [Fact]
        public void EveryInvalidField_ReportsItsOwnMessage()
        {
            var (errors, _) = HubRegistry.Validate("  ", "x", "a\nb");

            errors["name"].ShouldBe(["Enter a name."]);
            errors["url"].ShouldBe(["Enter a URL like http(s)://host[:port]."]);
            errors["token"].ShouldBe(["Enter a valid token."]);
        }

        [Theory]
        [InlineData(null)]
        [InlineData("")]
        [InlineData("   ")]
        [InlineData("a\u0007b")]
        public void BlankOrControlToken_IsRejected(string? token)
        {
            var (errors, _) = HubRegistry.Validate("Hub", "https://hub.example.com", token);

            errors.Keys.ShouldBe(["token"]);
        }
    }

    public sealed class Storage
    {
        [Fact]
        public async Task NoHubs_AreListedAsEmptyAsync()
        {
            using var fixture = await Fixture.CreateAsync();

            (await HubRegistry.ListAsync(fixture.Database)).ShouldBeEmpty();
            (await HubRegistry.LoadConnectionsAsync(fixture.Database)).ShouldBeEmpty();
        }

        [Fact]
        public async Task AddedHubs_AreListedInRegistrationOrderWithoutTokenAsync()
        {
            using var fixture = await Fixture.CreateAsync();
            var first = await HubRegistry.AddAsync(fixture.Database, " Same ", new Uri("https://a.example.com"), " secret ");
            var second = await HubRegistry.AddAsync(fixture.Database, "Same", new Uri("https://a.example.com"), "other");

            var listed = await HubRegistry.ListAsync(fixture.Database);

            first.Id.ShouldNotBe(second.Id);
            Guid.TryParse(first.Id, out _).ShouldBeTrue();
            first.Name.ShouldBe("Same");
            first.Token.ShouldBe("secret");
            listed.Select(hub => hub.HubId).ShouldBe([first.Id, second.Id]);
            listed.ShouldAllBe(hub => hub.Url == "https://a.example.com" && hub.Status == "notReceived");
        }

        [Fact]
        public async Task Status_FollowsConnectionAndReceivedStateAsync()
        {
            using var fixture = await Fixture.CreateAsync();
            var received = await HubRegistry.AddAsync(fixture.Database, "A", new Uri("https://a.example.com"), "t");
            var lost = await HubRegistry.AddAsync(fixture.Database, "B", new Uri("https://b.example.com"), "t");
            await using (var connection = await fixture.Database.OpenAsync())
            {
                await connection.ExecuteAsync(
                    "INSERT INTO hub_states (hub_id, stats_json, received_at) VALUES (@Id, '{}', 't')", new { received.Id });
                await connection.ExecuteAsync("UPDATE hubs SET connected = 0 WHERE hub_id = @Id", new { lost.Id });
            }

            var listed = await HubRegistry.ListAsync(fixture.Database);

            listed.Select(hub => hub.Status).ShouldBe(["connected", "reconnecting"]);
        }

        [Fact]
        public async Task HubsWithoutConnectionInfo_AreNotReceivedAndStayReconnectingAsync()
        {
            using var fixture = await Fixture.CreateAsync();
            var added = await HubRegistry.AddAsync(fixture.Database, "A", new Uri("https://a.example.com"), "t");
            await using (var connection = await fixture.Database.OpenAsync())
            {
                // 移行前から存在するHubは接続情報が空文字で、起動前は受信中だった。
                await connection.ExecuteAsync("INSERT INTO hubs (hub_id, name, connected) VALUES ('old', 'Old', 1)");
            }

            await HubRegistry.ResetReceiveStatusAsync(fixture.Database);

            (await HubRegistry.LoadConnectionsAsync(fixture.Database)).Select(hub => hub.Id).ShouldBe([added.Id]);
            (await HubRegistry.ListAsync(fixture.Database)).Select(hub => (hub.HubId, hub.Status))
                .ShouldBe([(added.Id, "notReceived"), ("old", "reconnecting")]);
        }

        [Fact]
        public async Task Update_KeepsIdAndOrderAndMarksChangedConnectionAsReceivingAsync()
        {
            using var fixture = await Fixture.CreateAsync();
            var first = await HubRegistry.AddAsync(fixture.Database, "A", new Uri("https://a.example.com"), "t1");
            var second = await HubRegistry.AddAsync(fixture.Database, "B", new Uri("https://b.example.com"), "t2");
            await using (var connection = await fixture.Database.OpenAsync())
                await connection.ExecuteAsync("UPDATE hubs SET connected = 0 WHERE hub_id = @Id", new { first.Id });

            await HubRegistry.UpdateAsync(fixture.Database, first with { Name = "A2", Origin = new Uri("https://c.example.com"), Token = "t3" }, connectionChanged: true);

            var stored = await HubRegistry.FindAsync(fixture.Database, first.Id);
            stored.ShouldBe(new StoredHub(first.Id, "A2", "https://c.example.com", "t3"));
            (await HubRegistry.ListAsync(fixture.Database)).Select(hub => (hub.HubId, hub.Name, hub.Status))
                .ShouldBe([(first.Id, "A2", "notReceived"), (second.Id, "B", "notReceived")]);
        }

        [Fact]
        public async Task Update_WithoutConnectionChange_KeepsReceiveStatusAsync()
        {
            using var fixture = await Fixture.CreateAsync();
            var hub = await HubRegistry.AddAsync(fixture.Database, "A", new Uri("https://a.example.com"), "t");
            await using (var connection = await fixture.Database.OpenAsync())
                await connection.ExecuteAsync("UPDATE hubs SET connected = 0 WHERE hub_id = @Id", new { hub.Id });

            await HubRegistry.UpdateAsync(fixture.Database, hub with { Name = "Renamed" }, connectionChanged: false);

            (await HubRegistry.ListAsync(fixture.Database)).Select(item => (item.Name, item.Status))
                .ShouldBe([("Renamed", "reconnecting")]);
        }

        [Fact]
        public async Task Find_ReturnsNullForUnknownHubAndEmptyConnectionForMigratedHubAsync()
        {
            using var fixture = await Fixture.CreateAsync();
            await using (var connection = await fixture.Database.OpenAsync())
                await connection.ExecuteAsync("INSERT INTO hubs (hub_id, name, connected) VALUES ('old', 'Old', 1)");

            (await HubRegistry.FindAsync(fixture.Database, "missing")).ShouldBeNull();
            (await HubRegistry.FindAsync(fixture.Database, "old")).ShouldBe(new StoredHub("old", "Old", "", ""));
        }
    }
    private sealed class Fixture : IDisposable
    {
        private readonly string directory = Path.Combine(Path.GetTempPath(), $"aidd-registry-unit-{Guid.NewGuid():N}");

        private Fixture() => Database = new Database(Path.Combine(directory, "app.sqlite"));

        internal Database Database { get; }

        internal static async Task<Fixture> CreateAsync()
        {
            var fixture = new Fixture();
            await fixture.Database.InitializeAsync();
            return fixture;
        }

        public void Dispose()
        {
            if (Directory.Exists(directory)) Directory.Delete(directory, true);
        }
    }
}
