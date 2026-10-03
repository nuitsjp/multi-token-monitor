import { Tooltip } from '@mantine/core';
import { costWhole } from '../format.ts';

// 月換算上限額。契約の見出し行の右端か、枠グループの先頭の円の右上に置く（位置は親の CSS で決まる）。
export function MonthlyLimit({ value }: { value: number }) {
  return (
    <Tooltip
      multiline
      w={220}
      withArrow
      styles={{
        tooltip: { background: '#111215', color: '#e4e5e9', border: '1px solid #3a3d48' },
      }}
      label="各枠の上限額を月換算し、最も小さい金額を採用した参考値です。"
    >
      <span className="limit-monthly">{costWhole(value)}/mo</span>
    </Tooltip>
  );
}
