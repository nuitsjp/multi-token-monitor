using MultiTokenMonitor.Hosting;

namespace MultiTokenMonitor;

public static class Program
{
    public static Task<int> Main(string[] args) => AppHost.RunAsync(args);
}
