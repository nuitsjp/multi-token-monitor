import { useNavigate } from '@tanstack/react-router';
import { Button, Stack, Textarea, Title } from '@mantine/core';
import { usePreviewMany } from '../../features/notes/queries.ts';
import { ErrorNotice } from '../../shared/ErrorNotice.tsx';
import { useImportDialogue } from './ImportDialogue.tsx';
export function ImportInput() {
  const state = useImportDialogue();
  const preview = usePreviewMany();
  const navigate = useNavigate();
  // 失敗時は入力を保持し、表示はErrorNoticeが担う。
  function submit() {
    preview.mutate(state.input, {
      onSuccess: (result) => {
        state.setPreview(result);
        void navigate({ to: '/import/confirm' });
      },
    });
  }
  return (
    <section className="panel">
      <Title order={2} size="h4" mb="lg">
        1. 登録する内容を入力
      </Title>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Stack>
          <Textarea
            label="タイトル一覧"
            description="1行に1件、最大100件"
            minRows={6}
            autosize
            value={state.input.titles}
            onChange={(e) => {
              const titles = e.currentTarget.value;
              state.setInput((current) => ({ ...current, titles }));
            }}
            disabled={preview.isPending}
          />
          <Textarea
            label="共通の本文"
            minRows={3}
            value={state.input.body}
            onChange={(e) => {
              const body = e.currentTarget.value;
              state.setInput((current) => ({ ...current, body }));
            }}
            disabled={preview.isPending}
          />
          <ErrorNotice error={preview.error} />
          <Button type="submit" loading={preview.isPending}>
            内容を確認する
          </Button>
        </Stack>
      </form>
    </section>
  );
}
