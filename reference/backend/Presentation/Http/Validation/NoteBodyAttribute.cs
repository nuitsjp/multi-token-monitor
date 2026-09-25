using NotesSample.Domain.Notes;
using System.ComponentModel.DataAnnotations;

namespace NotesSample.Presentation.Http.Validation;

internal sealed class NoteBodyAttribute : ValidationAttribute
{
    public override bool IsValid(object? value) => NoteRules.IsValidBody(value as string);

    public override string FormatErrorMessage(string name) => NoteRules.BodyMessage;
}
