import { createFileRoute } from '@tanstack/react-router';
import { sessionOptions } from '../features/identity/session.ts';
import { notesOptions } from '../features/notes/queries.ts';
import { EditNotes } from '../usecases/edit-notes/EditNotes.tsx';
export const Route = createFileRoute('/notes')({
  // 利用者が確定している時だけ一覧を先読みする。失敗の表示は画面側のQueryが担う。
  loader: ({ context: { queryClient } }) => {
    if (queryClient.getQueryData(sessionOptions().queryKey)?.user)
      return queryClient.prefetchQuery(notesOptions());
  },
  component: EditNotes,
});
