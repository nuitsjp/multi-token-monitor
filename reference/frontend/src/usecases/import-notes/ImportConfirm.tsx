import { useState } from 'react';
import { Navigate, useNavigate } from '@tanstack/react-router';
import { Button, Group, List, Notification, Stack, Text, Title } from '@mantine/core';
import { useImportMany } from '../../features/notes/queries.ts';
import { ErrorNotice } from '../../shared/ErrorNotice.tsx';
import { useImportDialogue } from './ImportDialogue.tsx';
export function ImportConfirm() {
  const state = useImportDialogue();
  const navigate = useNavigate();
  const commit = useImportMany();
  const [count, setCount] = useState<number | null>(null);
  if (count !== null)
    return (
      <section className="panel">
        <Notification color="teal" role="status" withCloseButton={false} withBorder>
          {count}件を登録しました
        </Notification>
        <Button onClick={() => void navigate({ to: '/notes' })} mt="lg">
          メモ一覧へ
        </Button>
      </section>
    );
  if (!state.preview) return <Navigate to="/import" />;
  // 失敗時は確認内容と下書きを残し、表示はErrorNoticeが担う。
  function submit() {
    commit.mutate(state.input, {
      onSuccess: (result) => {
        setCount(result.count);
        state.clear();
      },
    });
  }
  return (
    <section className="panel">
      <Stack>
        <Title order={2} size="h4">
          2. 内容を確認して保存
        </Title>
        <Text>{state.preview.titles.length}件のメモを登録します。</Text>
        <List>
          {state.preview.titles.map((title, index) => (
            <List.Item key={index}>{title}</List.Item>
          ))}
        </List>
        <Text className="pre-wrap">{state.preview.body || '（本文なし）'}</Text>
        <ErrorNotice error={commit.error} />
        <Group>
          <Button loading={commit.isPending} onClick={submit}>
            一括登録する
          </Button>
          <Button
            onClick={() => void navigate({ to: '/import' })}
            variant="default"
            disabled={commit.isPending}
          >
            入力に戻る
          </Button>
        </Group>
      </Stack>
    </section>
  );
}
