import { describe, expect, it } from 'vitest';
import type { HubUsageData, HubUsageHub } from '../../frontend/src/api/hub-usage.ts';
import { aggregateDevices } from '../../frontend/src/device-usage.ts';

const hub = (
  hubId: string,
  devices: [deviceId: string, hostname: string, osName: string | null][],
  days: [deviceId: string, tokens: number, costUsd: number | null][],
): HubUsageHub => ({
  hubId,
  name: hubId,
  connected: true,
  receivedAt: '2026-10-03T00:00:00Z',
  devices: devices.map(([deviceId, hostname, osName]) => ({
    deviceId,
    hostname,
    osName,
    updatedAt: '2026-10-03T00:00:00Z',
    stale: false,
  })),
  days: days.map(([deviceId, tokens, costUsd]) => ({
    date: '2026-10-01',
    deviceId,
    model: 'm',
    tokens,
    costUsd,
  })),
});
const dataOf = (...hubs: HubUsageHub[]): HubUsageData => ({ today: '2026-10-03', hubs });

describe('aggregateDevices', () => {
  it('merges the same device ID across hubs and names it from the first registered hub', () => {
    const data = dataOf(
      hub('a', [['d1', 'first-name', 'Windows']], [['d1', 10, 1]]),
      hub('b', [['d1', 'second-name', 'Linux']], [['d1', 30, 2]]),
    );
    const { items } = aggregateDevices(data, '2026-10-01', '2026-10-01', 'daily');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      key: 'd1',
      name: 'first-name',
      detail: 'Windows',
      tokens: 40,
      costUsd: 3,
    });
  });

  it('keeps devices with the same hostname apart and orders ties by device ID', () => {
    const data = dataOf(
      hub(
        'a',
        [
          ['d2', 'same', null],
          ['d1', 'same', null],
          ['d3', 'other', null],
        ],
        [
          ['d2', 10, 1],
          ['d1', 10, 1],
          ['d3', 5, null],
        ],
      ),
    );
    const { items } = aggregateDevices(data, '2026-10-01', '2026-10-01', 'daily');
    expect(items.map((item) => item.key)).toEqual(['d1', 'd2', 'd3']);
    expect(items[0].detail).toBeNull();
  });
});
