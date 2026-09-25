import { useState } from 'react';
import {
  Badge,
  Button,
  Group,
  Notification,
  Stack,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core';
import type { Note } from '@contracts/notes.ts';
import { useNotes, useSaveNote, useRemoveNote } from '../../features/notes/queries.ts';
import { ErrorNotice } from '../../shared/ErrorNotice.tsx';
import { useDraftDirty } from '../../shared/DraftContext.tsx';
import { readFieldError } from '../../shared/errors.ts';
// 入力欄の下に表示する検証エラーの項目名（C#の入力型のプロパティ名）。
const noteFields = ['Title', 'Body'] as const;
export function EditNotes() {
  const notes = useNotes();
  const save = useSaveNote();
  const remove = useRemoveNote();
  const [selected, setSelected] = useState<Note | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [message, setMessage] = useState('');
  const dirty = title !== (selected?.title ?? '') || body !== (selected?.body ?? '');
  useDraftDirty(dirty);
  const busy = save.isPending || remove.isPending;
  function select(note: Note | null) {
    if (dirty && !window.confirm('未保存の入力を破棄しますか？')) return;
    setSelected(note);
    setTitle(note?.title ?? '');
    setBody(note?.body ?? '');
    setMessage('');
    save.reset();
    remove.reset();
  }
  // 失敗時はエラーと下書きを画面に残す。
  function submit() {
    setMessage('');
    save.mutate(
      { id: selected?.id, version: selected?.version, title, body },
      {
        onSuccess: (note) => {
          setSelected(note);
          setTitle(note.title);
          setBody(note.body);
          setMessage('保存しました');
          remove.reset();
        },
      },
    );
  }
  function deleteSelected() {
    if (!selected || !window.confirm('このメモを削除しますか？')) return;
    remove.mutate(
      { id: selected.id, version: selected.version },
      {
        onSuccess: () => {
          setSelected(null);
          setTitle('');
          setBody('');
          setMessage('削除しました');
          save.reset();
        },
      },
    );
  }
  return (
    <>
      <div className="section-label">USE CASE 01</div>
      <Title order={1} className="page-heading">
        メモを作成・編集する
      </Title>
      <Text c="dimmed">下書きと保存済みデータを分け、SQLiteへの確定後に結果を表示します。</Text>
      <div className="split">
        <section className="panel">
          <Group justify="space-between">
            <Title order={2} size="h4">
              保存済みのメモ
            </Title>
            <Badge variant="light">{notes.data?.length ?? 0}件</Badge>
          </Group>
          <ErrorNotice error={notes.error} title="一覧の取得に失敗しました" />
          {notes.isPending ? (
            <Text mt="md">読み込み中…</Text>
          ) : notes.data?.length === 0 ? (
            <div className="empty">メモはまだありません。</div>
          ) : (
            notes.data?.map((note) => (
              <div className="note-row" key={note.id}>
                <div>
                  <Text fw={600}>{note.title}</Text>
                  <span className="muted">
                    v{note.version} · {new Date(note.updatedAt).toLocaleString('ja-JP')}
                  </span>
                </div>
                <Button
                  size="xs"
                  variant="light"
                  disabled={busy}
                  aria-label={`${note.title}を編集`}
                  onClick={() => select(note)}
                >
                  編集
                </Button>
              </div>
            ))
          )}
          <Button mt="lg" fullWidth variant="default" disabled={busy} onClick={() => select(null)}>
            新しいメモ
          </Button>
        </section>
        <section className="panel">
          <Group justify="space-between" mb="lg">
            <Title order={2} size="h4">
              {selected ? 'メモを編集' : '新しいメモを作成'}
            </Title>
            {dirty && (
              <Badge color="orange" variant="light">
                未保存
              </Badge>
            )}
          </Group>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <Stack>
              <TextInput
                label="タイトル"
                value={title}
                onChange={(e) => setTitle(e.currentTarget.value)}
                error={readFieldError(save.error, 'Title')}
                disabled={busy}
                autoComplete="off"
              />
              <Textarea
                label="本文"
                minRows={7}
                autosize
                value={body}
                onChange={(e) => setBody(e.currentTarget.value)}
                error={readFieldError(save.error, 'Body')}
                disabled={busy}
              />
              <ErrorNotice error={save.error} fields={noteFields} />
              <ErrorNotice error={remove.error} />
              {message && (
                <Notification color="teal" role="status" withCloseButton={false} withBorder>
                  {message}
                </Notification>
              )}
              <Group justify="space-between">
                <Button type="submit" loading={save.isPending} disabled={remove.isPending}>
                  保存する
                </Button>
                {selected && (
                  <Button
                    color="red"
                    variant="subtle"
                    loading={remove.isPending}
                    disabled={save.isPending}
                    onClick={deleteSelected}
                  >
                    削除する
                  </Button>
                )}
              </Group>
            </Stack>
          </form>
        </section>
      </div>
    </>
  );
}
