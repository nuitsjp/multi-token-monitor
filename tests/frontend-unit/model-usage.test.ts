import { describe, expect, it } from 'vitest';
import type { HubUsageData, HubUsageDay } from '../../frontend/src/api/hub-usage.ts';
import {
  aggregateModels,
  groupUnselected,
  modelPalette,
  otherColor,
} from '../../frontend/src/model-usage.ts';

const day = (date: string, model: string, tokens: number, costUsd: number | null, hub = 'a') => ({
  hubId: hub,
  day: { date, deviceId: `${hub}-d`, model, tokens, costUsd } satisfies HubUsageDay,
});
function dataOf(rows: ReturnType<typeof day>[]): HubUsageData {
  const hubIds = [...new Set(rows.map((row) => row.hubId))];
  return {
    today: '2026-10-03',
    hubs: hubIds.map((hubId) => ({
      hubId,
      name: hubId,
      connected: true,
      receivedAt: '2026-10-03T00:00:00Z',
      devices: [],
      days: rows.filter((row) => row.hubId === hubId).map((row) => row.day),
    })),
  };
}

describe('aggregateModels', () => {
  it('sums the same model across hubs and orders by cost, unknown last, ties by name', () => {
    const data = dataOf([
      day('2026-10-01', 'b', 100, 5),
      day('2026-10-01', 'a', 100, 5, 'z'),
      day('2026-10-02', 'a', 50, 5),
      day('2026-10-01', 'unknown-2', 900, null),
      day('2026-10-01', 'unknown-1', 10, null),
      day('2026-10-01', 'cheap', 1, 1),
    ]);
    const { models } = aggregateModels(data, '2026-10-01', '2026-10-02', 'daily');
    expect(models.map((model) => model.name)).toEqual([
      'a',
      'b',
      'cheap',
      'unknown-1',
      'unknown-2',
    ]);
    expect(models[0]).toMatchObject({ tokens: 150, costUsd: 10 });
    expect(models[3].costUsd).toBeNull();
    expect(models.map((model) => model.color)).toEqual(modelPalette.slice(0, 5));
  });

  it('adds only known costs when a model has some unknown costs', () => {
    const data = dataOf([day('2026-10-01', 'a', 10, 3), day('2026-10-02', 'a', 10, null)]);
    const { models } = aggregateModels(data, '2026-10-01', '2026-10-02', 'daily');
    expect(models[0]).toMatchObject({ tokens: 20, costUsd: 3 });
  });

  it('cycles the palette after eight models and shares tokens against all models', () => {
    const rows = Array.from({ length: 10 }, (_, index) =>
      day('2026-10-01', `m${index}`, 10, 100 - index),
    );
    const { models } = aggregateModels(dataOf(rows), '2026-10-01', '2026-10-01', 'daily');
    expect(models[8].color).toBe(modelPalette[0]);
    expect(models[9].color).toBe(modelPalette[1]);
    expect(models[0].share).toBeCloseTo(0.1);
  });

  it('keeps totals when the unit changes and leaves days without records unknown', () => {
    const data = dataOf([
      day('2026-09-29', 'a', 10, 1),
      day('2026-10-03', 'a', 30, 3),
      day('2026-10-03', 'b', 5, 0),
    ]);
    const total = (unit: 'daily' | 'weekly' | 'monthly') => {
      const { buckets } = aggregateModels(data, '2026-09-29', '2026-10-03', unit);
      return buckets
        .flatMap((bucket) => bucket.tokens)
        .reduce((sum, v) => (sum ?? 0) + (v ?? 0), 0);
    };
    expect(total('daily')).toBe(45);
    expect(total('weekly')).toBe(45);
    expect(total('monthly')).toBe(45);
    const daily = aggregateModels(data, '2026-09-29', '2026-10-03', 'daily');
    expect(daily.buckets).toHaveLength(5);
    expect(daily.buckets[1].tokens).toEqual([null, null]);
    expect(daily.buckets[1].costs).toEqual([null, null]);
    expect(daily.models[0].trend).toEqual([10, 0, 0, 0, 30]);
  });

  it('returns nothing when no day falls in the range', () => {
    const data = dataOf([day('2026-09-01', 'a', 10, 1)]);
    expect(aggregateModels(data, '2026-10-01', '2026-10-03', 'daily')).toEqual({
      models: [],
      buckets: [],
    });
  });
});

describe('groupUnselected', () => {
  const data = dataOf([
    day('2026-10-01', 'a', 100, 10),
    day('2026-10-01', 'b', 20, null),
    day('2026-10-01', 'c', 5, null),
    day('2026-10-03', 'a', 100, 10),
    day('2026-10-03', 'b', 20, 2),
  ]);
  const usage = aggregateModels(data, '2026-10-01', '2026-10-03', 'daily');

  it('sums unselected models into one Other series after the selected ones', () => {
    const { series, buckets } = groupUnselected(usage, new Set(['a']));
    expect(series.map((entry) => entry.name)).toEqual(['a', 'Other']);
    expect(series[0].color).toBe(usage.models[0].color);
    expect(series[1].color).toBe(otherColor);
    expect(buckets.map((bucket) => bucket.tokens)).toEqual([
      [100, 25],
      [null, null],
      [100, 20],
    ]);
    // 1日目は未選択のモデルのコストがすべて不明なのでOtherのコストも不明、3日目は既知の分だけを足す。
    expect(buckets.map((bucket) => bucket.costs)).toEqual([
      [10, null],
      [null, null],
      [10, 2],
    ]);
  });

  it('shows only Other when nothing is selected and no Other when everything is', () => {
    const none = groupUnselected(usage, new Set());
    expect(none.series.map((entry) => entry.name)).toEqual(['Other']);
    expect(none.buckets[0].tokens).toEqual([125]);
    const all = groupUnselected(usage, new Set(['a', 'b', 'c']));
    expect(all.series.map((entry) => entry.name)).toEqual(['a', 'b', 'c']);
    expect(all.buckets[0].tokens).toEqual([100, 20, 5]);
  });

  it('keeps the bucket total the same whatever is selected', () => {
    const total = (selected: string[]) =>
      groupUnselected(usage, new Set(selected))
        .buckets.flatMap((bucket) => bucket.tokens)
        .reduce<number>((sum, value) => sum + (value ?? 0), 0);
    expect(total([])).toBe(total(['a']));
    expect(total(['a', 'b', 'c'])).toBe(total(['c']));
  });
});
