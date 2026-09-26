namespace MultiTokenMonitor.Infrastructure.Notifications;

// 保存確定の合図をプロセス内の購読者へ配る。利用者は1人のため購読者を区別しない。
internal sealed class ChangeNotifications(ILogger<ChangeNotifications> logger)
{
    private readonly object gate = new();
    private readonly List<Action> listeners = [];

    internal IDisposable Subscribe(Action listener)
    {
        lock (gate)
        {
            listeners.Add(listener);
        }

        return new Subscription(this, listener);
    }

    internal void Publish()
    {
        Action[] snapshot;
        lock (gate)
        {
            snapshot = [.. listeners];
        }

        foreach (var listener in snapshot)
        {
            // 購読側の失敗で確定済みの保存を失敗扱いにしない。
            try
            {
                listener();
            }
            catch (Exception error)
            {
                logger.LogWarning(error, "変更通知に失敗しました");
            }
        }
    }

    private void Remove(Action listener)
    {
        lock (gate)
        {
            listeners.Remove(listener);
        }
    }

    private sealed class Subscription(ChangeNotifications owner, Action listener) : IDisposable
    {
        private ChangeNotifications? owner = owner;

        public void Dispose()
        {
            Interlocked.Exchange(ref owner, null)?.Remove(listener);
        }
    }
}
