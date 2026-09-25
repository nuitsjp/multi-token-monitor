namespace NotesSample.Domain;

internal sealed class AppFaultException : Exception
{
    internal AppFaultException(string code, string message)
        : base(message)
    {
        Code = code;
    }

    internal string Code { get; }

    internal static AppFaultException Validation(string message = "入力の形式を確認してください。") =>
        new("VALIDATION", message);
}
