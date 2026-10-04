import { useEffect, useId, useState } from 'react';
import { Group, Stack, Text } from '@mantine/core';
import { costWhole } from '../format.ts';
import type { LimitHistoryAggregate, LimitPoint } from '../limit-history.ts';
import { BucketTooltip } from './HubUsageChart.tsx';
import '../hub-chart.css';

type Series = { key: string; name: string; color: string };
type Props = {
  kind: 'limit' | 'multiplier';
  series: Series[];
  buckets: LimitHistoryAggregate['buckets'];
};

// 下限値（lowerBound）は「≥ 」を前に付ける。値が無ければ N/A。
const atLeast = (lowerBound: boolean) => (lowerBound ? '≥ ' : '');
export const perMonth = (value: number | null, lowerBound = false) =>
  value === null ? 'N/A' : `${atLeast(lowerBound)}${costWhole(value)}/mo`;
export const times = (value: number | null, lowerBound = false) =>
  value === null ? 'N/A' : `${atLeast(lowerBound)}×${value.toFixed(1)}`;
const coordinate = (value: number) => Math.round(value * 10) / 10;

// 契約ごとの折れ線。下限値の点も値のまま結ぶ。記録の無い点で線を途切れさせ、点の位置に印を置く。置かれた領域の大きさに合わせて描く。
export function LimitTrendChart({ kind, series, buckets }: Props) {
  const titleId = useId();
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    if (!host) return;
    const measure = () => setSize({ width: host.clientWidth, height: host.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, [host]);
  const valueOf = (point: LimitPoint | undefined) =>
    point === undefined ? null : kind === 'limit' ? point.limitUsd : point.multiplier;
  const format = (value: number) => (kind === 'limit' ? costWhole(value) : times(value));
  let maximum = 0;
  for (const bucket of buckets)
    for (const entry of series)
      maximum = Math.max(maximum, valueOf(bucket.points.get(entry.key)) ?? 0);
  const limit = maximum === 0 ? 1 : maximum * 1.1;
  const { width, height } = size;
  // 上下のグラフで横軸の位置を揃えるため、軸の幅は固定にする。
  const left = 72;
  const right = 10;
  const top = 12;
  const bottom = 30;
  const plotHeight = height - top - bottom;
  const plotWidth = width - left - right;
  const slot = plotWidth / Math.max(buckets.length, 1);
  const x = (index: number) => coordinate(left + slot * (index + 0.5));
  const y = (value: number) => coordinate(top + plotHeight * (1 - value / limit));
  const labelStep = Math.max(1, Math.ceil((buckets.length - 1) / 7));
  const lastIndex = buckets.length - 1;
  const labels = new Set<number>([lastIndex]);
  for (let index = 0; index < lastIndex; index += labelStep)
    if (lastIndex - index >= labelStep) labels.add(index);

  if (width <= 0 || height <= 0) return <div ref={setHost} className="hub-chart-fill" />;
  return (
    <div ref={setHost} className="hub-chart-fill">
      <svg
        className="hub-usage-chart"
        style={{ width, height }}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-labelledby={titleId}
      >
        <title id={titleId}>{kind === 'limit' ? 'Monthly limit' : 'Multiplier'}</title>
        {Array.from({ length: 5 }, (_, tick) => {
          const amount = (limit * tick) / 4;
          return (
            <g key={tick}>
              <line
                className="hub-chart-grid"
                x1={left}
                x2={width - right}
                y1={y(amount)}
                y2={y(amount)}
              />
              <text className="hub-chart-axis" x={left - 9} y={y(amount) + 4} textAnchor="end">
                {format(amount)}
              </text>
            </g>
          );
        })}
        {series.map((entry) => {
          const segments: string[][] = [[]];
          const dots: [number, number][] = [];
          buckets.forEach((bucket, index) => {
            const value = valueOf(bucket.points.get(entry.key));
            if (value === null) {
              if (segments[segments.length - 1].length > 0) segments.push([]);
              return;
            }
            segments[segments.length - 1].push(`${x(index)},${y(value)}`);
            dots.push([x(index), y(value)]);
          });
          return (
            <g key={entry.key}>
              {segments.map((points, index) => (
                <polyline
                  key={index}
                  fill="none"
                  stroke={entry.color}
                  strokeWidth={2}
                  points={points.join(' ')}
                />
              ))}
              {dots.map(([cx, cy]) => (
                <circle key={`${cx}`} cx={cx} cy={cy} r={2.5} fill={entry.color} />
              ))}
            </g>
          );
        })}
        {buckets.map((bucket, index) => (
          <g key={bucket.key}>
            {labels.has(index) ? (
              <text className="hub-chart-axis" x={x(index)} y={height - 8} textAnchor="middle">
                {bucket.label}
              </text>
            ) : null}
            <BucketTooltip
              summary={bucket.label}
              x={coordinate(left + slot * index)}
              y={top}
              width={coordinate(slot)}
              height={plotHeight}
              label={
                <Stack gap={4}>
                  <Text size="xs" fw={600}>
                    {bucket.label}
                  </Text>
                  {series.map((entry) => {
                    const point = bucket.points.get(entry.key);
                    return (
                      <Group key={entry.key} gap={12} justify="space-between" wrap="nowrap">
                        <Group gap={6} wrap="nowrap">
                          <span className="hub-chart-swatch" style={{ background: entry.color }} />
                          <Text size="xs">{entry.name}</Text>
                        </Group>
                        <Text size="xs" className="num">
                          {point === undefined
                            ? '—'
                            : `${perMonth(point.limitUsd, point.lowerBound)} · ${perMonth(point.priceUsd)} · ${times(point.multiplier, point.lowerBound)}`}
                        </Text>
                      </Group>
                    );
                  })}
                </Stack>
              }
            />
          </g>
        ))}
      </svg>
    </div>
  );
}
