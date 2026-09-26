import type { Overview } from './overview.ts';

// 段階3の動作合意用の固定データ。変更通知のたびに次の状態へ順に切り替える。合計は手で整合させた固定値で、集計処理は持たない。
// 「Lab」Hubは未受信の状態を示す。
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

// Work と Lab の受信が止まり、再接続中になった状態。値は最後に保存した状態のまま。
function stopped(): Overview {
  const next = structuredClone(initial);
  for (const hub of next.hubs) if (hub.hubId !== 'personal') hub.connected = false;
  return next;
}

// Work が再接続して全体状態を保存した状態。今日の利用が 250,000 トークン進む。Lab は再接続中のまま。
function recovered(): Overview {
  const next = stopped();
  const hub = next.hubs.find((item) => item.hubId === 'work')!;
  hub.connected = true;
  hub.receivedAt = '2026-09-25T03:17:40Z';
  hub.updatedAt = '2026-09-25T03:17:30Z';
  for (const period of Object.values(next.periods)) {
    period.total.tokens += 250_000;
    period.total.costUsd! += 3.8;
    const usage = period.hubs.find((item) => item.hubId === 'work')!;
    usage.tokens += 250_000;
    usage.costUsd! += 3.8;
    const model = period.models.find((item) => item.model === 'claude-opus-5-5')!;
    model.tokens += 250_000;
    model.costUsd! += 3.8;
  }
  next.devices.find((item) => item.deviceId === 'd3')!.updatedAt = '2026-09-25T03:17:30Z';
  return next;
}

export const overviewMocks: Overview[] = [initial, stopped(), recovered()];
