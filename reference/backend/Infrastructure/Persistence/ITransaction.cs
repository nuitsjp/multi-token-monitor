using Microsoft.Data.Sqlite;

namespace NotesSample.Infrastructure.Persistence;

internal interface ITransaction : IAsyncDisposable
{
    SqliteConnection Connection { get; }

    Task CommitAsync();

    Task RollbackAsync();
}
