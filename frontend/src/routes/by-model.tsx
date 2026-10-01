import { createFileRoute } from '@tanstack/react-router';
import { NotImplemented } from '../components/NotImplemented.tsx';

export const Route = createFileRoute('/by-model')({
  component: () => <NotImplemented title="By model" />,
});
