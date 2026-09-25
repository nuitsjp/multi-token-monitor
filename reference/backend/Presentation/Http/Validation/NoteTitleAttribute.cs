using NotesSample.Domain.Notes;
using System.ComponentModel.DataAnnotations;

namespace NotesSample.Presentation.Http.Validation;

internal sealed class NoteTitleAttribute : ValidationAttribute
{
    public override bool IsValid(object? value) => NoteRules.IsValidTitle(value as string);

    public override string FormatErrorMessage(string name) => NoteRules.TitleMessage;
}
