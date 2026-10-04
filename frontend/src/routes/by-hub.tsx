import { useMemo, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import {
  Alert,
  Container,
  Group,
  Loader,
  Progress,
  SegmentedControl,
  Text,
  Title,
  UnstyledButton,
} from '@mantine/core';
import { fetchHubUsage, type HubUsageData } from '../api/hub-usage.ts';
import {
  aggregateHub,
  rangeForPreset,
  type AggregationUnit,
  type RangePreset,
} from '../hub-usage.ts';
import { HubUsageChart } from '../components/HubUsageChart.tsx';
import { UsageRangeControls } from '../components/UsageRangeControls.tsx';
import { MenuIcon } from '../components/MenuIcon.tsx';
import { SlotNumber } from '../components/SlotNumber.tsx';
import { cost, full } from '../format.ts';
import { useHubUsage } from '../app/use-hub-usage.ts';
import '../by-hub.css';

export const Route = createFileRoute('/by-hub')({ component: ByHub });
const tokens = (value: number | null) => (value === null ? '—' : full.format(value));
const time = (value: string | null) =>
  value === null
    ? '—'
    : new Date(value).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

export function ByHub() {
  const { data, error } = useHubUsage(fetchHubUsage);
  return (
    <Container component="main" size="xl" py="md">
      {error ? (
        <Alert color="red" title="Unable to load hub information">
          {error}
        </Alert>
      ) : null}
      {data ? <HubDashboard data={data} /> : <Loader aria-label="Loading" />}
    </Container>
  );
}

function HubDashboard({ data }: { data: HubUsageData }) {
  const [hubId, setHubId] = useState(data.hubs[0]?.hubId ?? '');
  const [preset, setPreset] = useState<RangePreset | 'custom'>('2w');
  const [custom, setCustom] = useState(() => rangeForPreset('2w', data.today));
  const [unit, setUnit] = useState<AggregationUnit>('daily');
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const hub = data.hubs.find((item) => item.hubId === hubId);
  const range = preset === 'custom' ? custom : rangeForPreset(preset, data.today);
  const usage = useMemo(
    () => (hub ? aggregateHub(hub, range.start, range.end, unit) : undefined),
    [hub, range.start, range.end, unit],
  );
  if (!hub || !usage) return <Text c="dimmed">No hubs registered.</Text>;
  return (
    <>
      <Group className="by-hub-header" justify="space-between" mb="md">
        <Group gap={24} className="by-hub-heading">
          <Group gap={10} wrap="nowrap">
            <span className="page-icon">
              <MenuIcon name="hub" size={26} />
            </span>
            <Title order={1} fz={26} lh={1} fw={600}>
              By hub
            </Title>
          </Group>
          <Group gap={20} className="by-hub-summary" wrap="nowrap">
            <Group gap={6} wrap="nowrap">
              <Text size="xs" c="dimmed">
                Tokens
              </Text>
              <Text className="num">
                <SlotNumber text={tokens(usage.totalTokens)} />
              </Text>
            </Group>
            <Group gap={6} wrap="nowrap">
              <Text size="xs" c="dimmed">
                Cost
              </Text>
              <Text className="num">
                <SlotNumber text={cost(usage.totalCostUsd)} />
              </Text>
            </Group>
          </Group>
        </Group>
        <Group gap={20} className="by-hub-controls" wrap="nowrap">
          <SegmentedControl
            aria-label="Hub"
            color="violet"
            value={hubId}
            data={data.hubs.map((item) => ({ value: item.hubId, label: item.name }))}
            onChange={setHubId}
          />
          <Group gap={10} className="by-hub-status" wrap="nowrap">
            <Text size="xs" c={hub.connected ? '#0ca30c' : '#fab219'}>
              ●{' '}
              {hub.connected
                ? 'Connected'
                : hub.receivedAt === null
                  ? 'Not received'
                  : 'Reconnecting'}
            </Text>
            <Text size="xs" c="dimmed">
              Last received {time(hub.receivedAt)}
            </Text>
          </Group>
        </Group>
      </Group>
      {hub.receivedAt === null ? (
        <div className="card">
          <Text c="dimmed">No data received from this hub.</Text>
        </div>
      ) : (
        <div className="by-hub-workspace">
          <section className="card by-hub-charts" aria-label="Usage by model">
            <Group justify="space-between" className="by-hub-chart-toolbar" gap={12}>
              <Group gap={8} wrap="nowrap">
                <span className="page-icon">
                  <MenuIcon name="model" />
                </span>
                <Title order={2} fz={17} fw={500} lh={1}>
                  By model
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
            {usage.totalTokens === null ? (
              <Text c="dimmed" py="xl">
                No history for selected range.
              </Text>
            ) : (
              <>
                <Text size="xs" c="dimmed" mt="lg">
                  Tokens
                </Text>
                <HubUsageChart
                  kind="tokens"
                  series={usage.series}
                  buckets={usage.buckets}
                  hidden={hidden}
                />
                <Text size="xs" c="dimmed" mt="md">
                  Est. cost · USD
                </Text>
                <HubUsageChart
                  kind="cost"
                  series={usage.series}
                  buckets={usage.buckets}
                  hidden={hidden}
                />
                <Group gap={14} mt="sm" className="by-hub-legend">
                  {usage.series.map((series) => (
                    <UnstyledButton
                      key={series.key}
                      aria-pressed={!hidden.has(series.key)}
                      onClick={() =>
                        setHidden((previous) => {
                          const next = new Set(previous);
                          if (next.has(series.key)) next.delete(series.key);
                          else next.add(series.key);
                          return next;
                        })
                      }
                      style={{ opacity: hidden.has(series.key) ? 0.4 : 1 }}
                    >
                      <Group gap={6} wrap="nowrap">
                        <span className="hub-chart-swatch" style={{ background: series.color }} />
                        <Text size="xs">{series.name}</Text>
                      </Group>
                    </UnstyledButton>
                  ))}
                </Group>
                <Text size="xs" c="dimmed" mt="sm">
                  {range.start} — {range.end}
                  {usage.partial ? ' · Showing available history and known costs' : ''}
                </Text>
              </>
            )}
          </section>
          <section className="card by-hub-devices" aria-label="Usage by device">
            <Group justify="space-between" mb="md">
              <Group gap={8}>
                <span className="page-icon">
                  <MenuIcon name="devices" />
                </span>
                <Title order={2} fz={17} fw={500} lh={1}>
                  Devices
                </Title>
              </Group>
              <Text size="xs" c="dimmed">
                {hub.devices.length} devices
              </Text>
            </Group>
            {usage.devices.map(({ device, tokens: amount, costUsd, tokenShare, costShare }) => (
              <div className="by-hub-device" key={device.deviceId}>
                <Group justify="space-between" gap={6} mb={12}>
                  <Group gap={8} wrap="nowrap">
                    <span className="by-hub-device-name">
                      <Text size="sm">{device.hostname}</Text>
                    </span>
                    <Text size="xs" c="dimmed">
                      {device.osName}
                    </Text>
                  </Group>
                  <Group gap={8} wrap="nowrap">
                    <Text size="xs" c={device.stale ? '#fab219' : '#0ca30c'}>
                      ● {device.stale ? 'Stale' : 'Live'}
                    </Text>
                    <Text size="xs" c="dimmed">
                      Last seen {time(device.updatedAt)}
                    </Text>
                  </Group>
                </Group>
                <DeviceBar
                  label="Tokens"
                  value={tokens(amount)}
                  share={tokenShare}
                  color="#6b9eac"
                />
                <DeviceBar label="Cost" value={cost(costUsd)} share={costShare} color="#9789c7" />
                {amount === null && (
                  <Text size="xs" c="dimmed" mt={4}>
                    No history for selected range.
                  </Text>
                )}
              </div>
            ))}
            {hub.devices.length === 0 && (
              <Text size="sm" c="dimmed">
                No devices.
              </Text>
            )}
          </section>
        </div>
      )}
    </>
  );
}

function DeviceBar({
  label,
  value,
  share,
  color,
}: {
  label: string;
  value: string;
  share: number | null;
  color: string;
}) {
  return (
    <div className="by-hub-device-bar">
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      {share === null ? (
        <Text size="xs" c="dimmed">
          —
        </Text>
      ) : (
        <Progress aria-label={`${label} share`} value={share * 100} color={color} size="md" />
      )}
      <Text className="num" ta="right">
        <SlotNumber text={value} />
      </Text>
      <Text size="xs" c="dimmed" ta="right">
        {share === null ? '—' : `${(share * 100).toFixed(1)}%`}
      </Text>
    </div>
  );
}
