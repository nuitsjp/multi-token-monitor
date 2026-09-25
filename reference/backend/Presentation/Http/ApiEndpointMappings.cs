using NotesSample.Application.Authentication;
using NotesSample.Infrastructure.Authentication;
using Microsoft.AspNetCore.Mvc;

namespace NotesSample.Presentation.Http;

internal static class ApiEndpointMappings
{
    internal static RouteHandlerBuilder MapAuthenticatedPost<TRequest, TResponse>(
        this WebApplication app,
        string pattern,
        string operationName,
        IdentityService identity,
        Func<Principal, TRequest, Task<TResponse>> execute)
        where TRequest : class
    {
        var builder = app.MapPost(pattern, async (HttpContext context, TRequest request) =>
        {
            var principal = await identity.RequireAsync(context.Request);
            return TypedResults.Ok(await execute(principal, request));
        })
        .WithName(operationName)
        .Produces<TResponse>(StatusCodes.Status200OK)
        .Produces<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json");

        return ProducesCommonPostErrors(builder);
    }

    internal static RouteHandlerBuilder MapAnonymousPost<TRequest, TResponse>(
        this WebApplication app,
        string pattern,
        string operationName,
        Func<HttpContext, TRequest, Task<TResponse>> execute)
        where TRequest : class
    {
        var builder = app.MapPost(pattern, async (HttpContext context, TRequest request) =>
            TypedResults.Ok(await execute(context, request)))
            .WithName(operationName)
            .Produces<TResponse>(StatusCodes.Status200OK);

        return ProducesCommonPostErrors(builder);
    }

    internal static RouteHandlerBuilder ProducesCommonPostErrors(this RouteHandlerBuilder builder) => builder
        .Produces<HttpValidationProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")
        .Produces<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")
        .Produces<ProblemDetails>(StatusCodes.Status413PayloadTooLarge, "application/problem+json")
        .Produces<ProblemDetails>(StatusCodes.Status415UnsupportedMediaType, "application/problem+json")
        .Produces<ProblemDetails>(StatusCodes.Status500InternalServerError, "application/problem+json");
}
