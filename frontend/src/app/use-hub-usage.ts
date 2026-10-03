import { useEffect, useState } from 'react';
import { applyHubUsageFreshness, type HubUsageData } from '../api/hub-usage.ts';
import type { HubFreshness } from '../api/overview.ts';
import { useOverview } from './overview.tsx';

// 保存確定の通知で取得し直し、鮮度更新は表示中の値へ書き込む。By hub と By model が共用する。
export function useHubUsage(load: () => Promise<HubUsageData>) {
  const [data, setData] = useState<HubUsageData>();
  const [error, setError] = useState<string>();
  const { subscribeNotifications } = useOverview();
  useEffect(() => {
    let latest = 0;
    let active = true;
    const freshness = new Map<string, HubFreshness>();
    const refresh = () => {
      const request = ++latest;
      void load().then(
        (value) => {
          if (!active || request !== latest) return;
          let next = value;
          for (const update of freshness.values()) next = applyHubUsageFreshness(next, update);
          setData(next);
          setError(undefined);
        },
        (reason: unknown) => {
          if (active && request === latest)
            setError(reason instanceof Error ? reason.message : String(reason));
        },
      );
    };
    const unsubscribe = subscribeNotifications((notification) => {
      if (notification.type === 'changed') refresh();
      else {
        freshness.set(notification.freshness.hubId, notification.freshness);
        setData((previous) =>
          previous ? applyHubUsageFreshness(previous, notification.freshness) : previous,
        );
      }
    });
    refresh();
    return () => {
      active = false;
      latest++;
      unsubscribe();
    };
  }, [load, subscribeNotifications]);
  return { data, error };
}
