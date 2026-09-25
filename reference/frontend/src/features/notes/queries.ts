import { useEffect, useState } from 'react';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  listNotes,
  saveNote,
  removeNote,
  previewMany,
  importMany,
  watchNotes,
} from '@notes-access';
// 鮮度は確定後の再取得とSSE通知で保つため、時間経過では古くしない。
export const notesOptions = () =>
  queryOptions({
    queryKey: ['notes'] as const,
    queryFn: ({ signal }) => listNotes(signal),
    staleTime: Infinity,
  });
export const useNotes = () => useQuery(notesOptions());
// 再取得失敗はQuery側で表示する。保存済みの操作を失敗に変更しない。
function useRefreshNotes() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: notesOptions().queryKey }).catch(() => {});
  };
}
export function useSaveNote() {
  const refresh = useRefreshNotes();
  return useMutation({ mutationFn: saveNote, onSuccess: refresh });
}
export function useRemoveNote() {
  const refresh = useRefreshNotes();
  return useMutation({ mutationFn: removeNote, onSuccess: refresh });
}
export const usePreviewMany = () => useMutation({ mutationFn: previewMany });
export function useImportMany() {
  const refresh = useRefreshNotes();
  return useMutation({ mutationFn: importMany, onSuccess: refresh });
}
export function useNotesSubscription(ownerId: string | undefined): boolean {
  const [ready, setReady] = useState(false);
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!ownerId) return;
    const unwatch = watchNotes(() => {
      void queryClient.invalidateQueries({ queryKey: notesOptions().queryKey }).catch(() => {});
    }, setReady);
    return () => {
      unwatch();
      setReady(false);
    };
  }, [ownerId, queryClient]);
  return ready;
}
