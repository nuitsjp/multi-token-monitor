using System.Text.Json.Serialization;

namespace NotesSample.Presentation.Http;

internal sealed record SessionOutput(NotesSample.Application.Authentication.Principal? User, string Mode);
internal sealed record SignInOutput(NotesSample.Application.Authentication.Principal User);
internal sealed record SuccessOutput(bool Ok);
internal sealed record DemoSignInInput([property: JsonRequired] string User);
internal sealed record HealthOutput(string Status);
