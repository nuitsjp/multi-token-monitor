import { useMemo, useState } from 'react';
import {
  Alert,
  Checkbox,
  Container,
  Group,
  Loader,
  SegmentedControl,
  Text,
  Title,
  Tooltip,
} from '@mantine/core';
import { fetchHubUsage, type HubUsageData } from '../api/hub-usage.ts';
import { useHubUsage } from '../app/use-hub-usage.ts';
import { cost, full } from '../format.ts';
import { rangeForPreset, sumCosts, type AggregationUnit, type RangePreset } from '../hub-usage.ts';
import {
  compareItems,
  groupUnselected,
  seriesPalette,
  type UsageAggregate,
  type UsageItem,
} from '../usage-breakdown.ts';
import { HubUsageChart } from './HubUsageChart.tsx';
import { MenuIcon, type MenuIconName } from './MenuIcon.tsx';
import { SlotNumber } from './SlotNumber.tsx';
import { UsageRangeControls } from './UsageRangeControls.tsx';
import '../hub-chart.css';
import '../by-model.css';

export type BreakdownView = {
  title: string;
  icon: MenuIconName;
  listTitle: string;
  errorTitle: string;
  aggregate: (
    data: HubUsageData,
    start: string,
    end: string,
    unit: AggregationUnit,
  ) => UsageAggregate;
};

const noneHidden: ReadonlySet<string> = new Set();
const tokens = (value: number | null) => (value === null ? '—' : full.format(value));
type BreakdownSort = 'tokens' | 'cost';

function usageFor(
  view: BreakdownView,
  data: HubUsageData,
  hubId: string,
  start: string,
  end: string,
  unit: AggregationUnit,
  sortBy: BreakdownSort,
) {
  const aggregate = view.aggregate(
    { ...data, hubs: hubId === '' ? data.hubs : data.hubs.filter((hub) => hub.hubId === hubId) },
    start,
    end,
    unit,
  );
  const order = aggregate.items.map((item, index) => ({ item, index }));
  if (sortBy === 'tokens')
    order.sort((a, b) => b.item.tokens - a.item.tokens || compareItems(a.item, b.item));
  return {
    items: order.map(({ item }, index) => ({
      ...item,
      color: seriesPalette[index % seriesPalette.length],
    })),
    buckets: aggregate.buckets.map((bucket) => ({
      ...bucket,
      tokens: order.map(({ index }) => bucket.tokens[index]),
      costs: order.map(({ index }) => bucket.costs[index]),
    })),
  };
}

// By model・By device の共通画面。系列のキー（モデル名・デバイスID）で選択と色を管理する。
export function UsageBreakdownPage({ view }: { view: BreakdownView }) {
  const { data, error } = useHubUsage(fetchHubUsage);
  return (
    <Container component="main" size="xl" py="md" className="by-model-page">
      {error ? (
        <Alert color="red" title={view.errorTitle}>
          {error}
        </Alert>
      ) : null}
      {data ? <Dashboard view={view} data={data} /> : <Loader aria-label="Loading" />}
    </Container>
  );
}

function Dashboard({ view, data }: { view: BreakdownView; data: HubUsageData }) {
  const [hubId, setHubId] = useState('');
  const [sortBy, setSortBy] = useState<BreakdownSort>('tokens');
  const [preset, setPreset] = useState<RangePreset | 'custom'>('2w');
  const [custom, setCustom] = useState(() => rangeForPreset('2w', data.today));
  const [unit, setUnit] = useState<AggregationUnit>('daily');
  const range = preset === 'custom' ? custom : rangeForPreset(preset, data.today);
  const usage = useMemo(
    () => usageFor(view, data, hubId, range.start, range.end, unit, sortBy),
    [view, data, hubId, range.start, range.end, unit, sortBy],
  );
  const [chosen, setChosen] = useState(() => new Set(usage.items.slice(0, 5).map((i) => i.key)));
  const changeScope = (nextHubId: string, nextSortBy: BreakdownSort) => {
    const nextUsage = usageFor(view, data, nextHubId, range.start, range.end, unit, nextSortBy);
    setHubId(nextHubId);
    setSortBy(nextSortBy);
    setChosen(new Set(nextUsage.items.slice(0, 5).map((item) => item.key)));
  };
  const selected = usage.items.filter((item) => chosen.has(item.key));
  const chart = groupUnselected(usage, chosen);
  const toggle = (key: string) =>
    setChosen((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const empty = usage.items.length === 0;
  return (
    <>
      <Group gap={16} justify="space-between" mb="md" style={{ flex: 'none' }}>
        <Group gap={24} className="by-model-heading">
          <Group gap={10} wrap="nowrap">
            <span className="page-icon">
              <MenuIcon name={view.icon} size={26} />
            </span>
            <Title order={1} fz={26} lh={1} fw={600}>
              {view.title}
            </Title>
          </Group>
          <Group gap={20} wrap="nowrap" className="by-model-summary">
            <Group gap={6} wrap="nowrap">
              <Text size="xs" c="dimmed">
                Tokens
              </Text>
              <Text className="num">
                <SlotNumber
                  text={tokens(empty ? null : usage.items.reduce((sum, i) => sum + i.tokens, 0))}
                />
              </Text>
            </Group>
            <Group gap={6} wrap="nowrap">
              <Text size="xs" c="dimmed">
                Cost
              </Text>
              <Text className="num">
                <SlotNumber
                  text={cost(empty ? null : sumCosts(usage.items.map((item) => item.costUsd)))}
                />
              </Text>
            </Group>
          </Group>
        </Group>
        <SegmentedControl
          aria-label="Hub"
          color="violet"
          value={hubId}
          data={[
            { value: '', label: 'All' },
            ...data.hubs.map((hub) => {
              const status = hub.connected
                ? 'Connected'
                : hub.receivedAt === null
                  ? 'Not received'
                  : 'Reconnecting';
              return {
                value: hub.hubId,
                label: (
                  <Group gap={6} wrap="nowrap">
                    <span>{hub.name}</span>
                    <Tooltip label={status} withArrow>
                      <span
                        role="img"
                        aria-label={status}
                        style={{ color: hub.connected ? '#0ca30c' : '#fab219' }}
                      >
                        ●
                      </span>
                    </Tooltip>
                  </Group>
                ),
              };
            }),
          ]}
          onChange={(value) => changeScope(value, sortBy)}
        />
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
                {(['tokens', 'cost'] as const).map((kind) => (
                  <div className="by-model-plot" key={kind}>
                    <Text size="xs" c="dimmed">
                      {kind === 'tokens' ? 'Tokens' : 'Est. cost · USD'}
                    </Text>
                    <div className="by-model-plot-body">
                      <HubUsageChart
                        kind={kind}
                        fill
                        series={chart.series}
                        buckets={chart.buckets}
                        hidden={noneHidden}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <Group gap={14} mt="sm" className="by-model-legend" style={{ flex: 'none' }}>
                {chart.series.map((series) => (
                  <Group gap={6} wrap="nowrap" key={series.key}>
                    <span className="hub-chart-swatch" style={{ background: series.color }} />
                    <Text size="xs">{series.name}</Text>
                  </Group>
                ))}
              </Group>
            </>
          )}
        </section>
        <section className="card by-model-card by-model-list" aria-label={view.listTitle}>
          <Group className="by-model-list-header" gap={8} wrap="nowrap">
            <span className="page-icon">
              <MenuIcon name={view.icon} />
            </span>
            <Title order={2} fz={17} fw={500} lh={1}>
              {view.listTitle}
            </Title>
            <SegmentedControl
              aria-label={`Sort ${view.listTitle.toLowerCase()}`}
              size="xs"
              color="violet"
              ml="auto"
              value={sortBy}
              data={[
                { value: 'tokens', label: 'Tokens' },
                { value: 'cost', label: 'Cost' },
              ]}
              onChange={(value) => changeScope(hubId, value as BreakdownSort)}
            />
          </Group>
          <div className="by-model-select-all">
            <Checkbox
              size="18px"
              radius={4}
              color="violet"
              label="Select all"
              disabled={empty}
              checked={!empty && selected.length === usage.items.length}
              indeterminate={selected.length > 0 && selected.length < usage.items.length}
              onChange={() =>
                setChosen(
                  selected.length === usage.items.length
                    ? new Set()
                    : new Set(usage.items.map((i) => i.key)),
                )
              }
            />
            <Text size="xs" c="dimmed" className="num">
              {selected.length} / {usage.items.length}
            </Text>
          </div>
          <div className="by-model-tiles">
            {empty ? (
              <Text size="sm" c="dimmed">
                No history for selected range.
              </Text>
            ) : null}
            {usage.items.map((item) => (
              <UsageTile
                key={item.key}
                item={item}
                selected={chosen.has(item.key)}
                onToggle={() => toggle(item.key)}
              />
            ))}
          </div>
        </section>
      </div>
    </>
  );
}

function UsageTile({
  item,
  selected,
  onToggle,
}: {
  item: UsageItem;
  selected: boolean;
  onToggle: () => void;
}) {
  const peak = Math.max(...item.trend, 1);
  const last = Math.max(item.trend.length - 1, 1);
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
          <span className="hub-chart-swatch" style={{ background: item.color }} />
          <span>{item.name}</span>
        </span>
        <Text component="span" size="xs" c="dimmed">
          {(item.share * 100).toFixed(1)}%
        </Text>
      </span>
      {item.detail ? (
        <Text
          component="span"
          size="xs"
          c="dimmed"
          display="block"
          className="by-model-tile-detail"
        >
          {item.detail}
        </Text>
      ) : null}
      <span className="by-model-tile-cost num">
        <SlotNumber text={cost(item.costUsd)} />
      </span>
      <Text component="span" size="xs" c="dimmed" className="num" display="block">
        <SlotNumber text={`${tokens(item.tokens)} tokens`} />
      </Text>
      <svg className="by-model-spark" viewBox="0 0 120 24" preserveAspectRatio="none" aria-hidden>
        <polyline
          fill="none"
          stroke={item.color}
          strokeWidth={1.6}
          vectorEffect="non-scaling-stroke"
          points={item.trend
            .map((value, index) => `${(index / last) * 120},${22 - (value / peak) * 20}`)
            .join(' ')}
        />
      </svg>
    </button>
  );
}
