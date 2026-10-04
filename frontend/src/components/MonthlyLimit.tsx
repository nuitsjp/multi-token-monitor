import { Tooltip } from '@mantine/core';
import { costWhole } from '../format.ts';

export const monthlyTooltipStyles = {
  tooltip: { background: '#111215', color: '#e4e5e9', border: '1px solid #3a3d48' },
};

// 契約の月換算上限額。契約の見出し行の右端に置く。下限値は「≥ 」を付ける。
export function MonthlyLimit({ value, lowerBound }: { value: number; lowerBound: boolean }) {
  return (
    <Tooltip
      multiline
      w={240}
      withArrow
      styles={monthlyTooltipStyles}
      label={
        'Reference estimate: the total of the monthly limits of the window groups.' +
        (lowerBound ? ' Some window groups have no estimate yet, so this is a lower bound.' : '')
      }
    >
      <span className="limit-monthly">
        {lowerBound ? '≥ ' : ''}
        {costWhole(value)}
        <span className="limit-monthly-unit">/mo</span>
      </span>
    </Tooltip>
  );
}
