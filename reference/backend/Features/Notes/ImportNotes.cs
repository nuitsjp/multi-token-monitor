using NotesSample.Application;
using NotesSample.Application.Authentication;
using NotesSample.Infrastructure.Authentication;
using NotesSample.Infrastructure.Notifications;
using NotesSample.Infrastructure.Persistence;
using NotesSample.Presentation.Http;
using Microsoft.AspNetCore.Mvc;

namespace NotesSample.Features.Notes;

internal sealed class ImportNotes
{
    internal ImportNotes(
        Database database,
        ChangeNotifications notifications,
        IApplicationLayer<BulkInput, BulkPreview> preview)
    {
        Presentation = new PresentationLayer(new ApplicationLayer(database, notifications, preview));
    }

    internal PresentationLayer Presentation { get; }

    internal void Map(WebApplication app, IdentityService identity)
    {
        app.MapAuthenticatedPost<BulkInput, BulkResult>(
            "/api/notes/import",
            "ImportNotes",
            identity,
            Presentation.ExecuteAsync)
            .Produces<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json");
    }

    internal sealed class PresentationLayer(IApplicationLayer<BulkInput, BulkResult> application)
    {
        internal Task<BulkResult> ExecuteAsync(Principal principal, BulkInput input) =>
            application.ExecuteAsync(principal, input);
    }

    internal sealed class ApplicationLayer(
        Database database,
        ChangeNotifications notifications,
        IApplicationLayer<BulkInput, BulkPreview> preview) : IApplicationLayer<BulkInput, BulkResult>
    {
        public async Task<BulkResult> ExecuteAsync(Principal principal, BulkInput input)
        {
            var prepared = await preview.ExecuteAsync(principal, input);
            await using var transaction = await database.BeginTransactionAsync();
            try
            {
                foreach (var title in prepared.Titles)
                {
                    await NotePersistence.InsertAsync(transaction.Connection, principal.Id, title, prepared.Body);
                }

                await transaction.CommitAsync();
            }
            catch (Exception error)
            {
                throw NotePersistence.TranslateError(error);
            }

            notifications.Publish(principal.Id);
            return new BulkResult(prepared.Titles.Count);
        }
    }
}

internal sealed record BulkResult(int Count);
