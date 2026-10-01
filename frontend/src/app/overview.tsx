import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { watchOverview, type Overview } from '../api/overview.ts';

type OverviewState = { overview?: Overview; error?: string };

const OverviewContext = createContext<OverviewState>({});

// 変更通知の購読は画面全体で1つにし、メニューと各ページが同じ状態を読む。
export function OverviewProvider({ children }: { children: ReactNode }) {
  const [overview, setOverview] = useState<Overview>();
  const [error, setError] = useState<string>();
  useEffect(
    () =>
      watchOverview(setOverview, (reason: unknown) =>
        setError(reason instanceof Error ? reason.message : String(reason)),
      ),
    [],
  );
  return <OverviewContext value={{ overview, error }}>{children}</OverviewContext>;
}

export const useOverview = () => useContext(OverviewContext);
