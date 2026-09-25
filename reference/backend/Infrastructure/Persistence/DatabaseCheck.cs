namespace NotesSample.Infrastructure.Persistence;

internal sealed record DatabaseCheck(int Version, IReadOnlyList<string> Result)
{
    internal bool IsHealthy => Result.Count > 0 && Result.All(value => value == "ok");
}
