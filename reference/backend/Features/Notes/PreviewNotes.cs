using NotesSample.Application;
using NotesSample.Application.Authentication;
using NotesSample.Domain;
using NotesSample.Domain.Notes;
using NotesSample.Infrastructure.Authentication;
using NotesSample.Presentation.Http;

namespace NotesSample.Features.Notes;

internal sealed class PreviewNotes
{
    internal PreviewNotes()
    {
        Application = new ApplicationLayer();
        Presentation = new PresentationLayer(Application);
    }

    internal ApplicationLayer Application { get; }

    internal PresentationLayer Presentation { get; }

    internal void Map(WebApplication app, IdentityService identity) =>
        app.MapAuthenticatedPost<BulkInput, BulkPreview>(
            "/api/notes/preview",
            "PreviewNotes",
            identity,
            Presentation.ExecuteAsync);

    internal sealed class PresentationLayer(IApplicationLayer<BulkInput, BulkPreview> application)
    {
        internal Task<BulkPreview> ExecuteAsync(Principal principal, BulkInput input) =>
            application.ExecuteAsync(principal, input);
    }

    internal sealed class ApplicationLayer : IApplicationLayer<BulkInput, BulkPreview>
    {
        public Task<BulkPreview> ExecuteAsync(Principal principal, BulkInput input) =>
            Task.FromResult(Prepare(input));

        private static BulkPreview Prepare(BulkInput input)
        {
            NoteRules.ValidateBody(input.Body);
            var rawTitles = input.Titles.Split('\n')
                .Select(line => line.EndsWith('\r') ? line[..^1] : line)
                .Where(line => line.Trim().Length > 0).ToArray();
            if (rawTitles.Length is < 1 or > 100)
            {
                throw AppFaultException.Validation("タイトルは1〜100件で入力してください。");
            }

            var titles = rawTitles.Select(title => title.Trim()).ToArray();
            foreach (var title in titles)
            {
                NoteRules.ValidateTitle(title);
            }

            if (titles.Distinct(StringComparer.Ordinal).Count() != titles.Length)
            {
                throw AppFaultException.Validation("入力内でタイトルが重複しています。");
            }

            return new BulkPreview(titles, input.Body);
        }
    }
}

internal sealed record BulkPreview(IReadOnlyList<string> Titles, string Body);
