import antigravity from '../assets/antigravity.png';
import claude from '../assets/claude.svg';
import codex from '../assets/codex.png';
import cursor from '../assets/cursor.svg';
import grok from '../assets/grok.svg';
import opencode from '../assets/opencode.svg';

// Simple Icons（CC0）の提供元アイコン。24x24 の viewBox。Hubの識別子（提供元）から引く。
export const providerIcons: Record<string, string> = {
  gemini:
    'M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81',
};

// 単色のパスで表せない多色のロゴや、公式サイトのアイコン（favicon）は画像として読み込む。
export const providerImages: Record<string, string> = {
  antigravity,
  claude,
  codex,
  cursor,
  grok,
  opencode,
};
