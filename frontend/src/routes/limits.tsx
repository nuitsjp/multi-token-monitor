import { useEffect, useMemo, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { Alert, Checkbox, Container, Group, Loader, Text, Title, Tooltip } from '@mantine/core';
import { fetchLimitHistory, type LimitHistoryData } from '../api/limit-history.ts';
import { useOverview } from '../app/overview.tsx';
import { LimitTrendChart, perMonth, times } from '../components/LimitTrendChart.tsx';
import { MenuIcon } from '../components/MenuIcon.tsx';
import { ProviderIcon } from '../components/ProviderIcon.tsx';
import { joinLabels } from '../components/SideMenu.tsx';
import { SlotNumber } from '../components/SlotNumber.tsx';
import { UsageRangeControls } from '../components/UsageRangeControls.tsx';
import { rangeForPreset, type AggregationUnit, type RangePreset } from '../hub-usage.ts';
import { aggregateLimitHistory, type LimitProductHistory } from '../limit-history.ts';
import '../hub-chart.css';
import '../by-model.css';
import '../limits.css';

export const Route = createFileRoute('/limits')({ component: UsageLimits });

const productName = (product: { provider: string; plan: string | null }) =>
  joinLabels(product.provider, product.plan);

export function UsageLimits() {
  const [data, setData] = useState<LimitHistoryData>();
  const [error, setError] = useState<string>();
  const { subscribeNotifications } = useOverview();
  useEffect(() => {
    let active = true;
    const refresh = () =>
      void fetchLimitHistory().then(
        (value) => {
          if (!active) return;
          setData(value);
          setError(undefined);
        },
        (reason: unknown) => {
          if (active) setError(reason instanceof Error ? reason.message : String(reason));
        },
      );
    const unsubscribe = subscribeNotifications((notification) => {
      if (notification.type === 'changed') refresh();
    });
    refresh();
    return () => {
      active = false;
      unsubscribe();
    };
  }, [subscribeNotifications]);
  return (
    <Container component="main" size="xl" py="md" className="by-model-page">
      {error ? (
        <Alert color="red" title="Unable to load usage limits">
          {error}
        </Alert>
      ) : null}
      {data ? <LimitDashboard data={data} /> : <Loader aria-label="Loading" />}
    </Container>
  );
}

function LimitDashboard({ data }: { data: LimitHistoryData }) {
  const [preset, setPreset] = useState<RangePreset | 'custom'>('3m');
  const [custom, setCustom] = useState(() => rangeForPreset('3m', data.today));
  const [unit, setUnit] = useState<AggregationUnit>('weekly');
  const range = preset === 'custom' ? custom : rangeForPreset(preset, data.today);
  const history = useMemo(
    () => aggregateLimitHistory(data, range.start, range.end, unit),
    [data, range.start, range.end, unit],
  );
  const [chosen, setChosen] = useState(() => new Set(history.products.map((p) => p.key)));
  const selected = history.products.filter((product) => chosen.has(product.key));
  const series = selected.map((product) => ({
    key: product.key,
    name: joinLabels(productName(product), product.group || null),
    color: product.color,
  }));
  const toggle = (key: string) =>
    setChosen((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const empty = history.products.length === 0;
  return (
    <>
      <Group gap={10} wrap="nowrap" mb="md" style={{ flex: 'none' }}>
        <span className="page-icon">
          <MenuIcon name="limits" size={26} />
        </span>
        <Title order={1} fz={26} lh={1} fw={600}>
          Usage limits
        </Title>
      </Group>
      <div className="by-model-workspace">
        <section className="card by-model-card" aria-label="Usage over time">
          <Group justify="space-between" className="by-model-chart-toolbar" gap={12} wrap="wrap">
            <Group gap={8} wrap="nowrap">
              <span className="page-icon">
                <MenuIcon name="logo" />
              </span>
              <Title order={2} fz={17} fw={500} lh={1}>
                Usage over time
              </Title>
            </Group>
            <UsageRangeControls
              today={data.today}
              range={range}
              preset={preset}
              unit={unit}
              onCustom={(value) => {
                setCustom(value);
                setPreset('custom');
              }}
              onPreset={setPreset}
              onUnit={setUnit}
            />
          </Group>
          {empty ? (
            <Text c="dimmed" py="xl">
              No history for selected range.
            </Text>
          ) : (
            <>
              <div className="by-model-plots">
                {(['limit', 'multiplier'] as const).map((kind) => (
                  <div className="by-model-plot" key={kind}>
                    <Text size="xs" c="dimmed">
                      {kind === 'limit' ? 'Monthly limit · USD/mo' : 'Multiplier · × price'}
                    </Text>
                    <div className="by-model-plot-body">
                      <LimitTrendChart kind={kind} series={series} buckets={history.buckets} />
                    </div>
                  </div>
                ))}
              </div>
              <Group gap={14} mt="sm" className="by-model-legend" style={{ flex: 'none' }}>
                {series.map((entry) => (
                  <Group gap={6} wrap="nowrap" key={entry.key}>
                    <span className="hub-chart-swatch" style={{ background: entry.color }} />
                    <Text size="xs">{entry.name}</Text>
                  </Group>
                ))}
              </Group>
            </>
          )}
        </section>
        <section className="card by-model-card by-model-list" aria-label="Plans">
          <Group className="by-model-list-header" gap={8} wrap="nowrap">
            <span className="page-icon">
              <MenuIcon name="limits" />
            </span>
            <Title order={2} fz={17} fw={500} lh={1}>
              Plans
            </Title>
          </Group>
          <div className="by-model-select-all">
            <Checkbox
              size="18px"
              radius={4}
              color="violet"
              label="Select all"
              disabled={empty}
              checked={!empty && selected.length === history.products.length}
              indeterminate={selected.length > 0 && selected.length < history.products.length}
              onChange={() =>
                setChosen(
                  selected.length === history.products.length
                    ? new Set()
                    : new Set(history.products.map((product) => product.key)),
                )
              }
            />
            <Text size="xs" c="dimmed" className="num">
              {selected.length} / {history.products.length}
            </Text>
          </div>
          <div className="by-model-tiles">
            {empty ? (
              <Text size="sm" c="dimmed">
                No history for selected range.
              </Text>
            ) : null}
            {history.products.map((product) => (
              <PlanTile
                key={product.key}
                product={product}
                selected={chosen.has(product.key)}
                onToggle={() => toggle(product.key)}
              />
            ))}
          </div>
        </section>
      </div>
    </>
  );
}

function PlanTile({
  product,
  selected,
  onToggle,
}: {
  product: LimitProductHistory;
  selected: boolean;
  onToggle: () => void;
}) {
  // 上限額の変動は値の大きさに比べて小さいため、期間内の最小値から最大値までで描く。
  const low = Math.min(...product.trend);
  const span = Math.max(...product.trend) - low || 1;
  const last = Math.max(product.trend.length - 1, 1);
  const change = Math.round(product.change * 100);
  const noPrice = product.latest.priceUsd === null;
  return (
    <button type="button" className="by-model-tile" aria-pressed={selected} onClick={onToggle}>
      <span className="by-model-tile-row">
        <span className="by-model-tile-name">
          <span className="by-model-check" aria-hidden>
            <svg
              viewBox="0 0 12 12"
              width="12"
              height="12"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M2.5 6.5l2.5 2.5 4.5-5.5" />
            </svg>
          </span>
          <span className="hub-chart-swatch" style={{ background: product.color }} />
          <ProviderIcon provider={product.provider} size={16} />
          <span>{productName(product)}</span>
        </span>
        <Text component="span" size="xs" c="dimmed" className="num">
          {change >= 0 ? '+' : ''}
          {change}%
        </Text>
      </span>
      <Text component="span" size="xs" c="dimmed" display="block" className="limits-tile-scope">
        {joinLabels(product.group || null, product.hubName)}
      </Text>
      <span className="by-model-tile-cost num">
        <SlotNumber text={perMonth(product.latest.limitUsd)} />
      </span>
      <Tooltip label="No price for this plan." withArrow disabled={!noPrice}>
        <Text component="span" size="xs" c="dimmed" className="num" display="block">
          {perMonth(product.latest.priceUsd)} · {times(product.latest.multiplier)}
        </Text>
      </Tooltip>
      <svg className="by-model-spark" viewBox="0 0 120 24" preserveAspectRatio="none" aria-hidden>
        <polyline
          fill="none"
          stroke={product.color}
          strokeWidth={1.6}
          vectorEffect="non-scaling-stroke"
          points={product.trend
            .map((value, index) => `${(index / last) * 120},${22 - ((value - low) / span) * 20}`)
            .join(' ')}
        />
      </svg>
    </button>
  );
}
