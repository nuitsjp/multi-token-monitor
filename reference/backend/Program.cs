using NotesSample.Hosting;

namespace NotesSample;

public static class Program
{
    public static Task<int> Main(string[] args) => AppHost.RunAsync(args);
}
