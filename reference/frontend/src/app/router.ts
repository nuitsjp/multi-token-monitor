import { createRouter } from '@tanstack/react-router';
import { routeTree } from '../routeTree.gen.ts';
import { queryClient } from '../features/query-client.ts';
// 先読みの鮮度判定はQueryに任せるため、ルーター側では毎回loaderを呼ぶ。
export const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: 'intent',
  defaultPreloadStaleTime: 0,
});
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
