namespace NotesSample.Infrastructure.Notifications;

internal sealed class ChangeNotifications
{
    private readonly object gate = new();
    private readonly Dictionary<string, List<Action>> listeners = [];
    private readonly Action<Exception> reportError;

    internal ChangeNotifications(Action<Exception> reportError)
    {
        this.reportError = reportError;
    }

    internal IDisposable Subscribe(string ownerId, Action listener)
    {
        lock (gate)
        {
            if (!listeners.TryGetValue(ownerId, out var ownerListeners))
            {
                ownerListeners = [];
                listeners.Add(ownerId, ownerListeners);
            }

            ownerListeners.Add(listener);
        }

        return new Subscription(this, ownerId, listener);
    }

    internal void Publish(string ownerId)
    {
        Action[] snapshot;
        lock (gate)
        {
            snapshot = listeners.TryGetValue(ownerId, out var ownerListeners) ? [.. ownerListeners] : [];
        }

        foreach (var listener in snapshot)
        {
            try
            {
                listener();
            }
            catch (Exception error)
            {
                reportError(error);
            }
        }
    }

    private void Remove(string ownerId, Action listener)
    {
        lock (gate)
        {
            if (!listeners.TryGetValue(ownerId, out var ownerListeners))
            {
                return;
            }

            ownerListeners.Remove(listener);
            if (ownerListeners.Count == 0)
            {
                listeners.Remove(ownerId);
            }
        }
    }

    private sealed class Subscription(ChangeNotifications owner, string ownerId, Action listener) : IDisposable
    {
        private ChangeNotifications? owner = owner;

        public void Dispose()
        {
            Interlocked.Exchange(ref owner, null)?.Remove(ownerId, listener);
        }
    }
}
