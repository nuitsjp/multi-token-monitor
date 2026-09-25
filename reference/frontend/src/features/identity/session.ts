import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Session, SignInInput, SignInOutput, SuccessOutput } from '@contracts/notes.ts';
import { postJson, requestJson } from '../client.ts';
import { notesOptions } from '../notes/queries.ts';
export type { Session };
export const sessionOptions = () =>
  queryOptions({
    queryKey: ['session'] as const,
    queryFn: () => requestJson<Session>('/api/session'),
    staleTime: Infinity,
  });
export const useSession = () => useQuery(sessionOptions());
// 利用者が替わったら前の利用者のメモをキャッシュに残さない。
function useSwitchUser() {
  const queryClient = useQueryClient();
  return async (user: Session['user']) => {
    await queryClient.cancelQueries({ queryKey: notesOptions().queryKey });
    queryClient.removeQueries({ queryKey: notesOptions().queryKey });
    queryClient.setQueryData(sessionOptions().queryKey, { user, mode: 'demo' });
  };
}
export function useSignIn() {
  const switchUser = useSwitchUser();
  return useMutation({
    mutationFn: (user: string) =>
      postJson<SignInOutput>('/api/demo/sign-in', { user } satisfies SignInInput),
    onSuccess: ({ user }) => switchUser(user),
  });
}
export function useSignOut() {
  const switchUser = useSwitchUser();
  return useMutation({
    mutationFn: () => postJson<SuccessOutput>('/api/demo/sign-out', {}),
    onSuccess: () => switchUser(null),
  });
}
