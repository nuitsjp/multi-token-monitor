using NotesSample.Domain;
using System.Text;

namespace NotesSample.Domain.Notes;

internal static class NoteRules
{
    internal const string TitleMessage = "タイトルは1〜100文字で入力してください。";
    internal const string BodyMessage = "本文は10,000文字以内で入力してください。";

    internal static void ValidateTitle(string value)
    {
        if (!IsValidTitle(value))
        {
            throw AppFaultException.Validation(TitleMessage);
        }
    }

    internal static void ValidateBody(string value)
    {
        if (!IsValidBody(value))
        {
            throw AppFaultException.Validation(BodyMessage);
        }
    }

    // タイトルは前後の空白を除いて保存するため、除いた後の文字数で判定する。
    internal static bool IsValidTitle(string? value) =>
        value?.Trim() is { Length: > 0 } title && title.EnumerateRunes().Count() <= 100;

    internal static bool IsValidBody(string? value) =>
        value is not null && value.EnumerateRunes().Count() <= 10_000;
}
