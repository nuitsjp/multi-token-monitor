import { createFileRoute } from '@tanstack/react-router';
import { NotImplemented } from '../components/NotImplemented.tsx';

export const Route = createFileRoute('/by-hub')({
  component: () => <NotImplemented title="By hub" />,
});
