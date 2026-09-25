using System.Text.Json.Serialization;

namespace NotesSample.Features.Notes;

internal sealed record BulkInput(
    [property: JsonRequired] string Titles,
    [property: JsonRequired] string Body);
