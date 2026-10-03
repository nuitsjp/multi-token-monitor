import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { afterEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { OverviewNotification } from '../../../frontend/src/api/overview.ts';
import type { HubUsageData } from '../../../frontend/src/api/hub-usage.ts';

const notifications = vi.hoisted(() => ({
  listener: undefined as ((notification: OverviewNotification) => void) | undefined,
}));
vi.mock('../../../frontend/src/app/overview.tsx', () => ({
  useOverview: () => ({ subscribeNotifications: subscribe }),
}));
function subscribe(listener: (notification: OverviewNotification) => void) {
  notifications.listener = listener;
  return () => {
    notifications.listener = undefined;
  };
}
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => options,
  Link: ({ children }: { children: ReactNode }) => <a href="/device">{children}</a>,
}));

import { ByHub } from '../../../frontend/src/routes/by-hub.tsx';

const data: HubUsageData = {
  today: '2026-10-03',
  hubs: [
    {
      hubId: 'personal',
      name: 'Personal',
      connected: false,
      receivedAt: '2026-10-03T03:42:00Z',
      devices: [
        {
          deviceId: 'd',
          hostname: 'Desktop',
          osName: 'Windows',
          updatedAt: '2026-10-03T03:42:00Z',
          stale: true,
        },
      ],
      days: [{ date: '2026-10-01', deviceId: 'd', model: 'Model A', tokens: 1000, costUsd: 1 }],
    },
  ],
};
const response = (value: HubUsageData) => ({ ok: true, json: async () => value });
afterEach(() => vi.unstubAllGlobals());

it('shares commit notifications, keeps selection, and does not refetch on freshness', async () => {
  let resolve!: (value: ReturnType<typeof response>) => void;
  const pending = new Promise<ReturnType<typeof response>>((done) => {
    resolve = done;
  });
  const fetch = vi
    .fn()
    .mockReturnValueOnce(pending)
    .mockResolvedValueOnce(response(data))
    .mockResolvedValueOnce({ ok: false, status: 503 });
  vi.stubGlobal('fetch', fetch);
  const view = render(
    <MantineProvider>
      <ByHub />
    </MantineProvider>,
  );
  const update = {
    hubId: 'personal',
    receivedAt: '2026-10-03T03:43:00Z',
    updatedAt: '2026-10-03T03:43:00Z',
    devices: [{ deviceId: 'd', updatedAt: '2026-10-03T03:43:00Z', stale: false }],
  };
  act(() => notifications.listener?.({ type: 'freshness', freshness: update }));
  await act(async () => {
    resolve(response(data));
  });
  expect(await screen.findByText(/Connected/)).toBeInTheDocument();
  const received = new Date(update.receivedAt).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  });
  expect(screen.getByText(`Last received ${received}`)).toBeInTheDocument();
  expect(fetch).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('radio', { name: '4W' }));
  fireEvent.change(screen.getByLabelText('Aggregation'), { target: { value: 'weekly' } });
  fireEvent.click(screen.getByRole('button', { name: 'Model A' }));
  act(() => notifications.listener?.({ type: 'changed' }));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  expect(screen.getByRole('radio', { name: '4W' })).toBeChecked();
  expect(screen.getByLabelText('Aggregation')).toHaveValue('weekly');
  expect(screen.getByRole('button', { name: 'Model A' })).toHaveAttribute('aria-pressed', 'false');
  expect(screen.getByText(`Last received ${received}`)).toBeInTheDocument();
  act(() => notifications.listener?.({ type: 'changed' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('HTTP 503');
  expect(screen.getByRole('heading', { name: 'By hub' })).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: '4W' })).toBeChecked();
  view.unmount();
  expect(notifications.listener).toBeUndefined();
});
