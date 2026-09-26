import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

type ModelTokens = Record<string, Record<string, number>>;

export interface FakePeriod {
  totalTokens: number;
  clientModels: ModelTokens;
  clientModelCosts: ModelTokens;
}

export interface FakeDevice {
  deviceId: string;
  hostname: string;
  osName: string;
  updatedAt: string;
  receivedAt: string;
  ageMs: number;
  stale: boolean;
  periodWindows?: {
    today: { key: string; endsAt: string };
    month: { key: string; endsAt: string };
  };
  periods: { today: FakePeriod; month: FakePeriod; allTime: FakePeriod };
}

export interface FakeLimitWindow {
  kind: string;
  limitId?: string;
  label: string;
  usedPercent: number | null;
  remainingPercent: number | null;
  resetsAt: string | null;
  showMeter: boolean;
}

export interface FakeStats {
  updatedAt: string;
  staleAfterMs: number;
  periods: { today: FakePeriod; month: FakePeriod; allTime: FakePeriod };
  devices: FakeDevice[];
  limits: {
    updatedAt: string;
    providers: {
      provider: string;
      accountKey: string;
      accountLabel: string;
      planLabel: string;
      windows: FakeLimitWindow[];
    }[];
  };
  historyPreview: { summary: { activeDays: number } };
}

export const PERIODS = ['today', 'month', 'allTime'] as const;
export type PeriodName = (typeof PERIODS)[number];

const HOUR = 60 * 60 * 1000;

function period(seed: number, scale: number): FakePeriod {
  const clientModels = {
    codex: { 'gpt-5': seed * scale, 'gpt-5-mini': (seed + 1) * scale },
    claude: { 'claude-opus': (seed + 2) * scale },
  };
  const clientModelCosts = { codex: { 'gpt-5': seed / 10 }, claude: { 'claude-opus': seed / 5 } };
  return { totalTokens: 0, clientModels, clientModelCosts };
}

export function periodTokens(value: FakePeriod): number {
  return Object.values(value.clientModels)
    .flatMap((models) => Object.values(models))
    .reduce((sum, tokens) => sum + tokens, 0);
}

/** Hubと同じ規則で、端末の today・month が期限切れかを判定する。 */
export function isExpired(device: FakeDevice, name: PeriodName, nowMs: number): boolean {
  if (name === 'allTime') return false;
  const window = device.periodWindows?.[name];
  if (window) return Date.parse(window.endsAt) <= nowMs;
  const length = name === 'today' ? 10 : 7;
  return device.updatedAt.slice(0, length) !== new Date(nowMs).toISOString().slice(0, length);
}

/** 期限切れの端末分を除いて、Hub集約の totalTokens を計算し直す。 */
export function recalculateTotals(stats: FakeStats, nowMs: number): void {
  for (const name of PERIODS) {
    stats.periods[name].totalTokens = stats.devices
      .filter((device) => !isExpired(device, name, nowMs))
      .reduce((sum, device) => sum + periodTokens(device.periods[name]), 0);
  }
}

/**
 * 本番が読むstatsの形に合わせて算術生成する。端末は3台で、
 * 1台目は有効、2台目は today の endsAt が過去、3台目は periodWindows が無く更新日時が前月。
 */
export function createStats(seed: number, nowMs = Date.now()): FakeStats {
  const iso = (ms: number) => new Date(ms).toISOString();
  const now = new Date(nowMs);
  const previousMonth = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) - HOUR;
  const device = (index: number, updatedAt: number): FakeDevice => ({
    deviceId: `device-${seed}-${index}`,
    hostname: `host-${seed}-${index}`,
    osName: 'Windows',
    updatedAt: iso(updatedAt),
    receivedAt: iso(updatedAt),
    ageMs: nowMs - updatedAt,
    stale: false,
    periods: {
      today: period(seed + index, 10),
      month: period(seed + index, 100),
      allTime: period(seed + index, 1000),
    },
  });
  const active = device(1, nowMs - 60_000);
  active.periodWindows = {
    today: { key: 'today', endsAt: iso(nowMs + 12 * HOUR) },
    month: { key: 'month', endsAt: iso(nowMs + 30 * 24 * HOUR) },
  };
  const todayExpired = device(2, nowMs - 2 * HOUR);
  todayExpired.periodWindows = {
    today: { key: 'yesterday', endsAt: iso(nowMs - HOUR) },
    month: { key: 'month', endsAt: iso(nowMs + 30 * 24 * HOUR) },
  };
  const withoutWindows = device(3, previousMonth);
  const stats: FakeStats = {
    updatedAt: iso(nowMs),
    staleAfterMs: 600_000,
    periods: { today: period(0, 0), month: period(0, 0), allTime: period(0, 0) },
    devices: [active, todayExpired, withoutWindows],
    limits: {
      updatedAt: iso(nowMs),
      providers: [
        {
          provider: 'codex',
          accountKey: `account-${seed}`,
          accountLabel: `Account ${seed}`,
          planLabel: 'Pro',
          windows: [
            {
              kind: 'session',
              limitId: 'codex',
              label: 'Session',
              usedPercent: 10,
              remainingPercent: 90,
              resetsAt: iso(nowMs + HOUR),
              showMeter: true,
            },
            {
              kind: 'weekly',
              label: 'Weekly',
              usedPercent: 40,
              remainingPercent: 60,
              resetsAt: null,
              showMeter: true,
            },
            {
              kind: 'billing',
              label: 'Credits',
              usedPercent: null,
              remainingPercent: null,
              resetsAt: null,
              showMeter: false,
            },
          ],
        },
      ],
    },
    historyPreview: { summary: { activeDays: seed } },
  };
  recalculateTotals(stats, nowMs);
  return stats;
}

/** 次の接続に返す失敗。受信が止まる理由ごとに1つ。 */
export type FakeFailure = 'unauthorized' | 'redirect' | 'invalid-notification' | 'save-failure';

export interface FakeHub {
  url: string;
  token: string;
  stats: FakeStats;
  /** 認証を拒否した接続数。 */
  readonly rejected: number;
  /** 受け付けて開いているSSE接続数。 */
  readonly connected: number;
  send(event: 'snapshot' | 'stats' | 'freshness', stats: unknown): void;
  heartbeat(): void;
  /** 以後の接続に、指定した失敗を1つずつ順に返す。使い切った後は通常どおり snapshot を送る。 */
  fail(...failures: FakeFailure[]): void;
  /** 開いているSSE接続をすべて終える。 */
  disconnect(): void;
  close(): Promise<void>;
}

/** Bearerトークンを検証し、接続時に snapshot を送る制御可能なHub。sendSnapshot=false ではheartbeatだけを送る。 */
export async function startFakeHub(
  token: string,
  stats: FakeStats,
  options: { sendSnapshot?: boolean } = {},
): Promise<FakeHub> {
  const streams = new Set<ServerResponse>();
  let rejected = 0;
  const failures: FakeFailure[] = [];
  const hub = {
    url: '',
    token,
    stats,
    get rejected() {
      return rejected;
    },
    get connected() {
      return streams.size;
    },
    send(event: 'snapshot' | 'stats' | 'freshness', value: unknown) {
      // snapshot の本文は stats と同じ種類で送られる。
      const data = JSON.stringify({
        type: event === 'freshness' ? 'freshness' : 'stats',
        reason: 'ingest',
        stats: value,
        at: new Date().toISOString(),
      });
      for (const stream of streams) stream.write(`event: ${event}\ndata: ${data}\n\n`);
    },
    heartbeat() {
      for (const stream of streams) stream.write(': hb\n\n');
    },
    fail(...next: FakeFailure[]) {
      failures.push(...next);
    },
    disconnect() {
      for (const stream of streams) stream.end();
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
  const server = createServer((request, response) => {
    if (request.url !== '/api/stats/stream' || request.method !== 'GET') {
      response.writeHead(404).end();
      return;
    }
    const failure = failures.shift();
    if (failure === 'unauthorized' || request.headers.authorization !== `Bearer ${token}`) {
      rejected++;
      response.writeHead(401).end();
      return;
    }
    if (
      request.headers.accept !== 'text/event-stream' ||
      request.headers['x-token-monitor-stream'] !== '2'
    ) {
      response.writeHead(400).end();
      return;
    }
    if (failure === 'redirect') {
      response.writeHead(302, { location: `${hub.url}/api/stats/stream` }).end();
      return;
    }
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    if (failure === 'invalid-notification') {
      response.write('event: snapshot\ndata: {"type":\n\n');
    } else if (options.sendSnapshot !== false) {
      // 端末IDの重複は通知の検証を通り、保存のトランザクションで一意制約に違反する。
      const stats =
        failure === 'save-failure'
          ? { ...hub.stats, devices: [hub.stats.devices[0], hub.stats.devices[0]] }
          : hub.stats;
      const data = JSON.stringify({
        type: 'stats',
        reason: 'snapshot',
        stats,
        at: new Date().toISOString(),
      });
      response.write(`event: snapshot\ndata: ${data}\n\n`);
    }
    streams.add(response);
    request.on('close', () => streams.delete(response));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  hub.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return hub;
}
