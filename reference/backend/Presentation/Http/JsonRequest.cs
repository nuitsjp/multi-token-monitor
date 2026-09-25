
namespace NotesSample.Presentation.Http;

internal static class JsonRequest
{
    internal static bool IsUuid(string value) =>
        value.Length == 36 &&
        value[8] == '-' && value[13] == '-' && value[18] == '-' && value[23] == '-' &&
        Guid.TryParseExact(value, "D", out _);

}
