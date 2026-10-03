import {
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
  useCallback,
  type ReactNode,
} from 'react';
import { watchOverview, type Overview, type OverviewNotification } from '../api/overview.ts';

type NotificationListener = (notification: OverviewNotification) => void;
type OverviewState = {
  overview?: Overview;
  error?: string;
  subscribeNotifications: (listener: NotificationListener) => () => void;
};

const OverviewContext = createContext<OverviewState>({ subscribeNotifications: () => () => {} });

// 変更通知の購読は画面全体で1つにし、メニューと各ページが同じ状態を読む。
export function OverviewProvider({ children }: { children: ReactNode }) {
  const [overview, setOverview] = useState<Overview>();
  const [error, setError] = useState<string>();
  const listeners = useRef(new Set<NotificationListener>());
  const subscribeNotifications = useCallback((listener: NotificationListener) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);
  useEffect(
    () =>
      watchOverview(
        setOverview,
        (reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)),
        (notification) => {
          for (const listener of listeners.current) listener(notification);
        },
      ),
    [],
  );
  return (
    <OverviewContext value={{ overview, error, subscribeNotifications }}>
      {children}
    </OverviewContext>
  );
}

export const useOverview = () => useContext(OverviewContext);
