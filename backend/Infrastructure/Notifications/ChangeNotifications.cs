namespace MultiTokenMonitor.Infrastructure.Notifications;

// 保存確定の合図をプロセス内の購読者へ配る。利用者は1人のため購読者を区別しない。
// 購読者は、保存済みの状態全体の変更を null、Hubの時刻だけの更新をその内容で受け取る。
internal sealed class ChangeNotifications(ILogger<ChangeNotifications> logger)
{
    private readonly object gate = new();
    private readonly List<Action<HubFreshnessChanged?>> listeners = [];

    internal IDisposable Subscribe(Action<HubFreshnessChanged?> listener)
    {
        lock (gate)
        {
            listeners.Add(listener);
        }

        return new Subscription(this, listener);
    }

    internal void Publish() => Dispatch(null);

    internal void PublishFreshness(HubFreshnessChanged change) => Dispatch(change);

    private void Dispatch(HubFreshnessChanged? change)
    {
        Action<HubFreshnessChanged?>[] snapshot;
        lock (gate)
        {
            snapshot = [.. listeners];
        }

        foreach (var listener in snapshot)
        {
            // 購読側の失敗で確定済みの保存を失敗扱いにしない。
            try
            {
                listener(change);
            }
            catch (Exception error)
            {
                logger.LogWarning(error, "変更通知に失敗しました");
            }
        }
    }

    private void Remove(Action<HubFreshnessChanged?> listener)
    {
        lock (gate)
        {
            listeners.Remove(listener);
        }
    }

    private sealed class Subscription(ChangeNotifications owner, Action<HubFreshnessChanged?> listener) : IDisposable
    {
        private ChangeNotifications? owner = owner;

        public void Dispose()
        {
            Interlocked.Exchange(ref owner, null)?.Remove(listener);
        }
    }
}

// 利用量を含めず、Hubと端末の時刻・古さだけを運ぶ。
internal sealed record HubFreshnessChanged(
    string HubId,
    string ReceivedAt,
    string UpdatedAt,
    IReadOnlyList<DeviceFreshnessChanged> Devices);

internal sealed record DeviceFreshnessChanged(string DeviceId, string UpdatedAt, bool Stale);
