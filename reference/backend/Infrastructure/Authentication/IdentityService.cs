using NotesSample.Infrastructure.Persistence;
using NotesSample.Application.Authentication;
using NotesSample.Domain;
using System.Collections.Concurrent;
using System.Collections.Frozen;
using System.Security.Cryptography;
using System.Text.RegularExpressions;
using Dapper;
using Microsoft.Data.Sqlite;

namespace NotesSample.Infrastructure.Authentication;

internal sealed partial class IdentityService
{
    private const string CookieName = "aidd_session";
    private static readonly FrozenDictionary<string, string> DemoUsers =
        new Dictionary<string, string>(StringComparer.Ordinal) { ["alice"] = "Alice", ["bob"] = "Bob" }
            .ToFrozenDictionary(StringComparer.Ordinal);
    private readonly Database database;
    private readonly string authMode;
    private readonly ConcurrentDictionary<string, Session> sessions = new(StringComparer.Ordinal);
    private readonly ConcurrentDictionary<string, Principal> proxyUsers = new(StringComparer.Ordinal);

    internal IdentityService(Database database, string authMode)
    {
        this.database = database;
        this.authMode = authMode;
    }

    internal async Task<Principal?> ResolveAsync(HttpRequest request)
    {
        if (authMode == "proxy")
        {
            var id = request.Headers["X-Authenticated-User"].ToString();
            if (!AuthenticatedUserPattern().IsMatch(id))
            {
                return null;
            }

            // 利用者の登録は初回だけ行い、読み取りの要求ごとにDBへ書き込まない。
            if (!proxyUsers.TryGetValue(id, out var user))
            {
                user = await EnsureUserAsync(new Principal(id, id));
                proxyUsers[id] = user;
            }

            return user;
        }

        if (!request.Cookies.TryGetValue(CookieName, out var key) || !sessions.TryGetValue(key, out var session))
        {
            return null;
        }

        if (session.Expires <= DateTimeOffset.UtcNow)
        {
            sessions.TryRemove(key, out _);
            return null;
        }

        return session.User;
    }

    internal async Task<Principal> RequireAsync(HttpRequest request) =>
        await ResolveAsync(request) ?? throw new AppFaultException("UNAUTHENTICATED", "利用者を確認できません。");

    internal async Task<Principal> SignInAsync(HttpRequest request, HttpResponse response, string id)
    {
        if (authMode != "demo" || !DemoUsers.TryGetValue(id, out var name))
        {
            throw AppFaultException.Validation("参照用ユーザーが不正です。");
        }

        var now = DateTimeOffset.UtcNow;
        foreach (var session in sessions)
        {
            if (session.Value.Expires <= now)
            {
                sessions.TryRemove(session.Key, out _);
            }
        }

        if (request.Cookies.TryGetValue(CookieName, out var previous))
        {
            sessions.TryRemove(previous, out _);
        }

        if (sessions.Count >= 100)
        {
            throw new AppFaultException("VALIDATION", "参照用セッションの上限です。");
        }

        var user = await EnsureUserAsync(new Principal(id, name));
        var token = Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(32));
        sessions[token] = new Session(user, now.AddHours(8));
        response.Cookies.Append(CookieName, token, new CookieOptions
        {
            HttpOnly = true,
            SameSite = SameSiteMode.Strict,
            Secure = false,
            Path = "/",
            MaxAge = TimeSpan.FromHours(8),
        });
        return user;
    }

    internal void SignOut(HttpRequest request, HttpResponse response)
    {
        if (request.Cookies.TryGetValue(CookieName, out var key))
        {
            sessions.TryRemove(key, out _);
        }

        response.Cookies.Delete(CookieName, new CookieOptions { Path = "/" });
    }

    internal async Task<Principal> EnsureUserAsync(Principal user)
    {
        await using var connection = await database.OpenAsync();
        await connection.ExecuteAsync("""
            INSERT INTO users (id, name)
            VALUES
                (@id, @name)
            ON CONFLICT (id) DO UPDATE
            SET
                name = excluded.name
            WHERE
                users.name <> excluded.name
            """, new { id = user.Id, name = user.Name });
        return user;
    }

    [GeneratedRegex("^[a-zA-Z0-9@._:+/-]{1,128}$", RegexOptions.CultureInvariant)]
    private static partial Regex AuthenticatedUserPattern();

    private sealed record Session(Principal User, DateTimeOffset Expires);
}
