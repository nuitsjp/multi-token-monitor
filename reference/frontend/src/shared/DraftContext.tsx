import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
  type RefObject,
} from 'react';
import { useBlocker } from '@tanstack/react-router';
// 未保存の有無は確認ダイアログを出す操作時にだけ読むため、再描画を起こさないrefで共有する。
const Context = createContext<RefObject<boolean> | null>(null);
export function DraftProvider({ children }: { children: ReactNode }) {
  const dirty = useRef(false);
  return <Context.Provider value={dirty}>{children}</Context.Provider>;
}
export function useDraft() {
  const value = useContext(Context);
  if (!value) throw new Error('DraftProviderが必要です');
  return value;
}
// 未保存の下書きを持つ画面が呼ぶ。keepsDraftは下書きを引き継ぐ遷移先を判定する。
export function useDraftDirty(
  dirty: boolean,
  keepsDraft: (pathname: string) => boolean = () => false,
) {
  const draft = useDraft();
  useEffect(() => {
    draft.current = dirty;
    return () => {
      draft.current = false;
    };
  }, [dirty, draft]);
  useBlocker({
    shouldBlockFn: ({ next }) =>
      dirty &&
      !keepsDraft(next.pathname) &&
      !window.confirm('未保存の入力を破棄して移動しますか？'),
    enableBeforeUnload: dirty,
  });
}
