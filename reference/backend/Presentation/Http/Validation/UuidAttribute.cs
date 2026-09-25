using System.ComponentModel.DataAnnotations;

namespace NotesSample.Presentation.Http.Validation;

internal sealed class UuidAttribute : ValidationAttribute
{
    public override bool IsValid(object? value) =>
        value is null || value is string id && JsonRequest.IsUuid(id);

    public override string FormatErrorMessage(string name) => "IDの形式を確認してください。";
}
