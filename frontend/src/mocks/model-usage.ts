import type { HubUsageData } from '../api/hub-usage.ts';

// 動作合意用の固定データ。段階4で取得境界の切り替えと一緒に削除する。
const models = ['model-a', 'model-b', 'model-c', 'model-d', 'model-e', 'model-f', 'model-g'];

export const modelUsageMock: HubUsageData = {
  today: '2026-10-03',
  hubs: [
    {
      hubId: 'personal',
      name: 'Personal',
      connected: true,
      receivedAt: '2026-10-03T12:00:00Z',
      devices: [],
      days: Array.from({ length: 28 }, (_, offset) => {
        const date = new Date('2026-10-03T00:00:00Z');
        date.setUTCDate(date.getUTCDate() - offset);
        return models.map((model, index) => ({
          date: date.toISOString().slice(0, 10),
          deviceId: 'personal-device',
          model,
          tokens: offset < 14 ? (7 - index) * 100 : (index + 1) * 200,
          costUsd: index + 1,
        }));
      }).flat(),
    },
    {
      hubId: 'work',
      name: 'Work',
      connected: true,
      receivedAt: '2026-10-03T12:00:00Z',
      devices: [],
      days: Array.from({ length: 28 }, (_, offset) => {
        const date = new Date('2026-10-03T00:00:00Z');
        date.setUTCDate(date.getUTCDate() - offset);
        return models.map((model, index) => ({
          date: date.toISOString().slice(0, 10),
          deviceId: 'work-device',
          model,
          tokens: (index + 1) * 100 + (index === 6 ? 200 : 0),
          costUsd: 7 - index,
        }));
      }).flat(),
    },
    {
      hubId: 'empty',
      name: 'Empty',
      connected: false,
      receivedAt: null,
      devices: [],
      days: [],
    },
  ],
};
