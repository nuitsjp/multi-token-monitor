import type { HubFreshness } from './overview.ts';

import type { components } from '../../../contracts/api.gen.ts';

export type HubUsageDevice = components['schemas']['HubUsageDeviceOutput'];
export type HubUsageDay = components['schemas']['HubUsageDayOutput'];
export type HubUsageHub = components['schemas']['HubUsageHubOutput'];
export type HubUsageData = components['schemas']['HubUsageDataOutput'];

export async function fetchHubUsage(): Promise<HubUsageData> {
  const response = await fetch('/api/hub-usage');
  if (!response.ok) throw new Error(`Unable to load Hub usage (HTTP ${response.status}).`);
  return (await response.json()) as HubUsageData;
}

export function applyHubUsageFreshness(data: HubUsageData, freshness: HubFreshness): HubUsageData {
  const updates = new Map(freshness.devices.map((device) => [device.deviceId, device]));
  return {
    ...data,
    hubs: data.hubs.map((hub) => {
      if (
        hub.hubId !== freshness.hubId ||
        (hub.receivedAt !== null && Date.parse(hub.receivedAt) >= Date.parse(freshness.receivedAt))
      )
        return hub;
      return {
        ...hub,
        connected: true,
        receivedAt: freshness.receivedAt,
        devices: hub.devices.map((device) => {
          const update = updates.get(device.deviceId);
          return update ? { ...device, updatedAt: update.updatedAt, stale: update.stale } : device;
        }),
      };
    }),
  };
}
