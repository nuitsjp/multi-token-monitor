import { describe, expect, it, vi, afterEach } from 'vitest';
import { aggregateHub, rangeForPreset } from '../../frontend/src/hub-usage.ts';
import {
  applyHubUsageFreshness,
  fetchHubUsage,
  type HubUsageData,
  type HubUsageHub,
} from '../../frontend/src/api/hub-usage.ts';

const hub: HubUsageHub = {
  hubId: 'personal',
  name: 'Personal',
  connected: true,
  receivedAt: '2026-10-03T12:42:00+09:00',
  devices: [
    {
      deviceId: 'a',
      hostname: 'A',
      osName: null,
      updatedAt: '2026-10-03T12:42:00+09:00',
      stale: false,
    },
    {
      deviceId: 'b',
      hostname: 'B',
      osName: null,
      updatedAt: '2026-10-03T10:18:00+09:00',
      stale: true,
    },
  ],
  days: Array.from({ length: 7 }, (_, index) => ({
    date: '2026-10-01',
    deviceId: 'a',
    model: `Model ${index}`,
    tokens: (index + 1) * 100,
    costUsd: index === 0 ? null : index + 1,
  })),
};

afterEach(() => vi.unstubAllGlobals());

describe('Hub period and model aggregation', () => {
  it('selects inclusive periods and clamps month ends', () => {
    expect(rangeForPreset('2w', '2026-10-03')).toEqual({ start: '2026-09-20', end: '2026-10-03' });
    expect(rangeForPreset('3m', '2026-05-30')).toEqual({ start: '2026-02-28', end: '2026-05-30' });
    expect(rangeForPreset('1y', '2026-10-03')).toEqual({ start: '2025-10-04', end: '2026-10-03' });
  });

  it.each(['daily', 'weekly', 'monthly'] as const)(
    'preserves totals and Other with %s buckets',
    (unit) => {
      const usage = aggregateHub(hub, '2026-09-20', '2026-10-03', unit);
      expect(usage.series.map((series) => series.name)).toEqual([
        'Model 6',
        'Model 5',
        'Model 4',
        'Model 3',
        'Model 2',
        'Other',
      ]);
      expect(usage.totalTokens).toBe(2800);
      expect(usage.totalCostUsd).toBe(27);
      expect(
        usage.buckets
          .flatMap((bucket) => bucket.tokens)
          .reduce<number>((sum, amount) => sum + (amount ?? 0), 0),
      ).toBe(2800);
      expect(
        usage.buckets
          .flatMap((bucket) => bucket.costs)
          .reduce<number>((sum, amount) => sum + (amount ?? 0), 0),
      ).toBe(27);
      expect(usage.devices[0].tokenShare).toBe(1);
      expect(usage.devices[0].costShare).toBe(1);
      expect(usage.partial).toBe(true);
    },
  );

  it('keeps absent device and date information unknown instead of fabricating zeros', () => {
    const usage = aggregateHub(hub, '2026-09-20', '2026-10-03', 'daily');
    expect(usage.devices[1]).toMatchObject({
      tokens: null,
      costUsd: null,
      tokenShare: null,
      costShare: null,
    });
    expect(usage.buckets[0].tokens).toEqual(Array(6).fill(null));
    expect(usage.buckets[0].costs).toEqual(Array(6).fill(null));
    const empty = aggregateHub(hub, '2026-09-20', '2026-09-30', 'daily');
    expect(empty.totalTokens).toBeNull();
    expect(empty.totalCostUsd).toBeNull();
    expect(empty.buckets).toEqual([]);
  });

  it('distinguishes reported zero usage from absent history and wholly unknown cost', () => {
    const usage = aggregateHub(
      { ...hub, devices: [hub.devices[0]], days: [{ ...hub.days[0], tokens: 0 }] },
      '2026-10-01',
      '2026-10-01',
      'daily',
    );
    expect(usage.totalTokens).toBe(0);
    expect(usage.devices[0].tokens).toBe(0);
    expect(usage.totalCostUsd).toBeNull();
    expect(usage.buckets[0].costs).toEqual([null]);
  });
});

describe('Hub usage API and freshness', () => {
  it('fetches saved usage from the real API and propagates errors', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ today: '2026-10-03', hubs: [hub] }) })
      .mockResolvedValueOnce({ ok: false, status: 503 });
    vi.stubGlobal('fetch', fetch);
    expect((await fetchHubUsage()).hubs[0]).toEqual(hub);
    await expect(fetchHubUsage()).rejects.toThrow('HTTP 503');
    expect(fetch).toHaveBeenCalledWith('/api/hub-usage');
  });

  it('updates only metadata, preserves daily history, and ignores stale freshness after refetch', () => {
    const data: HubUsageData = { today: '2026-10-03', hubs: [{ ...hub, connected: false }] };
    const update = {
      hubId: hub.hubId,
      receivedAt: '2026-10-03T03:43:00Z',
      updatedAt: '2026-10-03T03:43:00Z',
      devices: [{ deviceId: 'b', updatedAt: '2026-10-03T03:43:00Z', stale: false }],
    };
    const next = applyHubUsageFreshness(data, update);
    expect(next.hubs[0].connected).toBe(true);
    expect(next.hubs[0].devices[1].stale).toBe(false);
    expect(next.hubs[0].days).toBe(data.hubs[0].days);
    const afterDisconnect = { ...next, hubs: [{ ...next.hubs[0], connected: false }] };
    expect(applyHubUsageFreshness(afterDisconnect, update).hubs[0]).toBe(afterDisconnect.hubs[0]);
    expect(
      applyHubUsageFreshness(next, { ...update, receivedAt: '2026-10-03T03:41:00Z' }).hubs[0],
    ).toBe(next.hubs[0]);
  });
});
