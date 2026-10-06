using System.Net;
using System.Net.Sockets;
using System.Text;
using MultiTokenMonitor.Features.HubRegistration;
using Shouldly;
using Xunit;

namespace MultiTokenMonitor.UnitTests.Features.HubRegistration;

public sealed class HubConnectionCheckTests
{
    [Theory]
    [InlineData(200, null)]
    [InlineData(401, "The hub rejected the token.")]
    [InlineData(403, "The hub rejected the token.")]
    [InlineData(404, "Could not connect to the hub.")]
    [InlineData(500, "Could not connect to the hub.")]
    [InlineData(302, "Could not connect to the hub.")]
    public async Task Response_IsMappedToTheMessageAsync(int status, string? message)
    {
        using var server = StatusServer.Start(status);

        var result = await HubConnectionCheck.CheckAsync(server.Origin, "secret", CancellationToken.None);

        result.ShouldBe(message);
        var request = await server.Request;
        request.ShouldStartWith("GET /api/stats/stream ");
        request.ShouldContain("Authorization: Bearer secret");
    }

    [Fact]
    public async Task UnreachableOrigin_ReportsConnectionFailureAsync()
    {
        var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;
        listener.Stop();

        var result = await HubConnectionCheck.CheckAsync(new Uri($"http://127.0.0.1:{port}"), "secret", CancellationToken.None);

        result.ShouldBe("Could not connect to the hub.");
    }

    [Fact]
    public async Task CallerCancellation_IsNotReportedAsConnectionFailureAsync()
    {
        using var server = StatusServer.Start(200);
        using var cancellation = new CancellationTokenSource();
        await cancellation.CancelAsync();

        await Should.ThrowAsync<OperationCanceledException>(() =>
            HubConnectionCheck.CheckAsync(server.Origin, "secret", cancellation.Token));
    }

    // 受けた要求の先頭を記録し、指定したステータスの本文なしの応答を1回返す。
    private sealed class StatusServer : IDisposable
    {
        private readonly TcpListener listener;

        private StatusServer(TcpListener listener, Task<string> request)
        {
            this.listener = listener;
            Request = request;
        }

        internal Uri Origin => new($"http://127.0.0.1:{((IPEndPoint)listener.LocalEndpoint).Port}");

        internal Task<string> Request { get; }

        internal static StatusServer Start(int status)
        {
            var listener = new TcpListener(IPAddress.Loopback, 0);
            listener.Start();
            return new StatusServer(listener, Task.Run(async () =>
            {
                using var client = await listener.AcceptTcpClientAsync();
                var stream = client.GetStream();
                var received = new StringBuilder();
                var buffer = new byte[1024];
                while (!received.ToString().Contains("\r\n\r\n"))
                    received.Append(Encoding.ASCII.GetString(buffer, 0, await stream.ReadAsync(buffer)));
                var response = $"HTTP/1.1 {status} X\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
                await stream.WriteAsync(Encoding.ASCII.GetBytes(response));
                return received.ToString();
            }));
        }

        public void Dispose() => listener.Stop();
    }
}
