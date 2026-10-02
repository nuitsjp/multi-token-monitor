import { useLayoutEffect, useRef } from 'react';
import { cost, full } from '../format.ts';

const isDigit = (char: string | undefined) => char !== undefined && char >= '0' && char <= '9';
// 同じ高さの30セルを並べたリール全体の高さから移動量を求める。
const cell = (index: number) => `translateY(${(-index * 100) / 30}%)`;
const reelDigits = Array.from({ length: 30 }, (_, index) => index % 10);

// 整形済みの文字列を表示し、変わった数字の桁だけを1周以上回して左の桁から順に止める。
// 見た目の文字は擬似要素で描き、DOMのテキストには値を1回だけ置く（読み上げと textContent 用）。
export function SlotNumber({ text }: { text: string }) {
  // 桁は右端からの位置で対応づける。桁数が変わっても下位の桁は同じリールのまま回る。
  const chars = [...text].reverse();
  const strips = useRef(new Map<number, HTMLSpanElement>());
  const previous = useRef<string | null>(null);

  useLayoutEffect(() => {
    const before = previous.current;
    // 同じ値での再実行（StrictModeの再実行）では、回転中のリールをそのまま回す。
    if (before === text) return;
    previous.current = text;
    for (const strip of strips.current.values())
      for (const animation of strip.getAnimations()) animation.cancel();
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const old = before === null ? [] : [...before].reverse();
    const next = [...text].reverse();
    const numeric = (value: string) => Number(value.replace(/[^\d.]/g, ''));
    const up = before === null || numeric(text) >= numeric(before);
    const changed = next
      .map((char, index) => index)
      .filter((index) => isDigit(next[index]) && next[index] !== old[index])
      .reverse();
    changed.forEach((index, order) => {
      const strip = strips.current.get(index)!;
      const from = isDigit(old[index]) ? Number(old[index]) : 0;
      const to = Number(next[index]);
      // 1周（10桁）を足して必ず回す。減少は3周目から下へ回す（リールは0〜9を3周並べている）。
      const distance = (((up ? to - from : from - to) + 10) % 10) + 10;
      const start = up ? from : from + 20;
      const end = up ? start + distance : start - distance;
      const duration = 700 + order * 120;
      const reel = strip.parentElement!;
      reel.dataset.spinning = '';
      const animation = strip.animate([{ transform: cell(start) }, { transform: cell(end) }], {
        duration,
        easing: 'cubic-bezier(.2,.75,.3,1.12)',
      });
      strip.animate(
        [
          { filter: 'blur(0)' },
          { filter: 'blur(1.2px)', offset: 0.25 },
          { filter: 'blur(0)', offset: 0.8 },
        ],
        { duration },
      );
      animation.onfinish = animation.oncancel = () => delete reel.dataset.spinning;
    });
  }, [text]);

  return (
    <span className="slot" data-text={text}>
      <span className="slot-text">{text}</span>
      <span className="slot-visual" aria-hidden="true">
        {chars
          .map((char, index) =>
            isDigit(char) ? (
              <span key={index} className="slot-reel">
                <span
                  className="slot-strip"
                  style={{ transform: cell(Number(char)) }}
                  ref={(element) => {
                    if (element) strips.current.set(index, element);
                    return () => {
                      strips.current.delete(index);
                    };
                  }}
                >
                  {reelDigits.map((digit, row) => (
                    <span key={row} className="slot-digit" data-char={digit} />
                  ))}
                </span>
              </span>
            ) : (
              <span key={index} className="slot-char" data-char={char} />
            ),
          )
          .reverse()}
      </span>
    </span>
  );
}

export function TokenCount({ value }: { value: number }) {
  return <SlotNumber text={full.format(value)} />;
}

export function CostUsd({ value }: { value: number | null }) {
  return <SlotNumber text={cost(value)} />;
}
