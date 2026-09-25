using Dapper;
using Microsoft.Data.Sqlite;
using NotesSample.Domain;
using NotesSample.Domain.Notes;

namespace NotesSample.Features.Notes;

internal static class NotePersistence
{
    internal static Task<Note?> ReadAsync(SqliteConnection connection, string ownerId, string id) =>
        connection.QuerySingleOrDefaultAsync<Note>(
            """
            SELECT
                id AS Id,
                title AS Title,
                body AS Body,
                version AS Version,
                updated_at AS UpdatedAt
            FROM
                notes
            WHERE
                owner_id = @ownerId AND id = @id
            """,
            new { ownerId, id });

    internal static Task<Note> InsertAsync(SqliteConnection connection, string ownerId, string title, string body) =>
        connection.QuerySingleAsync<Note>(
            """
            INSERT INTO notes (id, owner_id, title, body, version, updated_at)
            VALUES
                (@Id, @OwnerId, @Title, @Body, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
            RETURNING
                id AS Id,
                title AS Title,
                body AS Body,
                version AS Version,
                updated_at AS UpdatedAt
            """,
            new
            {
                Id = Guid.NewGuid().ToString("D"),
                OwnerId = ownerId,
                Title = title,
                Body = body,
            });

    internal static Exception TranslateError(Exception error) =>
        error is SqliteException { SqliteExtendedErrorCode: 2067 }
            ? new AppFaultException("TITLE_EXISTS", "同じタイトルのメモが既にあります。")
            : error;
}
