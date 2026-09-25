using NotesSample.Presentation.Http;
using NotesSample.Presentation.Http.Validation;
using NotesSample.Application;
using NotesSample.Application.Authentication;
using NotesSample.Infrastructure.Persistence;
using NotesSample.Infrastructure.Notifications;
using NotesSample.Infrastructure.Authentication;
using NotesSample.Domain.Notes;
using Dapper;
using Microsoft.Data.Sqlite;
using Microsoft.AspNetCore.Mvc;
using System.ComponentModel.DataAnnotations;
using System.Diagnostics.CodeAnalysis;
using System.Text.Json.Serialization;

namespace NotesSample.Features.Notes;

internal sealed class SaveNote
{
    internal SaveNote(Database database, ChangeNotifications notifications)
    {
        Presentation = new PresentationLayer(
            new ApplicationLayer(database, notifications));
    }

    internal PresentationLayer Presentation { get; }

    internal void Map(WebApplication app, IdentityService identity)
    {
        // 属性検証を適用するため、入力型を明示したハンドラーで登録する。
        app.MapPost("/api/notes/save", async (HttpContext context, SaveNoteRequest request) =>
            await Presentation.HandleAsync(await identity.RequireAsync(context.Request), request))
            .WithName(nameof(SaveNote))
            .Produces<SaveNoteResponse>(StatusCodes.Status200OK)
            .Produces<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")
            .Produces<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")
            .Produces<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")
            .ProducesCommonPostErrors();
    }

    internal sealed class PresentationLayer(IApplicationLayer<SaveNoteRequest, SaveResult> application)
    {
        internal async Task<IResult> HandleAsync(Principal principal, SaveNoteRequest request) =>
            await application.ExecuteAsync(principal, request) switch
            {
                SaveResult.Success success => TypedResults.Ok(success.Response),
                SaveResult.NotFound => TypedResults.Problem(
                    statusCode: StatusCodes.Status404NotFound,
                    title: "メモが見つかりません。",
                    detail: "対象のメモが見つかりません。"),
                SaveResult.Conflict => TypedResults.Problem(
                    statusCode: StatusCodes.Status409Conflict,
                    title: "更新が競合しました。",
                    detail: "別の操作で更新されています。下書きを保持したまま、最新版を確認してください。"),
                _ => throw new InvalidOperationException("未対応の保存結果です。"),
            };
    }

    internal sealed class ApplicationLayer(Database database, ChangeNotifications notifications)
        : IApplicationLayer<SaveNoteRequest, SaveResult>
    {
        public async Task<SaveResult> ExecuteAsync(Principal principal, SaveNoteRequest input)
        {
            var ownerId = principal.Id;
            var title = input.Title.Trim();
            await using var transaction = await database.BeginTransactionAsync();
            Note saved;
            try
            {
                if (input.Version is not null)
                {
                    var current = await NotePersistence.ReadAsync(transaction.Connection, ownerId, input.Id!);
                    if (current is null)
                    {
                        return new SaveResult.NotFound();
                    }

                    if (current.Version != input.Version)
                    {
                        return new SaveResult.Conflict();
                    }

                    saved = await PersistenceLayer.UpdateAsync(transaction.Connection, ownerId,
                        current with { Title = title, Body = input.Body });
                }
                else
                {
                    saved = await NotePersistence.InsertAsync(transaction.Connection, ownerId, title, input.Body);
                }

                await transaction.CommitAsync();
            }
            catch (Exception error)
            {
                throw NotePersistence.TranslateError(error);
            }

            notifications.Publish(principal.Id);
            return new SaveResult.Success(
                new SaveNoteResponse(saved.Id, saved.Title, saved.Body, saved.Version, saved.UpdatedAt));
        }
    }

    internal static class PersistenceLayer
    {
        internal static Task<Note> UpdateAsync(SqliteConnection connection, string ownerId, Note note) =>
            connection.QuerySingleAsync<Note>(
                """
                UPDATE notes
                SET
                    title = @Title,
                    body = @Body,
                    version = version + 1,
                    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                WHERE
                    owner_id = @OwnerId AND id = @Id
                RETURNING
                    id AS Id,
                    title AS Title,
                    body AS Body,
                    version AS Version,
                    updated_at AS UpdatedAt
                """,
                new
                {
                    OwnerId = ownerId,
                    note.Id,
                    note.Title,
                    note.Body,
                });
    }

    internal abstract record SaveResult
    {
        internal sealed record Success(SaveNoteResponse Response) : SaveResult;
        internal sealed record NotFound : SaveResult;
        internal sealed record Conflict : SaveResult;
    }
}

public sealed record SaveNoteRequest : IValidatableObject
{
    private string? id;
    private long? version;

    [JsonConstructor]
    public SaveNoteRequest() { }

    internal SaveNoteRequest(string? id, long? version, string title, string body)
    {
        this.id = id;
        this.version = version;
        Title = title;
        Body = body;
    }

    // 省略は新規作成を表す。明示的なnullは入力エラーとする。
    [Uuid]
    [DisallowNull]
    public string? Id { get => id; init => id = value ?? throw new System.Text.Json.JsonException(); }
    [Range(1, long.MaxValue, ErrorMessage = "版は1以上で指定してください。")]
    [DisallowNull]
    public long? Version { get => version; init => version = value ?? throw new System.Text.Json.JsonException(); }
    [JsonRequired]
    [NoteTitle]
    public string Title { get; init; } = null!;
    [JsonRequired]
    [NoteBody]
    public string Body { get; init; } = null!;

    public IEnumerable<ValidationResult> Validate(ValidationContext validationContext)
    {
        if ((Id is null) != (Version is null))
            yield return new ValidationResult("編集対象と版を指定してください。", [nameof(Id), nameof(Version)]);
    }
}

internal sealed record SaveNoteResponse(string Id, string Title, string Body, long Version, string UpdatedAt);
