using NotesSample.Infrastructure.Configuration;
using Shouldly;
using Xunit;

namespace NotesSample.UnitTests.Infrastructure.Configuration;

public sealed class AppConfigTests
{
    private static readonly object EnvironmentGate = new();

    public sealed class FromEnvironment
    {
        [Fact]
        public void ExplicitEnvironmentValues_AreMapped()
        {
            lock (AppConfigTests.EnvironmentGate)
            {
                // -------------------------------------------------------------
                // Arrange
                // -------------------------------------------------------------
                var databasePath = Path.Combine(Path.GetTempPath(), "aidd-project-template", "app.sqlite");
                using var environment = new EnvironmentVariables(
                    ("HOST", "::1"),
                    ("PORT", "65535"),
                    ("DB_PATH", databasePath),
                    ("AUTH_MODE", "proxy"),
                    ("PUBLIC_ORIGIN", "https://example.test"),
                    ("DEV_ORIGINS", " https://app.test,https://admin.test,https://app.test "));

                // -------------------------------------------------------------
                // Act
                // -------------------------------------------------------------
                var result = AppConfig.FromEnvironment();

                // -------------------------------------------------------------
                // Assert
                // -------------------------------------------------------------
                result.Host.ShouldBe("::1");
                result.Port.ShouldBe(65535);
                result.DatabasePath.ShouldBe(Path.GetFullPath(databasePath));
                result.AuthMode.ShouldBe("proxy");
                result.PublicOrigin.ShouldBe(new Uri("https://example.test"));
                result.AllowedOrigins.SetEquals(["https://app.test", "https://admin.test"]).ShouldBeTrue();
            }
        }
    }

    public sealed class FromValues
    {
        [Fact]
        public void MissingValues_UseSafeDefaults()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            var databasePath = Path.GetFullPath("./data/app.sqlite");
            var webRootPath = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "wwwroot"));

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            var result = AppConfig.FromValues(_ => null);

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            result.Host.ShouldBe("127.0.0.1");
            result.Port.ShouldBe(3000);
            result.DatabasePath.ShouldBe(databasePath);
            result.AuthMode.ShouldBe("demo");
            result.PublicOrigin.ShouldBeNull();
            result.AllowedOrigins.ShouldBeEmpty();
            result.WebRootPath.ShouldBe(webRootPath);
        }

        [Fact]
        public void ExplicitValues_AreMappedAndAllowedOriginsAreNormalized()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            var databasePath = Path.Combine(Path.GetTempPath(), "aidd-project-template", "app.sqlite");

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            var result = AppConfig.FromValues(AppConfigTests.Values(
                ("HOST", "::1"),
                ("PORT", "65535"),
                ("DB_PATH", databasePath),
                ("AUTH_MODE", "proxy"),
                ("PUBLIC_ORIGIN", "https://example.test"),
                ("DEV_ORIGINS", " https://app.test, ,https://admin.test,https://app.test ")));

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            result.Host.ShouldBe("::1");
            result.Port.ShouldBe(65535);
            result.DatabasePath.ShouldBe(Path.GetFullPath(databasePath));
            result.AuthMode.ShouldBe("proxy");
            result.PublicOrigin.ShouldBe(new Uri("https://example.test"));
            result.AllowedOrigins.SetEquals(["https://app.test", "https://admin.test"]).ShouldBeTrue();
        }

        [Theory]
        [InlineData("0", 0)]
        [InlineData("65535", 65535)]
        public void InclusivePortBounds_AreAccepted(string port, int expected)
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            var values = AppConfigTests.Values(("PORT", port));

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            var result = AppConfig.FromValues(values);

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            result.Port.ShouldBe(expected);
        }

        [Theory]
        [InlineData("0.0.0.0")]
        [InlineData("localhost")]
        public void NonLoopbackHost_ThrowsInvalidOperationException(string host)
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            var values = AppConfigTests.Values(("HOST", host));

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            var error = Record.Exception(() => AppConfig.FromValues(values));

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            error.ShouldBeOfType<InvalidOperationException>().Message.ShouldContain("loopback");
        }

        [Theory]
        [InlineData("")]
        [InlineData("-1")]
        [InlineData("65536")]
        [InlineData("not-a-number")]
        public void InvalidPort_ThrowsInvalidOperationException(string port)
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            var values = AppConfigTests.Values(("PORT", port));

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            var error = Record.Exception(() => AppConfig.FromValues(values));

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            error.ShouldBeOfType<InvalidOperationException>().Message.ShouldContain("PORT");
        }

        [Fact]
        public void UnsupportedAuthMode_ThrowsInvalidOperationException()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            var values = AppConfigTests.Values(("AUTH_MODE", "basic"));

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            var error = Record.Exception(() => AppConfig.FromValues(values));

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            error.ShouldBeOfType<InvalidOperationException>().Message.ShouldContain("AUTH_MODE");
        }

        [Theory]
        [InlineData("example.test")]
        [InlineData("https://example.test/")]
        [InlineData("https://example.test/path")]
        [InlineData("https://example.test?query=1")]
        [InlineData("https://example.test#fragment")]
        public void PublicOriginWithPathOrWithoutAbsoluteAuthority_ThrowsInvalidOperationException(string origin)
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            var values = AppConfigTests.Values(("PUBLIC_ORIGIN", origin));

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            var error = Record.Exception(() => AppConfig.FromValues(values));

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            error.ShouldBeOfType<InvalidOperationException>().Message.ShouldContain("PUBLIC_ORIGIN");
        }

        [Theory]
        [InlineData(null)]
        [InlineData("http://example.test")]
        public void ProxyModeWithoutHttpsOrigin_ThrowsInvalidOperationException(string? origin)
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            var values = origin is null
                ? AppConfigTests.Values(("AUTH_MODE", "proxy"))
                : AppConfigTests.Values(("AUTH_MODE", "proxy"), ("PUBLIC_ORIGIN", origin));

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            var error = Record.Exception(() => AppConfig.FromValues(values));

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            error.ShouldBeOfType<InvalidOperationException>().Message.ShouldContain("HTTPS");
        }

        [Fact]
        public void DatabasePathInsideWebRoot_ThrowsInvalidOperationException()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            var webRootPath = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "wwwroot"));
            var databasePaths = new[] { webRootPath, Path.Combine(webRootPath, "app.sqlite") };

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            var errors = databasePaths
                .Select(path => Record.Exception(() => AppConfig.FromValues(AppConfigTests.Values(("DB_PATH", path)))))
                .ToArray();

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            foreach (var error in errors)
            {
                error.ShouldBeOfType<InvalidOperationException>().Message.ShouldContain("Web");
            }
        }
    }

    public sealed class DatabasePathFromEnvironment
    {
        [Fact]
        public void ConfiguredPath_IsResolvedToFullPath()
        {
            lock (AppConfigTests.EnvironmentGate)
            {
                // -------------------------------------------------------------
                // Arrange
                // -------------------------------------------------------------
                using var environment = new EnvironmentVariables(("DB_PATH", "data/config.sqlite"));
                var expected = Path.GetFullPath("data/config.sqlite");

                // -------------------------------------------------------------
                // Act
                // -------------------------------------------------------------
                var result = AppConfig.DatabasePathFromEnvironment();

                // -------------------------------------------------------------
                // Assert
                // -------------------------------------------------------------
                result.ShouldBe(expected);
            }
        }

        [Fact]
        public void MissingPath_UsesDefaultPath()
        {
            lock (AppConfigTests.EnvironmentGate)
            {
                // -------------------------------------------------------------
                // Arrange
                // -------------------------------------------------------------
                using var environment = new EnvironmentVariables(("DB_PATH", null));
                var expected = Path.GetFullPath("./data/app.sqlite");

                // -------------------------------------------------------------
                // Act
                // -------------------------------------------------------------
                var result = AppConfig.DatabasePathFromEnvironment();

                // -------------------------------------------------------------
                // Assert
                // -------------------------------------------------------------
                result.ShouldBe(expected);
            }
        }
    }

    public sealed class BindAddress
    {
        [Theory]
        [InlineData("127.0.0.1", "127.0.0.1")]
        [InlineData("::1", "::1")]
        public void Host_IsParsedAsIPAddress(string host, string expected)
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            var config = AppConfig.FromValues(AppConfigTests.Values(("HOST", host)));

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            var result = config.BindAddress;

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            result.ToString().ShouldBe(expected);
        }
    }

    private static Func<string, string?> Values(params (string Name, string? Value)[] entries)
    {
        var values = entries.ToDictionary(entry => entry.Name, entry => entry.Value, StringComparer.Ordinal);
        return name => values.GetValueOrDefault(name);
    }

    private sealed class EnvironmentVariables : IDisposable
    {
        private readonly Dictionary<string, string?> previousValues = new(StringComparer.Ordinal);

        public EnvironmentVariables(params (string Name, string? Value)[] values)
        {
            foreach (var (name, value) in values)
            {
                if (!previousValues.ContainsKey(name))
                {
                    previousValues.Add(name, Environment.GetEnvironmentVariable(name));
                }

                Environment.SetEnvironmentVariable(name, value);
            }
        }

        public void Dispose()
        {
            foreach (var (name, value) in previousValues)
            {
                Environment.SetEnvironmentVariable(name, value);
            }
        }
    }
}
