using NotesSample.Application;
using NotesSample.Application.Authentication;
using NotesSample.Domain.Notes;
using NotesSample.Infrastructure.Authentication;
using NotesSample.Infrastructure.Persistence;
using Dapper;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.Sqlite;

namespace NotesSample.Features.Notes;

internal sealed class ListNotes
{
    internal ListNotes(Database database)
    {
        Presentation = new PresentationLayer(new ApplicationLayer(database));
    }

    internal PresentationLayer Presentation { get; }

    internal void Map(WebApplication app, IdentityService identity)
    {
        app.MapGet("/api/notes", async (HttpRequest request) =>
        {
            var principal = await identity.RequireAsync(request);
            return TypedResults.Ok(await Presentation.ExecuteAsync(principal));
        })
        .WithName(nameof(ListNotes))
        .Produces<IReadOnlyList<Note>>(StatusCodes.Status200OK)
        .Produces<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")
        .Produces<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")
        .Produces<ProblemDetails>(StatusCodes.Status500InternalServerError, "application/problem+json");
    }

    internal sealed class PresentationLayer(IApplicationLayer<ListNotesRequest, IReadOnlyList<Note>> application)
    {
        internal Task<IReadOnlyList<Note>> ExecuteAsync(Principal principal) =>
            application.ExecuteAsync(principal, new ListNotesRequest());
    }

    internal sealed class ApplicationLayer(Database database)
        : IApplicationLayer<ListNotesRequest, IReadOnlyList<Note>>
    {
        public async Task<IReadOnlyList<Note>> ExecuteAsync(Principal principal, ListNotesRequest input)
        {
            await using var connection = await database.OpenAsync();
            return await PersistenceLayer.ReadAllAsync(connection, principal.Id);
        }
    }

    internal static class PersistenceLayer
    {
        internal static async Task<IReadOnlyList<Note>> ReadAllAsync(SqliteConnection connection, string ownerId) =>
            (await connection.QueryAsync<Note>(
                """
                SELECT
                    id AS Id,
                    title AS Title,
                    body AS Body,
                    version AS Version,
                    updated_at AS UpdatedAt
                FROM
                    notes
                WHERE
                    owner_id = @ownerId
                ORDER BY
                    updated_at DESC, id
                """,
                new { ownerId })).AsList();
    }
}

internal sealed record ListNotesRequest;
