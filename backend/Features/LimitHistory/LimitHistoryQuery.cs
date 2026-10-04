using System.Globalization;
using MultiTokenMonitor.Infrastructure.Persistence;
using MultiTokenMonitor.Presentation.Http;

namespace MultiTokenMonitor.Features.LimitHistory;

internal static class LimitHistoryQuery
{
    // 段階2の暫定: 契約単位の集計は段階4で実装する。それまでは契約も記録も返さない（画面は固定データで確認する）。
    internal static Task<LimitHistoryOutput> ReadAsync(Database database)
    {
        _ = database;
        return Task.FromResult(new LimitHistoryOutput(
            DateTime.Today.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), [], []));
    }
}
