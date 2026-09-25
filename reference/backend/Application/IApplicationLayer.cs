using NotesSample.Application.Authentication;

namespace NotesSample.Application;

internal interface IApplicationLayer<TRequest, TResult>
{
    Task<TResult> ExecuteAsync(Principal principal, TRequest input);
}
