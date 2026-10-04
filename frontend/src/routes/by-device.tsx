import { createFileRoute } from '@tanstack/react-router';
import { UsageBreakdownPage, type BreakdownView } from '../components/UsageBreakdown.tsx';
import { aggregateDevices } from '../device-usage.ts';

export const Route = createFileRoute('/by-device')({ component: ByDevice });

const view: BreakdownView = {
  title: 'By device',
  icon: 'devices',
  listTitle: 'Devices',
  errorTitle: 'Unable to load device information',
  aggregate: aggregateDevices,
};

export function ByDevice() {
  return <UsageBreakdownPage view={view} />;
}
