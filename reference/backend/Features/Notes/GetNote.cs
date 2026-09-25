using NotesSample.Application;
using NotesSample.Application.Authentication;
using NotesSample.Domain;
using NotesSample.Domain.Notes;
using NotesSample.Infrastructure.Authentication;
using NotesSample.Infrastructure.Persistence;
using NotesSample.Presentation.Http;
using Microsoft.AspNetCore.Mvc;

namespace NotesSample.Features.Notes;

internal sealed class GetNote
{
    internal GetNote(Database database)
    {
        Presentation = new PresentationLayer(new ApplicationLayer(database));
    }

    internal PresentationLayer Presentation { get; }

    internal void Map(WebApplication app, IdentityService identity)
    {
        app.MapGet("/api/notes/{id}", async (string id, HttpRequest request) =>
        {
            if (!JsonRequest.IsUuid(id))
            {
                throw AppFaultException.Validation();
            }

            var principal = await identity.RequireAsync(request);
            return TypedResults.Ok(await Presentation.ExecuteAsync(principal, id));
        })
        .WithName(nameof(GetNote))
        .Produces<Note>(StatusCodes.Status200OK)
        .Produces<HttpValidationProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")
        .Produces<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")
        .Produces<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")
        .Produces<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")
        .Produces<ProblemDetails>(StatusCodes.Status500InternalServerError, "application/problem+json");
    }

    internal sealed class PresentationLayer(IApplicationLayer<string, Note> application)
    {
        internal Task<Note> ExecuteAsync(Principal principal, string id) => application.ExecuteAsync(principal, id);
    }

    internal sealed class ApplicationLayer(Database database) : IApplicationLayer<string, Note>
    {
        public async Task<Note> ExecuteAsync(Principal principal, string id)
        {
            await using var connection = await database.OpenAsync();
            return await NotePersistence.ReadAsync(connection, principal.Id, id)
                ?? throw new AppFaultException("NOT_FOUND", "対象のメモが見つかりません。");
        }
    }
}
