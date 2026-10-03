export type HubUsageDevice = {
  deviceId: string;
  hostname: string;
  osName: string | null;
  updatedAt: string;
  stale: boolean;
  historyAvailable: boolean;
};

export type HubUsageDay = {
  date: string;
  deviceId: string;
  model: string;
  tokens: number;
  costUsd: number | null;
};

export type HubUsageHub = {
  hubId: string;
  name: string;
  connected: boolean;
  receivedAt: string | null;
  historyAvailable: boolean;
  devices: HubUsageDevice[];
  days: HubUsageDay[];
};

export type HubUsageData = { today: string; hubs: HubUsageHub[] };

function createFixture(): HubUsageData {
  const models = [
    ['Claude Sonnet', 1.8],
    ['Claude Opus', 5],
    ['Codex GPT', 1.4],
    ['Codex Mini', 0.55],
    ['Gemini Pro', 1.2],
    ['Gemini Flash', 0.3],
    ['GPT Mini', 0.4],
  ] as const;
  const device = (
    deviceId: string,
    hostname: string,
    osName: string,
    time: string,
    stale = false,
  ): HubUsageDevice => ({
    deviceId,
    hostname,
    osName,
    updatedAt: `2026-10-03T${time}:00+09:00`,
    stale,
    historyAvailable: true,
  });
  const personal: HubUsageHub = {
    hubId: 'personal',
    name: 'Personal',
    connected: true,
    receivedAt: '2026-10-03T12:42:00+09:00',
    historyAvailable: true,
    devices: [
      device('desktop-atsu', 'DESKTOP-ATSU', 'Windows 11', '12:42'),
      device('macbook-pro', 'MacBook-Pro', 'macOS', '12:41'),
      device('ubuntu-dev', 'ubuntu-dev', 'Ubuntu 24.04', '10:18', true),
    ],
    days: [],
  };
  const work: HubUsageHub = {
    hubId: 'work',
    name: 'Work',
    connected: false,
    receivedAt: '2026-10-03T12:38:00+09:00',
    historyAvailable: true,
    devices: [
      device('work-laptop', 'WORK-LAPTOP', 'Windows 11', '12:38'),
      device('build-server', 'build-server', 'Ubuntu 24.04', '12:37'),
    ],
    days: [],
  };
  const scales = [
    [3.8, 1.3, 2.8, 0.52, 0.35, 0.2, 0.12],
    [1.5, 0.44, 1, 0.22, 0.13, 0.08, 0.06],
    [0, 0, 0.95, 0.33, 0.1, 0.04, 0.02],
    [3.3, 0.9, 2.3, 0.34, 0.25, 0.15, 0.08],
    [0, 0, 1.7, 0.4, 0.12, 0.07, 0.04],
  ];
  let deviceIndex = 0;
  for (const hub of [personal, work]) {
    for (const item of hub.devices) {
      const scale = scales[deviceIndex++];
      for (let day = 0; day < 365; day++) {
        const date = new Date(Date.UTC(2025, 9, 4 + day)).toISOString().slice(0, 10);
        models.forEach(([model, rate], modelIndex) => {
          const factor = 0.72 + ((day * 17 + modelIndex * 11 + deviceIndex * 7) % 31) / 50;
          const tokens = Math.round(
            100_000 * scale[modelIndex] * factor * (day === 364 ? 0.53 : 1),
          );
          if (tokens > 0)
            hub.days.push({
              date,
              deviceId: item.deviceId,
              model,
              tokens,
              costUsd: hub === work && modelIndex === 6 ? null : (tokens / 1_000_000) * rate,
            });
        });
      }
    }
  }
  return {
    today: '2026-10-03',
    hubs: [
      personal,
      work,
      {
        hubId: 'lab',
        name: 'Lab',
        connected: false,
        receivedAt: null,
        historyAvailable: false,
        devices: [],
        days: [],
      },
    ],
  };
}

const fixture =
  import.meta.env.DEV && import.meta.env.VITE_HUB_USAGE_MOCK === '1' ? createFixture() : null;

export async function fetchHubUsage(): Promise<HubUsageData> {
  if (fixture) return fixture;
  const response = await fetch('/api/hub-usage');
  if (!response.ok) throw new Error(`Unable to load Hub usage (HTTP ${response.status}).`);
  return (await response.json()) as HubUsageData;
}
