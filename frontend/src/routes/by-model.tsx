import { createFileRoute } from '@tanstack/react-router';
import { UsageBreakdownPage, type BreakdownView } from '../components/UsageBreakdown.tsx';
import { aggregateModels } from '../model-usage.ts';

export const Route = createFileRoute('/by-model')({ component: ByModel });

const view: BreakdownView = {
  title: 'By model',
  icon: 'model',
  listTitle: 'Models',
  errorTitle: 'Unable to load model information',
  aggregate: aggregateModels,
};

export function ByModel() {
  return <UsageBreakdownPage view={view} />;
}
