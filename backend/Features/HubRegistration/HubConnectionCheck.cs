using System.Net;
using System.Net.Http.Headers;

namespace MultiTokenMonitor.Features.HubRegistration;

// 保存の前に、入力された接続先へ認証トークンで接続できるかを確かめる。最初の全体状態は待たない。
internal static class HubConnectionCheck
{
    internal static readonly TimeSpan Timeout = TimeSpan.FromSeconds(10);

    private static readonly HttpClient Client = new(new SocketsHttpHandler { AllowAutoRedirect = false })
    {
        Timeout = System.Threading.Timeout.InfiniteTimeSpan,
    };

    // 条件とメッセージは、接続するHubを管理するユースケースの共通の受け入れ条件に従う。成功なら null を返す。
    internal static async Task<string?> CheckAsync(Uri origin, string token, CancellationToken cancellationToken)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(Timeout);
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, new Uri(origin, "/api/stats/stream"));
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("text/event-stream"));
            request.Headers.Add("x-token-monitor-stream", "2");
            using var response = await Client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, timeout.Token);
            return response.StatusCode switch
            {
                HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden => "The hub rejected the token.",
                _ when response.IsSuccessStatusCode => null,
                _ => "Could not connect to the hub.",
            };
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return "Could not connect to the hub.";
        }
        catch (HttpRequestException)
        {
            return "Could not connect to the hub.";
        }
    }
}
