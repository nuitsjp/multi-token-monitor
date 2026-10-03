import type { HubUsageData, HubUsageDay } from './hub-usage.ts';

// 動作合意用の固定データ。本番と同じ型を、算術だけで生成する（段階4で削除する）。
const today = '2026-10-03';
const models = [
  { name: 'claude-opus-5', weight: 1, price: 22 },
  { name: 'claude-sonnet-5-5', weight: 1.6, price: 6 },
  { name: 'gpt-6-sol', weight: 0.8, price: 9 },
  { name: 'gpt-6-luna', weight: 0.5, price: 3 },
  { name: 'claude-haiku-4-5', weight: 0.35, price: 1 },
  { name: 'gemini-3-pro', weight: 0.45, price: 7 },
  { name: 'gpt-6-mini', weight: 0.3, price: 2 },
  { name: 'claude-opus-4-1', weight: 0.2, price: 20 },
  // コスト不明のモデル（タイルのCostは「—」で、並びの最後になる）
  { name: 'grok-5', weight: 0.15, price: null },
];
const hubs = [
  { hubId: 'home', name: 'Home hub', devices: ['DESKTOP-ATSUS', 'mbp-atsus'] },
  { hubId: 'office', name: 'Office hub', devices: ['WS-DEV01', 'WS-DEV02', 'build-agent'] },
];

function days(deviceId: string, deviceIndex: number): HubUsageDay[] {
  const result: HubUsageDay[] = [];
  for (let back = 364; back >= 0; back--) {
    const date = new Date(`${today}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() - back);
    const day = date.toISOString().slice(0, 10);
    models.forEach((model, modelIndex) => {
      // 端末ごとに使うモデルを変え、日ごとに増減させる
      if ((modelIndex + deviceIndex) % 3 === 2) return;
      const wave = 0.55 + 0.45 * Math.abs(Math.sin(back * 0.9 + modelIndex * 1.7 + deviceIndex));
      const tokens = Math.round(
        model.weight * 3_000_000 * wave * (1 - (deviceIndex % 3) * 0.25) * (back % 7 > 4 ? 0.3 : 1),
      );
      result.push({
        date: day,
        deviceId,
        model: model.name,
        tokens,
        costUsd: model.price === null ? null : Math.round(tokens * model.price) / 10_000_000,
      });
    });
  }
  return result;
}

export async function fetchFixedHubUsage(): Promise<HubUsageData> {
  let deviceIndex = 0;
  return {
    today,
    hubs: hubs.map((hub) => {
      const devices = hub.devices.map((hostname) => ({
        deviceId: `${hub.hubId}-${hostname}`,
        hostname,
        osName: hostname.startsWith('mbp') ? 'macOS 15' : 'Windows 11',
        updatedAt: `${today}T01:42:00Z`,
        stale: false,
      }));
      return {
        hubId: hub.hubId,
        name: hub.name,
        connected: true,
        receivedAt: `${today}T01:42:00Z`,
        devices,
        days: devices.flatMap((device) => days(device.deviceId, deviceIndex++)),
      };
    }),
  };
}
