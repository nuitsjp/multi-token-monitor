import { Group, NativeSelect, SegmentedControl } from '@mantine/core';
import type { AggregationUnit, RangePreset } from '../hub-usage.ts';
import { HubRangePicker } from './HubRangePicker.tsx';

type Range = { start: string; end: string };
type Props = {
  today: string;
  range: Range;
  preset: RangePreset | 'custom';
  unit: AggregationUnit;
  onCustom: (range: Range) => void;
  onPreset: (preset: RangePreset) => void;
  onUnit: (unit: AggregationUnit) => void;
};

// By hub と By model のグラフに共通する、期間と集約単位の操作欄。
export function UsageRangeControls({
  today,
  range,
  preset,
  unit,
  onCustom,
  onPreset,
  onUnit,
}: Props) {
  return (
    <Group gap={8} wrap="wrap">
      <HubRangePicker today={today} range={range} onChange={onCustom} />
      <SegmentedControl
        aria-label="Date range"
        color="violet"
        value={preset}
        data={['7d', '2w', '4w', '3m', '1y'].map((value) => ({
          value,
          label: value.toUpperCase(),
        }))}
        onChange={(value) => onPreset(value as RangePreset)}
      />
      <NativeSelect
        aria-label="Aggregation"
        value={unit}
        onChange={(event) => onUnit(event.currentTarget.value as AggregationUnit)}
        data={[
          { value: 'daily', label: 'Daily' },
          { value: 'weekly', label: 'Weekly' },
          { value: 'monthly', label: 'Monthly' },
        ]}
      />
    </Group>
  );
}
