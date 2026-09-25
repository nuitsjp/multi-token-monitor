using NotesSample.Infrastructure.Persistence;

namespace NotesSample.IntegrationTests;

internal sealed class TestSqliteDatabase : IDisposable
{
    private readonly string directory = System.IO.Path.Combine(
        System.IO.Path.GetTempPath(), $"aidd-dotnet-{Guid.NewGuid():N}");

    private TestSqliteDatabase()
    {
        Path = System.IO.Path.Combine(directory, "app.sqlite");
        Database = new Database(Path);
    }

    internal string Path { get; }
    internal Database Database { get; }

    internal static async Task<TestSqliteDatabase> CreateAsync()
    {
        var fixture = new TestSqliteDatabase();
        await fixture.Database.InitializeAsync();
        return fixture;
    }

    public void Dispose() => Directory.Delete(directory, true);
}
