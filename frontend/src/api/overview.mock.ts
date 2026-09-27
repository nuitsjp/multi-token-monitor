import type { Overview } from './overview.ts';

type LimitWindow = Overview['limitWindows'][number];

// 段階3の動作合意用の固定データ。推定上限額が出る枠と「Estimating」になる枠を並べる。
const claude = (hubId: string, accountKey: string, accountLabel: string, planLabel: string) =>
  ({ hubId, provider: 'claude', accountKey, accountLabel, planLabel }) as const;

const limitWindows: LimitWindow[] = [
  {
    ...claude('personal', 'a1', 'Personal', 'Max 20x'),
    kind: 'session',
    limitKey: 'five_hour',
    label: '5h',
    remainingPercent: 62,
    resetsAt: '2026-09-25T05:00:00Z',
    estimatedLimitUsd: 184.3,
  },
  {
    ...claude('personal', 'a1', 'Personal', 'Max 20x'),
    kind: 'weekly',
    limitKey: 'seven_day',
    label: 'Weekly',
    remainingPercent: 38,
    resetsAt: '2026-09-29T00:00:00Z',
    estimatedLimitUsd: 2_415.8,
  },
  {
    hubId: 'personal',
    provider: 'codex',
    accountKey: 'c1',
    accountLabel: 'Personal',
    planLabel: 'Plus',
    kind: 'weekly',
    limitKey: 'weekly',
    label: null,
    remainingPercent: 97,
    resetsAt: null,
    // 使用率の増加が5ポイント未満のため推定できない。
    estimatedLimitUsd: null,
  },
  {
    ...claude('work', 'b2', 'Work', 'Team'),
    kind: 'session',
    limitKey: 'five_hour',
    label: '5h',
    remainingPercent: 100,
    resetsAt: '2026-09-25T06:30:00Z',
    // リセット直後で計測点が1つしかないため推定できない。
    estimatedLimitUsd: null,
  },
  {
    ...claude('work', 'b2', 'Work', 'Team'),
    kind: 'weekly',
    limitKey: 'seven_day',
    label: 'Weekly',
    remainingPercent: 55,
    resetsAt: '2026-09-30T00:00:00Z',
    estimatedLimitUsd: 1_086.5,
  },
];

const period = (tokens: number, costUsd: number) => ({
  total: { tokens: tokens * 2, costUsd: costUsd * 2 },
  hubs: [
    { hubId: 'personal', tokens, costUsd },
    { hubId: 'work', tokens, costUsd },
  ],
  models: [{ tool: 'claude', model: 'claude-opus-5-5', tokens: tokens * 2, costUsd: costUsd * 2 }],
});

export const overviewMock: Overview = {
  hubs: [
    {
      hubId: 'personal',
      name: 'Personal',
      connected: true,
      receivedAt: '2026-09-25T03:12:40Z',
      updatedAt: '2026-09-25T03:12:30Z',
    },
    {
      hubId: 'work',
      name: 'Work',
      connected: true,
      receivedAt: '2026-09-25T03:10:05Z',
      updatedAt: '2026-09-25T03:09:58Z',
    },
  ],
  periods: {
    today: period(1_500_000, 20.5),
    month: period(22_700_000, 313.4),
    allTime: period(121_300_000, 1_649.1),
  },
  limitWindows,
  devices: [
    {
      hubId: 'personal',
      deviceId: 'd1',
      hostname: 'desktop-home',
      osName: 'Windows 11',
      updatedAt: '2026-09-25T03:12:30Z',
      stale: false,
    },
    {
      hubId: 'work',
      deviceId: 'd2',
      hostname: 'work-pc',
      osName: 'Windows 11',
      updatedAt: '2026-09-25T03:09:58Z',
      stale: false,
    },
  ],
};
