import type { HubUsageData } from './api/hub-usage.ts';
import type { AggregationUnit } from './hub-usage.ts';
import { aggregateUsage } from './usage-breakdown.ts';

// 同じデバイスIDは Hub・ツール・モデルをまたいで合算し、ホスト名とOSで示す。
export function aggregateDevices(
  data: HubUsageData,
  start: string,
  end: string,
  unit: AggregationUnit,
) {
  const devices = new Map(
    data.hubs.map((hub) => [hub.hubId, new Map(hub.devices.map((d) => [d.deviceId, d]))]),
  );
  return aggregateUsage(data, start, end, unit, (hub, day) => {
    const device = devices.get(hub.hubId)!.get(day.deviceId);
    return {
      key: day.deviceId,
      name: device?.hostname ?? day.deviceId,
      detail: device?.osName ?? null,
    };
  });
}
