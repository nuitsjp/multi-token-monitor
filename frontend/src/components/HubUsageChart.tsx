import { useEffect, useId, useState, type ReactNode } from 'react';
import { Group, Stack, Text, Tooltip } from '@mantine/core';
import { full } from '../format.ts';
import '../hub-chart.css';

export type ChartSeries = { key: string; name: string; color: string };
export type ChartBucket = {
  key: string;
  label: string;
  tokens: (number | null)[];
  costs: (number | null)[];
};

type Props = {
  kind: 'tokens' | 'cost';
  series: ChartSeries[];
  buckets: ChartBucket[];
  hidden: ReadonlySet<string>;
  // true のとき、固定の縦横比ではなく、置かれた領域の大きさに合わせて描く。
  fill?: boolean;
};

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
});
const coordinate = (value: number) => Math.round(value * 10) / 10;

function BucketTooltip({
  label,
  summary,
  x,
  y,
  width,
  height,
}: {
  label: ReactNode;
  summary: string;
  x: number;
  y: number;
  width: number;
  height: number;
}) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  return (
    <Tooltip withArrow multiline opened={hovered || focused} label={label}>
      <rect
        className="hub-chart-target"
        x={x}
        y={y}
        width={width}
        height={height}
        fill="transparent"
        tabIndex={0}
        role="graphics-symbol"
        aria-label={summary}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            setFocused(false);
            setHovered(false);
          }
        }}
      />
    </Tooltip>
  );
}

export function HubUsageChart({ kind, series, buckets, hidden, fill = false }: Props) {
  const titleId = useId();
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    if (!fill || !host) return;
    const measure = () => setSize({ width: host.clientWidth, height: host.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, [fill, host]);
  const visible = series
    .map((entry, index) => ({ ...entry, index }))
    .filter((entry) => !hidden.has(entry.key));
  const values = buckets.map((bucket) => (kind === 'tokens' ? bucket.tokens : bucket.costs));
  const totals = values.map((row) => {
    const known = visible
      .map((entry) => row[entry.index])
      .filter((value): value is number => value !== null);
    return known.length === 0 ? null : known.reduce((sum, value) => sum + value, 0);
  });
  const costProvided = buckets.some((bucket) => bucket.costs.some((value) => value !== null));
  if (kind === 'cost' && !costProvided) {
    return (
      <Text c="dimmed" size="sm" className="hub-chart-empty">
        Estimated cost unavailable
      </Text>
    );
  }

  const width = fill
    ? size.width
    : buckets.length > 90
      ? Math.max(720, buckets.length * 14 + 68)
      : 720;
  const height = fill ? size.height : 230;
  const maxTokens = Math.max(
    0,
    ...buckets.map((bucket) =>
      visible.reduce((sum, entry) => sum + (bucket.tokens[entry.index] ?? 0), 0),
    ),
  );
  const left = Math.max(90, full.format(Math.ceil(maxTokens * 1.1)).length * 8 + 16);
  const right = 10;
  const top = 12;
  const bottom = 30;
  const plotHeight = height - top - bottom;
  const plotWidth = width - left - right;
  const slot = plotWidth / Math.max(buckets.length, 1);
  const barWidth = Math.min(26, slot * 0.62);
  let maximum = 0;
  for (const total of totals) maximum = Math.max(maximum, total ?? 0);
  const limit = maximum === 0 ? 1 : maximum * 1.1;
  const labelStep = Math.max(1, Math.ceil((buckets.length - 1) / 7));
  const lastIndex = buckets.length - 1;
  const labels = new Set<number>([lastIndex]);
  for (let index = 0; index < lastIndex; index += labelStep) {
    if (lastIndex - index >= labelStep) labels.add(index);
  }
  const format = (value: number | null) =>
    value === null ? '—' : kind === 'tokens' ? full.format(value) : usd.format(value);
  const title = kind === 'tokens' ? 'Model tokens' : 'Estimated cost (USD)';

  if (fill && (width <= 0 || height <= 0)) return <div ref={setHost} className="hub-chart-fill" />;
  return (
    <div ref={fill ? setHost : undefined} className={fill ? 'hub-chart-fill' : 'hub-chart-scroll'}>
      <svg
        className="hub-usage-chart"
        style={fill ? { width, height } : { minWidth: buckets.length > 90 ? width : undefined }}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-labelledby={titleId}
      >
        <title id={titleId}>{title}</title>
        {Array.from({ length: 5 }, (_, tick) => {
          const amount = (limit * tick) / 4;
          const y = coordinate(top + plotHeight * (1 - tick / 4));
          return (
            <g key={tick}>
              <line className="hub-chart-grid" x1={left} x2={width - right} y1={y} y2={y} />
              <text className="hub-chart-axis" x={left - 9} y={y + 4} textAnchor="end">
                {kind === 'tokens' ? full.format(Math.round(amount)) : usd.format(amount)}
              </text>
            </g>
          );
        })}
        {buckets.map((bucket, index) => {
          const row = values[index];
          let stacked = 0;
          const rects = visible.map((entry) => {
            const value = row[entry.index];
            if (value === null) return null;
            const barHeight = (value / limit) * plotHeight;
            stacked += barHeight;
            return (
              <rect
                key={entry.key}
                x={coordinate(left + slot * (index + 0.5) - barWidth / 2)}
                y={coordinate(top + plotHeight - stacked)}
                width={coordinate(barWidth)}
                height={coordinate(barHeight)}
                fill={entry.color}
              />
            );
          });
          const partial =
            kind === 'cost' &&
            visible.some((entry) => row[entry.index] === null) &&
            totals[index] !== null;
          const summary = `${bucket.label}: ${format(totals[index])}${partial ? ' (known amounts)' : ''}`;
          return (
            <g key={bucket.key}>
              {rects}
              {labels.has(index) ? (
                <text
                  className="hub-chart-axis"
                  x={coordinate(left + slot * (index + 0.5))}
                  y={height - 8}
                  textAnchor="middle"
                >
                  {bucket.label}
                </text>
              ) : null}
              <BucketTooltip
                summary={summary}
                x={coordinate(left + slot * index)}
                y={top}
                width={coordinate(slot)}
                height={plotHeight}
                label={
                  <Stack gap={4}>
                    <Text size="xs" fw={600}>
                      {summary}
                    </Text>
                    {visible.map((entry) => (
                      <Group key={entry.key} gap={12} justify="space-between" wrap="nowrap">
                        <Group gap={6} wrap="nowrap">
                          <span className="hub-chart-swatch" style={{ background: entry.color }} />
                          <Text size="xs">{entry.name}</Text>
                        </Group>
                        <Text size="xs">{format(row[entry.index])}</Text>
                      </Group>
                    ))}
                  </Stack>
                }
              />
            </g>
          );
        })}
      </svg>
    </div>
  );
}
