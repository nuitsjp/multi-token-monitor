import type { Overview } from './overview.ts';

// 段階3の動作合意用の固定データ。最初に全体状態を表示し、以後は同期による保存を順に渡す。
// 「Lab」Hubは最初は未受信で、2回目の同期で受信済みになる。2回目の同期は1回目と同じ値を届ける。
const initial: Overview = {
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
    { hubId: 'lab', name: 'Lab', connected: true, receivedAt: null, updatedAt: null },
  ],
  periods: {
    today: {
      total: { tokens: 4_850_000, costUsd: 42.3 },
      hubs: [
        { hubId: 'personal', tokens: 1_500_000, costUsd: 20.5 },
        { hubId: 'work', tokens: 3_350_000, costUsd: 21.8 },
        { hubId: 'lab', tokens: 0, costUsd: null },
      ],
      models: [
        { tool: 'claude-code', model: 'claude-sonnet-5', tokens: 2_400_000, costUsd: 9.6 },
        { tool: 'claude-code', model: 'claude-opus-5-5', tokens: 2_000_000, costUsd: 30.6 },
        { tool: 'codex', model: 'gpt-5.5', tokens: 300_000, costUsd: 2.1 },
        { tool: 'copilot', model: 'gpt-5.5', tokens: 150_000, costUsd: null },
      ],
    },
    month: {
      total: { tokens: 75_400_000, costUsd: 623.9 },
      hubs: [
        { hubId: 'personal', tokens: 22_700_000, costUsd: 313.4 },
        { hubId: 'work', tokens: 52_700_000, costUsd: 310.5 },
        { hubId: 'lab', tokens: 0, costUsd: null },
      ],
      models: [
        { tool: 'claude-code', model: 'claude-sonnet-5', tokens: 41_000_000, costUsd: 164 },
        { tool: 'claude-code', model: 'claude-opus-5-5', tokens: 28_100_000, costUsd: 430.5 },
        { tool: 'codex', model: 'gpt-5.5', tokens: 4_200_000, costUsd: 29.4 },
        { tool: 'copilot', model: 'gpt-5.5', tokens: 2_100_000, costUsd: null },
      ],
    },
    allTime: {
      total: { tokens: 359_600_000, costUsd: 3019.3 },
      hubs: [
        { hubId: 'personal', tokens: 121_300_000, costUsd: 1649.1 },
        { hubId: 'work', tokens: 238_300_000, costUsd: 1370.2 },
        { hubId: 'lab', tokens: 0, costUsd: null },
      ],
      models: [
        { tool: 'claude-code', model: 'claude-sonnet-5', tokens: 188_000_000, costUsd: 752 },
        { tool: 'claude-code', model: 'claude-opus-5-5', tokens: 136_500_000, costUsd: 2090.2 },
        { tool: 'codex', model: 'gpt-5.5', tokens: 25_300_000, costUsd: 177.1 },
        { tool: 'copilot', model: 'gpt-5.5', tokens: 9_800_000, costUsd: null },
      ],
    },
  },
  limitWindows: [
    {
      hubId: 'personal',
      provider: 'anthropic',
      accountKey: 'a1',
      accountLabel: 'Personal',
      planLabel: 'Max 20x',
      kind: 'session',
      limitKey: 'five_hour',
      label: '5h',
      remainingPercent: 62,
      resetsAt: '2026-09-25T05:00:00Z',
    },
    {
      hubId: 'personal',
      provider: 'anthropic',
      accountKey: 'a1',
      accountLabel: 'Personal',
      planLabel: 'Max 20x',
      kind: 'weekly',
      limitKey: 'seven_day',
      label: 'Weekly',
      remainingPercent: 38,
      resetsAt: '2026-09-29T00:00:00Z',
    },
    {
      hubId: 'work',
      provider: 'anthropic',
      accountKey: 'b2',
      accountLabel: 'Work',
      planLabel: 'Team',
      kind: 'session',
      limitKey: 'five_hour',
      label: '5h',
      remainingPercent: 81,
      resetsAt: '2026-09-25T06:30:00Z',
    },
    {
      hubId: 'work',
      provider: 'anthropic',
      accountKey: 'b2',
      accountLabel: 'Work',
      planLabel: 'Team',
      kind: 'weekly',
      limitKey: 'seven_day',
      label: 'Weekly',
      remainingPercent: 55,
      resetsAt: '2026-09-30T00:00:00Z',
    },
    {
      hubId: 'personal',
      provider: 'openai',
      accountKey: 'c3',
      accountLabel: 'Personal',
      planLabel: 'Plus',
      kind: 'weekly',
      limitKey: 'weekly',
      label: null,
      remainingPercent: 12,
      resetsAt: null,
    },
  ],
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
      hubId: 'personal',
      deviceId: 'd2',
      hostname: 'laptop-home',
      osName: 'macOS',
      updatedAt: '2026-09-22T11:02:00Z',
      stale: true,
    },
    {
      hubId: 'work',
      deviceId: 'd3',
      hostname: 'work-pc',
      osName: 'Windows 11',
      updatedAt: '2026-09-25T03:09:58Z',
      stale: false,
    },
    {
      hubId: 'work',
      deviceId: 'd4',
      hostname: 'work-wsl',
      osName: null,
      updatedAt: '2026-09-25T03:05:12Z',
      stale: false,
    },
  ],
};

const add = (value: number | null, delta: number) =>
  value === null ? null : Math.round((value + delta) * 100) / 100;

// 同期で Personal Hub の claude-sonnet-5 の利用が step 回分増えた状態。step が2以上なら Lab も受信済みになる。
function synced(step: number): Overview {
  const tokens = 12_345 * step;
  const cost = 0.37 * step;
  const lab = step >= 2 ? { tokens: 45_600, costUsd: 0.9 } : { tokens: 0, costUsd: null };
  const period = (usage: Overview['periods']['today']) => ({
    total: {
      tokens: usage.total.tokens + tokens + lab.tokens,
      costUsd: add(usage.total.costUsd, cost + (lab.costUsd ?? 0)),
    },
    hubs: usage.hubs.map((row) =>
      row.hubId === 'personal'
        ? { ...row, tokens: row.tokens + tokens, costUsd: add(row.costUsd, cost) }
        : row.hubId === 'lab'
          ? { ...row, ...lab }
          : row,
    ),
    models: usage.models.map((row) =>
      row.model === 'claude-sonnet-5'
        ? {
            ...row,
            tokens: row.tokens + tokens + lab.tokens,
            costUsd: add(row.costUsd, cost + (lab.costUsd ?? 0)),
          }
        : row,
    ),
  });
  return {
    ...initial,
    hubs: initial.hubs.map((hub) =>
      hub.hubId === 'lab' && step >= 2
        ? { ...hub, receivedAt: '2026-09-25T03:20:00Z', updatedAt: '2026-09-25T03:19:50Z' }
        : hub,
    ),
    periods: {
      today: period(initial.periods.today),
      month: period(initial.periods.month),
      allTime: period(initial.periods.allTime),
    },
  };
}

export const overviewMock: Overview = initial;
export const syncMocks: Overview[] = [synced(1), synced(1), synced(2), synced(3)];
