using Dapper;
using Microsoft.Data.Sqlite;

namespace NotesSample.Infrastructure.Persistence;

internal sealed class DatabaseTransaction(SqliteConnection connection) : ITransaction
{
    private bool completed;

    public SqliteConnection Connection { get; } = connection;

    public async Task CommitAsync()
    {
        if (completed) return;
        await Connection.ExecuteAsync("COMMIT;");
        completed = true;
    }

    public async Task RollbackAsync()
    {
        if (completed) return;
        await Connection.ExecuteAsync("ROLLBACK;");
        completed = true;
    }

    public async ValueTask DisposeAsync()
    {
        try
        {
            await RollbackAsync();
        }
        finally
        {
            await Connection.DisposeAsync();
        }
    }
}
