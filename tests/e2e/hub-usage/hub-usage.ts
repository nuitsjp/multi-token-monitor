import { test as base, expect } from '../fixtures.ts';
import {
  createStats,
  startFakeHub,
  type FakeDevice,
  type FakeHub,
  type FakeStats,
} from '../hub-sync/fake-hub.ts';
import { query } from '../hub-sync/sync.ts';

type HistoryDevice = FakeDevice & {
  historyAvailable: true;
  history: {
    daily: {
      date: string;
      tokens: number;
      perModel: Record<string, { tokens: number; cost: number | null }>;
    }[];
  };
};
export type HistoryStats = FakeStats & { deviceHistoryRevision: string; devices: HistoryDevice[] };
export const models = [
  'shared-model',
  'model-b',
  'model-c',
  'model-d',
  'model-e',
  'model-f',
  'model-g',
];
export const dailyTokens = 8_400_000;
export const dailyCost = 84;
export const dayBefore = (today: string, days: number) =>
  new Date(Date.parse(`${today}T12:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);

function historyStats(seed: number): HistoryStats {
  const stats = createStats(seed);
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const devices = stats.devices.slice(0, 2).map((device, index): HistoryDevice => {
    const hubScale = seed === 11 ? 1 : 2;
    const factor = (index + 1) * hubScale;
    const costFactor = (2 - index) * hubScale;
    const perModel = Object.fromEntries(
      models.map((model, rank) => [
        model,
        { tokens: (7 - rank) * 100_000 * factor, cost: (7 - rank) * costFactor },
      ]),
    );
    const clientModels = {
      codex: Object.fromEntries(models.map((model) => [model, perModel[model].tokens / 2])),
      claude: Object.fromEntries(models.map((model) => [model, perModel[model].tokens / 2])),
    };
    const clientModelCosts = {
      codex: Object.fromEntries(models.map((model) => [model, perModel[model].cost / 2])),
      claude: Object.fromEntries(models.map((model) => [model, perModel[model].cost / 2])),
    };
    return {
      ...device,
      hostname: `${seed === 11 ? 'Personal' : 'Work'}-${index + 1}`,
      stale: index === 1,
      periodWindows: {
        today: { key: today, endsAt: new Date(Date.now() + 86_400_000).toISOString() },
        month: {
          key: today.slice(0, 7),
          endsAt: new Date(Date.now() + 32 * 86_400_000).toISOString(),
        },
      },
      periods: {
        ...device.periods,
        today: { totalTokens: 2_800_000 * factor, clientModels, clientModelCosts },
      },
      historyAvailable: true,
      history: {
        daily: Array.from({ length: 370 }, (_, offset) => ({
          date: dayBefore(today, offset),
          tokens: 2_800_000 * factor,
          perModel:
            offset < 14
              ? perModel
              : Object.fromEntries(
                  Object.entries(perModel).map(([model, usage]) => [
                    model === 'shared-model' ? 'archive-model' : model,
                    usage,
                  ]),
                ),
        })),
      },
    };
  });
  return { ...stats, devices, deviceHistoryRevision: `history-${seed}` };
}

export const test = base.extend<{ personal: FakeHub; work: FakeHub }>({
  // eslint-disable-next-line no-empty-pattern -- Playwright requires fixture dependency destructuring
  personal: async ({}, use) => {
    const hub = await startFakeHub('private-hub-token', historyStats(11));
    try {
      await use(hub);
    } finally {
      await hub.close();
    }
  },
  // eslint-disable-next-line no-empty-pattern -- Playwright requires fixture dependency destructuring
  work: async ({}, use) => {
    const hub = await startFakeHub('work-hub-token', historyStats(22));
    try {
      await use(hub);
    } finally {
      await hub.close();
    }
  },
  hubs: async ({ personal, work }, use) => {
    // IDs sort opposite to registration order, which must determine the default.
    await use([
      { id: 'z-personal', name: 'Personal', url: personal.url, token: personal.token },
      { id: 'a-work', name: 'Work', url: work.url, token: work.token },
    ]);
  },
});

export async function waitSaved(databasePath: string) {
  await expect
    .poll(
      () =>
        query<{ count: number }>(
          databasePath,
          'SELECT COUNT(*) AS count FROM device_daily_model_usages',
        )[0]?.count,
    )
    .toBe(10_360);
}

export function storedSnapshot(databasePath: string) {
  return JSON.stringify(
    ['hubs', 'devices', 'hub_states', 'device_daily_model_usages'].map((table) =>
      query(databasePath, `SELECT * FROM ${table} ORDER BY rowid`),
    ),
  );
}

export { expect };
