import { useMemo, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import {
  Alert,
  Checkbox,
  Container,
  Group,
  Loader,
  SegmentedControl,
  Text,
  Title,
} from '@mantine/core';
import { fetchHubUsage, type HubUsageData } from '../api/hub-usage.ts';
import { useHubUsage } from '../app/use-hub-usage.ts';
import { HubUsageChart } from '../components/HubUsageChart.tsx';
import { MenuIcon } from '../components/MenuIcon.tsx';
import { SlotNumber } from '../components/SlotNumber.tsx';
import { UsageRangeControls } from '../components/UsageRangeControls.tsx';
import { cost, full } from '../format.ts';
import { rangeForPreset, sumCosts, type AggregationUnit, type RangePreset } from '../hub-usage.ts';
import { aggregateModels, groupUnselected, modelPalette, type ModelUsage } from '../model-usage.ts';
import '../hub-chart.css';
import '../by-model.css';

export const Route = createFileRoute('/by-model')({ component: ByModel });

const noneHidden: ReadonlySet<string> = new Set();
const tokens = (value: number | null) => (value === null ? '—' : full.format(value));
const loadModelUsage =
  import.meta.env.DEV && import.meta.env.VITE_MODEL_USAGE_MOCK === '1'
    ? () => import('../mocks/model-usage.ts').then(({ modelUsageMock }) => modelUsageMock)
    : fetchHubUsage;

export function ByModel() {
  const { data, error } = useHubUsage(loadModelUsage);
  return (
    <Container component="main" size="xl" py="md" className="by-model-page">
      {error ? (
        <Alert color="red" title="Unable to load model information">
          {error}
        </Alert>
      ) : null}
      {data ? <ModelDashboard data={data} /> : <Loader aria-label="Loading" />}
    </Container>
  );
}

function ModelDashboard({ data }: { data: HubUsageData }) {
  const [hubId, setHubId] = useState('');
  const [preset, setPreset] = useState<RangePreset | 'custom'>('2w');
  const [custom, setCustom] = useState(() => rangeForPreset('2w', data.today));
  const [unit, setUnit] = useState<AggregationUnit>('daily');
  const range = preset === 'custom' ? custom : rangeForPreset(preset, data.today);
  const costUsage = useMemo(
    () =>
      aggregateModels(
        {
          ...data,
          hubs: hubId === '' ? data.hubs : data.hubs.filter((hub) => hub.hubId === hubId),
        },
        range.start,
        range.end,
        unit,
      ),
    [data, hubId, range.start, range.end, unit],
  );
  // 選択はモデル名で保持する。最初の表示では、コストの大きい順の上位5モデルを選ぶ。
  const [chosen, setChosen] = useState(
    () => new Set(costUsage.models.slice(0, 5).map((m) => m.name)),
  );
  // タイルと両グラフを構成比順に揃える。コスト順は初期選択にだけ使う。
  const usage = useMemo(() => {
    const order = costUsage.models
      .map((model, index) => ({ model, index }))
      .sort((a, b) => b.model.share - a.model.share || a.model.name.localeCompare(b.model.name));
    return {
      models: order.map(({ model }, index) => ({
        ...model,
        color: modelPalette[index % modelPalette.length],
      })),
      buckets: costUsage.buckets.map((bucket) => ({
        ...bucket,
        tokens: order.map(({ index }) => bucket.tokens[index]),
        costs: order.map(({ index }) => bucket.costs[index]),
      })),
    };
  }, [costUsage]);
  const selected = usage.models.filter((model) => chosen.has(model.name));
  const chart = groupUnselected(usage, chosen);
  const toggle = (name: string) =>
    setChosen((previous) => {
      const next = new Set(previous);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  const empty = usage.models.length === 0;
  return (
    <>
      <Group gap={16} justify="space-between" mb="md" style={{ flex: 'none' }}>
        <Group gap={24} className="by-model-heading">
          <Group gap={10} wrap="nowrap">
            <span className="page-icon">
              <MenuIcon name="model" size={26} />
            </span>
            <Title order={1} fz={26} lh={1} fw={600}>
              By model
            </Title>
          </Group>
          <Group gap={20} wrap="nowrap" className="by-model-summary">
            <Group gap={6} wrap="nowrap">
              <Text size="xs" c="dimmed">
                Tokens
              </Text>
              <Text className="num">
                <SlotNumber
                  text={tokens(empty ? null : usage.models.reduce((sum, m) => sum + m.tokens, 0))}
                />
              </Text>
            </Group>
            <Group gap={6} wrap="nowrap">
              <Text size="xs" c="dimmed">
                Cost
              </Text>
              <Text className="num">
                <SlotNumber
                  text={cost(empty ? null : sumCosts(usage.models.map((model) => model.costUsd)))}
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
            ...data.hubs.map((hub) => ({ value: hub.hubId, label: hub.name })),
          ]}
          onChange={setHubId}
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
        <section className="card by-model-card by-model-list" aria-label="Models">
          <Group className="by-model-list-header" gap={8} wrap="nowrap">
            <span className="page-icon">
              <MenuIcon name="model" />
            </span>
            <Title order={2} fz={17} fw={500} lh={1}>
              Models
            </Title>
          </Group>
          <div className="by-model-select-all">
            <Checkbox
              size="18px"
              radius={4}
              color="violet"
              label="Select all"
              disabled={empty}
              checked={!empty && selected.length === usage.models.length}
              indeterminate={selected.length > 0 && selected.length < usage.models.length}
              onChange={() =>
                setChosen(
                  selected.length === usage.models.length
                    ? new Set()
                    : new Set(usage.models.map((m) => m.name)),
                )
              }
            />
            <Text size="xs" c="dimmed" className="num">
              {selected.length} / {usage.models.length}
            </Text>
          </div>
          <div className="by-model-tiles">
            {empty ? (
              <Text size="sm" c="dimmed">
                No history for selected range.
              </Text>
            ) : null}
            {usage.models.map((model) => (
              <ModelTile
                key={model.name}
                model={model}
                selected={chosen.has(model.name)}
                onToggle={() => toggle(model.name)}
              />
            ))}
          </div>
        </section>
      </div>
    </>
  );
}

function ModelTile({
  model,
  selected,
  onToggle,
}: {
  model: ModelUsage;
  selected: boolean;
  onToggle: () => void;
}) {
  const peak = Math.max(...model.trend, 1);
  const last = Math.max(model.trend.length - 1, 1);
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
          <span className="hub-chart-swatch" style={{ background: model.color }} />
          <span>{model.name}</span>
        </span>
        <Text component="span" size="xs" c="dimmed">
          {(model.share * 100).toFixed(1)}%
        </Text>
      </span>
      <span className="by-model-tile-cost num">
        <SlotNumber text={cost(model.costUsd)} />
      </span>
      <Text component="span" size="xs" c="dimmed" className="num" display="block">
        <SlotNumber text={`${tokens(model.tokens)} tokens`} />
      </Text>
      <svg className="by-model-spark" viewBox="0 0 120 24" preserveAspectRatio="none" aria-hidden>
        <polyline
          fill="none"
          stroke={model.color}
          strokeWidth={1.6}
          vectorEffect="non-scaling-stroke"
          points={model.trend
            .map((value, index) => `${(index / last) * 120},${22 - (value / peak) * 20}`)
            .join(' ')}
        />
      </svg>
    </button>
  );
}
