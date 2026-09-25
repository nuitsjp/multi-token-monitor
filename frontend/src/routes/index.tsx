import { useEffect, useState, type ReactNode } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import {
  Alert,
  Badge,
  Box,
  Container,
  Flex,
  Grid,
  Group,
  Loader,
  Progress,
  RingProgress,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Title,
  Tooltip,
} from '@mantine/core';
import { fetchOverview, type Overview } from '../api/overview.ts';
export const Route = createFileRoute('/')({ component: Home });

type Period = keyof Overview['periods'];
type Usage = Overview['periods'][Period];
const periods: { value: Period; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'month', label: 'Month' },
  { value: 'allTime', label: 'All time' },
];

// ダーク面 #1f2126 で色覚差の検査に合格した順序。隣り合う色が区別できるよう並べ替えない。
const seriesColors = ['#9085e9', '#199e70', '#d95926', '#3987e5', '#d55181'];
const otherColor = '#5d6070';
const accent = '#9085e9';
const statusGood = '#0ca30c';
const statusWarning = '#fab219';

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 });
const full = new Intl.NumberFormat('en-US');
const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
});
const cost = (value: number | null) => (value === null ? '—' : usd.format(value));
const time = (value: string | null) =>
  value === null
    ? '—'
    : new Date(value).toLocaleString('ja-JP', {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });

export function Home() {
  const [overview, setOverview] = useState<Overview>();
  const [error, setError] = useState<string>();
  const [period, setPeriod] = useState<Period>('today');
  useEffect(() => {
    fetchOverview().then(setOverview, (reason: unknown) =>
      setError(reason instanceof Error ? reason.message : String(reason)),
    );
  }, []);

  return (
    <Container component="main" size="xl" py="xl">
      <Group justify="space-between" mb="xl">
        <Title order={1} size="h2" fw={600}>
          Token Monitor Analytics
        </Title>
        <SegmentedControl
          aria-label="Period"
          color="violet"
          data={periods}
          value={period}
          onChange={(value) => setPeriod(value as Period)}
        />
      </Group>
      {error !== undefined ? (
        <Alert color="red" variant="light" title="Unable to load">
          {error}
        </Alert>
      ) : overview === undefined ? (
        <Loader aria-label="Loading" />
      ) : (
        <Dashboard overview={overview} period={period} />
      )}
    </Container>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card" aria-label={title}>
      <Title order={2} size="h5" fw={500} mb="md">
        {title}
      </Title>
      {children}
    </section>
  );
}

function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="card">
      <Text size="sm" className="muted">
        {label}
      </Text>
      <Text fz={32} fw={600} lh={1.3}>
        {value}
      </Text>
      {hint !== undefined && (
        <Text size="xs" className="muted">
          {hint}
        </Text>
      )}
    </div>
  );
}

function Dashboard({ overview, period }: { overview: Overview; period: Period }) {
  const usage = overview.periods[period];
  const received = overview.hubs.filter((hub) => hub.receivedAt !== null).length;
  const stale = overview.devices.filter((device) => device.stale).length;
  // 色はモデルに固定する。期間を切り替えても同じモデルは同じ色のまま。
  const modelKey = (row: { tool: string; model: string }) => `${row.tool}/${row.model}`;
  const modelColor = new Map(
    [...overview.periods.allTime.models]
      .sort((a, b) => b.tokens - a.tokens)
      .slice(0, seriesColors.length - 1)
      .map((row, index) => [modelKey(row), seriesColors[index]!]),
  );
  return (
    <Stack gap="lg">
      <section aria-label="Total">
        <SimpleGrid cols={{ base: 2, md: 4 }}>
          <Stat
            label="Tokens"
            value={
              <Tooltip label={full.format(usage.total.tokens)}>
                <span>{compact.format(usage.total.tokens)}</span>
              </Tooltip>
            }
            hint={full.format(usage.total.tokens)}
          />
          <Stat label="Est. cost" value={cost(usage.total.costUsd)} hint="USD" />
          <Stat label="Hubs" value={`${received} / ${overview.hubs.length}`} hint="received" />
          <Stat
            label="Devices"
            value={overview.devices.length}
            hint={stale > 0 ? `${stale} stale` : 'all live'}
          />
        </SimpleGrid>
      </section>
      <Grid gutter="lg">
        <Grid.Col span={{ base: 12, md: 5 }}>
          <HubCard overview={overview} usage={usage} />
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 7 }}>
          <ModelCard usage={usage} modelColor={modelColor} modelKey={modelKey} />
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 7 }}>
          <LimitCard overview={overview} />
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 5 }}>
          <DeviceCard overview={overview} />
        </Grid.Col>
      </Grid>
    </Stack>
  );
}

function HubCard({ overview, usage }: { overview: Overview; usage: Usage }) {
  const byHub = new Map(usage.hubs.map((row) => [row.hubId, row]));
  const max = Math.max(1, ...usage.hubs.map((row) => row.tokens));
  return (
    <Card title="By hub">
      <Stack gap="lg">
        {overview.hubs.map((hub) => {
          const row = byHub.get(hub.hubId);
          return (
            <div key={hub.hubId} aria-label={hub.name}>
              <Group justify="space-between" mb={6} wrap="nowrap">
                <Text fw={500}>{hub.name}</Text>
                {hub.receivedAt === null ? (
                  <Badge color="gray" variant="light">
                    Not received
                  </Badge>
                ) : (
                  <Text className="num">
                    {compact.format(row?.tokens ?? 0)}
                    <Text span className="muted" ml="sm">
                      {cost(row?.costUsd ?? null)}
                    </Text>
                  </Text>
                )}
              </Group>
              {hub.receivedAt !== null && (
                <>
                  <Tooltip label={`${full.format(row?.tokens ?? 0)} tokens`}>
                    <Progress
                      value={((row?.tokens ?? 0) / max) * 100}
                      color={accent}
                      size="md"
                      aria-label={`${hub.name} tokens`}
                    />
                  </Tooltip>
                  <Text size="xs" className="muted" mt={6}>
                    Received {time(hub.receivedAt)} · Updated {time(hub.updatedAt)}
                  </Text>
                </>
              )}
            </div>
          );
        })}
      </Stack>
    </Card>
  );
}

function ModelCard({
  usage,
  modelColor,
  modelKey,
}: {
  usage: Usage;
  modelColor: Map<string, string>;
  modelKey: (row: { tool: string; model: string }) => string;
}) {
  const rows = [...usage.models].sort((a, b) => b.tokens - a.tokens);
  const total = Math.max(1, usage.total.tokens);
  const color = (row: { tool: string; model: string }) =>
    modelColor.get(modelKey(row)) ?? otherColor;
  return (
    <Card title="By model">
      <Flex direction={{ base: 'column', sm: 'row' }} align="center" gap="xl">
        <RingProgress
          size={200}
          thickness={20}
          roundCaps={false}
          sections={rows.map((row) => ({
            value: (row.tokens / total) * 100,
            color: color(row),
            tooltip: `${row.model} · ${full.format(row.tokens)}`,
          }))}
          label={
            <Stack gap={0} align="center">
              <Text fz={24} fw={600}>
                {compact.format(usage.total.tokens)}
              </Text>
              <Text size="xs" className="muted">
                tokens
              </Text>
            </Stack>
          }
        />
        <Table verticalSpacing={6} style={{ flex: 1, width: '100%' }}>
          <Table.Tbody>
            {rows.map((row) => (
              <Table.Tr key={modelKey(row)}>
                <Table.Td>
                  <Group gap="xs" wrap="nowrap">
                    <Box w={10} h={10} bg={color(row)} style={{ borderRadius: 3, flex: 'none' }} />
                    <div>
                      <Text size="sm">{row.model}</Text>
                      <Text size="xs" className="muted">
                        {row.tool}
                      </Text>
                    </div>
                  </Group>
                </Table.Td>
                <Table.Td ta="right" className="num">
                  {compact.format(row.tokens)}
                </Table.Td>
                <Table.Td ta="right" className="num muted">
                  {cost(row.costUsd)}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Flex>
    </Card>
  );
}

function LimitCard({ overview }: { overview: Overview }) {
  const accounts = new Map<string, Overview['limitWindows']>();
  for (const row of overview.limitWindows) {
    const key = `${row.provider}/${row.accountKey}`;
    accounts.set(key, [...(accounts.get(key) ?? []), row]);
  }
  return (
    <Card title="Usage limits">
      <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="lg">
        {[...accounts].map(([key, windows]) => {
          const first = windows[0]!;
          return (
            <div key={key} aria-label={`${first.provider} ${first.accountLabel ?? ''}`}>
              <Text fw={500}>{first.accountLabel ?? first.accountKey}</Text>
              <Text size="xs" className="muted" mb="sm">
                {first.provider} · {first.planLabel ?? '—'}
              </Text>
              <Group gap="md">
                {windows.map((row) => (
                  <Stack key={`${row.kind}/${row.limitKey}`} gap={2} align="center">
                    <RingProgress
                      size={84}
                      thickness={8}
                      roundCaps
                      sections={[{ value: row.remainingPercent, color: accent }]}
                      rootColor="#2c2e36"
                      label={
                        <Text ta="center" size="sm" fw={600}>
                          {Math.round(row.remainingPercent)}%
                        </Text>
                      }
                    />
                    <Text size="xs">{row.label ?? row.limitKey}</Text>
                    <Text size="xs" className="muted">
                      {row.resetsAt === null ? '—' : `↻ ${time(row.resetsAt)}`}
                    </Text>
                  </Stack>
                ))}
              </Group>
            </div>
          );
        })}
      </SimpleGrid>
    </Card>
  );
}

function DeviceCard({ overview }: { overview: Overview }) {
  const hubName = new Map(overview.hubs.map((hub) => [hub.hubId, hub.name]));
  return (
    <Card title="Devices">
      <Table verticalSpacing="xs">
        <Table.Thead>
          <Table.Tr>
            <Table.Th className="muted">Host</Table.Th>
            <Table.Th className="muted">Hub</Table.Th>
            <Table.Th className="muted">Last seen</Table.Th>
            <Table.Th className="muted">Status</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {overview.devices.map((device) => (
            <Table.Tr key={`${device.hubId}/${device.deviceId}`}>
              <Table.Td>
                <Text size="sm">{device.hostname}</Text>
                <Text size="xs" className="muted">
                  {device.osName ?? '—'}
                </Text>
              </Table.Td>
              <Table.Td>{hubName.get(device.hubId) ?? device.hubId}</Table.Td>
              <Table.Td className="num">{time(device.updatedAt)}</Table.Td>
              <Table.Td>
                <Group gap={6} wrap="nowrap">
                  <Box
                    w={8}
                    h={8}
                    bg={device.stale ? statusWarning : statusGood}
                    style={{ borderRadius: '50%' }}
                  />
                  <Text size="sm">{device.stale ? 'Stale' : 'Live'}</Text>
                </Group>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Card>
  );
}
