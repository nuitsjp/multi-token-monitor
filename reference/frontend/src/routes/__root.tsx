import { createRootRouteWithContext } from '@tanstack/react-router';
import type { QueryClient } from '@tanstack/react-query';
import { Shell } from '../app/Shell.tsx';
export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: Shell,
});
