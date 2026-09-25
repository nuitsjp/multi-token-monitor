using Dapper;
using Microsoft.AspNetCore.Http;
using NotesSample.Application.Authentication;
using NotesSample.Domain;
using NotesSample.Infrastructure.Authentication;
using NotesSample.Infrastructure.Persistence;
using Shouldly;
using Xunit;

namespace NotesSample.UnitTests.Infrastructure.Authentication;

public sealed class IdentityServiceTests
{
    public sealed class ResolveAsync
    {
        [Fact]
        public async Task ProxyWithValidIdentity_ReturnsPrincipalAndEnsuresUserAsync()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            using var fixture = await CreateDatabaseAsync();
            var identity = new IdentityService(fixture.Database, "proxy");
            var context = new DefaultHttpContext();
            context.Request.Headers["X-Authenticated-User"] = "alice@example.com";

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            var result = await identity.ResolveAsync(context.Request);

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            result.ShouldBe(new Principal("alice@example.com", "alice@example.com"));
            await using var connection = await fixture.Database.OpenAsync();
            (await connection.ExecuteScalarAsync<string>(
                "SELECT name FROM users WHERE id = @Id", new { Id = "alice@example.com" }))
                .ShouldBe("alice@example.com");
        }

        [Fact]
        public async Task ProxyWithKnownIdentity_DoesNotWriteUserAgainAsync()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            using var fixture = await CreateDatabaseAsync();
            var identity = new IdentityService(fixture.Database, "proxy");
            var context = new DefaultHttpContext();
            context.Request.Headers["X-Authenticated-User"] = "alice@example.com";
            await identity.ResolveAsync(context.Request);
            await using var connection = await fixture.Database.OpenAsync();
            await connection.ExecuteAsync("DELETE FROM users WHERE id = @Id", new { Id = "alice@example.com" });

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            var result = await identity.ResolveAsync(context.Request);

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            result.ShouldBe(new Principal("alice@example.com", "alice@example.com"));
            (await connection.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM users WHERE id = @Id", new { Id = "alice@example.com" }))
                .ShouldBe(0);
        }

        [Fact]
        public async Task ProxyWithInvalidIdentity_ReturnsNullAsync()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            using var fixture = await CreateDatabaseAsync();
            var identity = new IdentityService(fixture.Database, "proxy");
            var context = new DefaultHttpContext();
            context.Request.Headers["X-Authenticated-User"] = "alice user";

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            var result = await identity.ResolveAsync(context.Request);

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            result.ShouldBeNull();
        }
    }

    public sealed class RequireAsync
    {
        [Fact]
        public async Task UnknownSession_ThrowsUnauthenticatedFaultAsync()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            using var fixture = await CreateDatabaseAsync();
            var identity = new IdentityService(fixture.Database, "demo");
            var context = new DefaultHttpContext();

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            var error = await Record.ExceptionAsync(() => identity.RequireAsync(context.Request));

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            error.ShouldBeOfType<AppFaultException>().Code.ShouldBe("UNAUTHENTICATED");
        }
    }

    public sealed class EnsureUserAsync
    {
        [Fact]
        public async Task ExistingUser_UpdatesNameWithoutDuplicateAsync()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            using var fixture = await CreateDatabaseAsync();
            await using (var seedConnection = await fixture.Database.OpenAsync())
            {
                await seedConnection.ExecuteAsync("INSERT INTO users (id, name) VALUES ('alice', 'Old Alice')");
            }

            var identity = new IdentityService(fixture.Database, "proxy");
            var user = new Principal("alice", "Alice");

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            var result = await identity.EnsureUserAsync(user);

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            result.ShouldBe(user);
            await using var connection = await fixture.Database.OpenAsync();
            (await connection.ExecuteScalarAsync<string>(
                "SELECT name FROM users WHERE id = 'alice'")).ShouldBe("Alice");
            (await connection.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM users WHERE id = 'alice'")).ShouldBe(1);
        }
    }

    public sealed class SignInAsync
    {
        [Fact]
        public async Task InvalidDemoUser_ThrowsValidationFaultAsync()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            using var fixture = await CreateDatabaseAsync();
            var identity = new IdentityService(fixture.Database, "demo");
            var context = new DefaultHttpContext();

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            var error = await Record.ExceptionAsync(() =>
                identity.SignInAsync(context.Request, context.Response, "charlie"));

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            error.ShouldBeOfType<AppFaultException>().Code.ShouldBe("VALIDATION");
        }
    }

    [Fact]
    public async Task DemoSignInResolveAndSignOut_WorkTogetherAsync()
    {
        // -------------------------------------------------------------
        // Arrange
        // -------------------------------------------------------------
        using var fixture = await CreateDatabaseAsync();
        var identity = new IdentityService(fixture.Database, "demo");
        var signInContext = new DefaultHttpContext();
        var resolveContext = new DefaultHttpContext();
        var signOutContext = new DefaultHttpContext();

        // -------------------------------------------------------------
        // Act
        // -------------------------------------------------------------
        var signedIn = await identity.SignInAsync(signInContext.Request, signInContext.Response, "alice");
        var sessionCookie = signInContext.Response.Headers["Set-Cookie"].ToString().Split(';', 2)[0];
        resolveContext.Request.Headers["Cookie"] = sessionCookie;
        var resolved = await identity.ResolveAsync(resolveContext.Request);
        signOutContext.Request.Headers["Cookie"] = sessionCookie;
        identity.SignOut(signOutContext.Request, signOutContext.Response);
        var resolvedAfterSignOut = await identity.ResolveAsync(signOutContext.Request);

        // -------------------------------------------------------------
        // Assert
        // -------------------------------------------------------------
        signedIn.ShouldBe(new Principal("alice", "Alice"));
        sessionCookie.ShouldStartWith("aidd_session=");
        resolved.ShouldBe(new Principal("alice", "Alice"));
        resolvedAfterSignOut.ShouldBeNull();
    }

    private static async Task<TestDatabase> CreateDatabaseAsync()
    {
        var fixture = new TestDatabase();
        await fixture.Database.InitializeAsync();
        return fixture;
    }

    private sealed class TestDatabase : IDisposable
    {
        private readonly string directory = System.IO.Path.Combine(
            System.IO.Path.GetTempPath(), $"aidd-identity-{Guid.NewGuid():N}");

        internal TestDatabase()
        {
            Database = new Database(System.IO.Path.Combine(directory, "app.sqlite"));
        }

        internal Database Database { get; }

        public void Dispose() => Directory.Delete(directory, true);
    }
}
