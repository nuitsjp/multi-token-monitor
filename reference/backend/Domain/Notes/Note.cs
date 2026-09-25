namespace NotesSample.Domain.Notes;

internal sealed record Note(string Id, string Title, string Body, long Version, string UpdatedAt);
