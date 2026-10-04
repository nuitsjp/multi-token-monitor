import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
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
  Pagination,
  Progress,
  RingProgress,
  SegmentedControl,
  Stack,
  Table,
  Text,
  Title,
  Tooltip,
} from '@mantine/core';
import { type Overview } from '../api/overview.ts';
import { useOverview } from '../app/overview.tsx';
import { ActivityCalendar, ActivityLegend } from '../components/ActivityCalendar.tsx';
import { LimitCircle } from '../components/LimitCircle.tsx';
import { MonthlyLimit } from '../components/MonthlyLimit.tsx';
import { MenuIcon, type MenuIconName } from '../components/MenuIcon.tsx';
import { ProviderIcon } from '../components/ProviderIcon.tsx';
import { CostUsd, TokenCount } from '../components/SlotNumber.tsx';
import { full } from '../format.ts';
import { buildAccounts } from '../limits.ts';
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
  const { overview, error } = useOverview();
  const [period, setPeriod] = useState<Period>('today');

  return (
    <Container component="main" size="xl" py="md">
      <Group justify="space-between" mb="md">
        <Group gap={10} wrap="nowrap">
          <span className="page-icon">
            <MenuIcon name="home" size={26} />
          </span>
          <Title order={1} fz={26} lh={1} fw={600}>
            Home
          </Title>
        </Group>
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

function PanelTitle({ title, icon }: { title: string; icon: MenuIconName }) {
  return (
    <Group gap={8} wrap="nowrap" className="panel-title">
      <MenuIcon name={icon} size={18} />
      <Title order={2} fz={17} lh={1} fw={500}>
        {title}
      </Title>
    </Group>
  );
}

function Card({
  title,
  icon,
  control,
  bare = false,
  children,
}: {
  title: string;
  icon: MenuIconName;
  control?: ReactNode;
  bare?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={bare ? 'section-bare' : 'card'} aria-label={title}>
      <Group justify="space-between" mb="md">
        <PanelTitle title={title} icon={icon} />
        {control}
      </Group>
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
  return (
    <Stack gap="lg">
      <Flex gap="lg" wrap="wrap" align="stretch">
        <Box className="dashboard-totals">
          <Stack gap="lg" h="100%">
            <section aria-label="Total">
              <div className="total-stats">
                <Stat label="Tokens" value={<TokenCount value={usage.total.tokens} />} />
                <Stat
                  label="Est. cost"
                  value={<CostUsd value={usage.total.costUsd} />}
                  hint="USD"
                />
              </div>
            </section>
            <Card title="Activity" icon="activity" control={<ActivityLegend />}>
              <ActivityCalendar days={overview.activity.days} today={new Date()} />
            </Card>
          </Stack>
        </Box>
        <Box className="dashboard-model">
          <ModelCard usage={usage} />
        </Box>
      </Flex>
      <Grid gutter="lg">
        <Grid.Col span={{ base: 12, md: 8 }}>
          <LimitCard overview={overview} />
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 4 }}>
          <Stack gap="lg">
            <HubCard overview={overview} usage={usage} />
            <DeviceCard overview={overview} />
          </Stack>
        </Grid.Col>
      </Grid>
    </Stack>
  );
}

const hubsPerPage = 2;

function HubCard({ overview, usage }: { overview: Overview; usage: Usage }) {
  const [page, setPage] = useState(1);
  const byHub = new Map(usage.hubs.map((row) => [row.hubId, row]));
  const max = Math.max(1, ...usage.hubs.map((row) => row.tokens));
  const pageCount = Math.max(1, Math.ceil(overview.hubs.length / hubsPerPage));
  const current = Math.min(page, pageCount);
  const start = (current - 1) * hubsPerPage;
  const visible = overview.hubs.slice(start, start + hubsPerPage);
  return (
    <Card
      title="By hub"
      icon="hub"
      control={
        pageCount > 1 ? (
          <Pagination
            total={pageCount}
            value={current}
            onChange={setPage}
            size="xs"
            color="violet"
            withEdges={false}
            aria-label="Hub page"
          />
        ) : undefined
      }
    >
      <Stack gap="md">
        {Array.from({ length: hubsPerPage }, (_, index) => {
          const hub = visible[index];
          return hub ? (
            <HubRow key={hub.hubId} hub={hub} row={byHub.get(hub.hubId)} max={max} />
          ) : (
            <div key={`empty-${index}`} className="hub-slot" aria-hidden />
          );
        })}
      </Stack>
    </Card>
  );
}

function HubRow({
  hub,
  row,
  max,
}: {
  hub: Overview['hubs'][number];
  row: Usage['hubs'][number] | undefined;
  max: number;
}) {
  return (
    <div className="hub-slot" aria-label={hub.name}>
      <Group justify="space-between" mb={6} wrap="nowrap">
        <Group gap="xs" wrap="nowrap">
          <Text fw={500}>{hub.name}</Text>
          {!hub.connected && <Reconnecting received={hub.receivedAt !== null} />}
        </Group>
        {hub.receivedAt === null ? (
          <Badge color="gray" variant="light">
            Not received
          </Badge>
        ) : (
          <Text className="num">
            <TokenCount value={row?.tokens ?? 0} />
            <Text span className="muted" ml="sm">
              <CostUsd value={row?.costUsd ?? null} />
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
}

// 再接続中の目印。電波のアーチが順に点き、ホバーやフォーカスで状態の説明を出す。
function Reconnecting({ received }: { received: boolean }) {
  const detail = received ? 'Showing last saved data' : 'No data received yet';
  return (
    <Tooltip
      color="dark"
      label={
        <>
          Reconnecting
          <Text size="xs" className="muted">
            {detail}
          </Text>
        </>
      }
    >
      <span
        className="reconnecting"
        tabIndex={0}
        role="img"
        aria-label={`Reconnecting. ${detail}.`}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="19" r="1.4" fill="currentColor" stroke="none" />
          <path className="arc" d="M8.5 15.5a5 5 0 0 1 7 0" />
          <path className="arc" d="M5.5 12.5a9 9 0 0 1 13 0" />
          <path className="arc" d="M2.5 9.5a13 13 0 0 1 19 0" />
        </svg>
      </span>
    </Tooltip>
  );
}

const topModels = 5;

// 上位5モデルを個別に、6位以降を Other に合算する。色はその期間の順位で割り当てる。
function ModelCard({ usage }: { usage: Usage }) {
  const sorted = [...usage.models].sort((a, b) => b.tokens - a.tokens);
  const rest = sorted.slice(topModels);
  const restCosts = rest.flatMap((row) => (row.costUsd === null ? [] : [row.costUsd]));
  const slices = [
    ...sorted.slice(0, topModels).map((row, index) => ({
      key: `${row.tool}/${row.model}`,
      name: row.model,
      detail: row.tool,
      tokens: row.tokens,
      costUsd: row.costUsd,
      color: seriesColors[index]!,
    })),
    ...(rest.length === 0
      ? []
      : [
          {
            key: 'other',
            name: 'Other',
            detail: rest.length === 1 ? '1 model' : `${rest.length} models`,
            tokens: rest.reduce((sum, row) => sum + row.tokens, 0),
            costUsd:
              restCosts.length === 0 ? null : restCosts.reduce((sum, value) => sum + value, 0),
            color: otherColor,
          },
        ]),
  ];
  const total = Math.max(1, usage.total.tokens);
  return (
    <section className="card" aria-label="By model">
      <Flex direction={{ base: 'column', sm: 'row' }} align="stretch" gap="xl">
        <Stack gap="md" align="center" justify="flex-start">
          <Box style={{ alignSelf: 'flex-start' }}>
            <PanelTitle title="By model" icon="model" />
          </Box>
          <Flex flex={1} align="center">
            <RingProgress
              size={200}
              thickness={20}
              roundCaps={false}
              sections={slices.map((slice) => ({
                value: (slice.tokens / total) * 100,
                color: slice.color,
                tooltip: `${slice.name} · ${full.format(slice.tokens)}`,
              }))}
              label={
                <Stack gap={0} align="center">
                  <Text fz={15} fw={600} className="num">
                    <TokenCount value={usage.total.tokens} />
                  </Text>
                  <Text size="xs" className="muted">
                    tokens
                  </Text>
                </Stack>
              }
            />
          </Flex>
        </Stack>
        <Table verticalSpacing={3} style={{ flex: 1, width: '100%' }}>
          <Table.Tbody>
            {slices.map((slice) => (
              <Table.Tr key={slice.key}>
                <Table.Td>
                  <Group gap="xs" wrap="nowrap">
                    <Box w={10} h={10} bg={slice.color} style={{ borderRadius: 3, flex: 'none' }} />
                    <div>
                      <Text size="sm">{slice.name}</Text>
                      <Text size="xs" className="muted">
                        {slice.detail}
                      </Text>
                    </div>
                  </Group>
                </Table.Td>
                <Table.Td ta="right" className="num">
                  <TokenCount value={slice.tokens} />
                </Table.Td>
                <Table.Td ta="right" className="num muted">
                  <CostUsd value={slice.costUsd} />
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Flex>
    </section>
  );
}

// 名前はデータの値をそのまま表示する。Hubによっては空文字で届くため、空でないものだけを並べる。
const labels = (...values: (string | null)[]) => values.filter(Boolean).join(' · ');

const tooltipStyles = {
  tooltip: { background: '#111215', color: '#e4e5e9', border: '1px solid #3a3d48' },
};

const [PURPLE, YELLOW, RED] = ['#9085e9', '#fab219', '#f0616d'];

const legendRules = [
  {
    title: 'Pace (remaining ÷ ideal remaining)',
    note: 'Ideal remaining = time left ÷ window duration',
    rows: [
      [PURPLE, '≥ 0.8', 'Normal'],
      [YELLOW, '≥ 0.5 and < 0.8', 'Caution'],
      [RED, '< 0.5', 'Danger'],
    ],
  },
  {
    title: 'Remaining',
    note: 'Remaining window allowance (%)',
    rows: [
      [PURPLE, '> 40%', 'Normal'],
      [YELLOW, '≥ 25% and ≤ 40%', 'Caution'],
      [RED, '< 25%', 'Danger'],
    ],
  },
];

const legendTip = (
  <Stack gap={10}>
    <Text size="xs">The arc uses the worse state of the two rules.</Text>
    {legendRules.map((rule) => (
      <Stack key={rule.title} gap={3}>
        <Text size="xs" fw={600}>
          {rule.title}
        </Text>
        <Text size="xs" c="dimmed">
          {rule.note}
        </Text>
        {rule.rows.map(([color, range, state]) => (
          <Group key={range} gap={8} wrap="nowrap">
            <Box w={9} h={9} bg={color} style={{ borderRadius: '50%', flexShrink: 0 }} />
            <Text size="xs" w={110}>
              {range}
            </Text>
            <Text size="xs">{state}</Text>
          </Group>
        ))}
      </Stack>
    ))}
  </Stack>
);

function PaceLegend() {
  return (
    <Tooltip w={260} withArrow styles={tooltipStyles} label={legendTip}>
      <Group gap="sm" wrap="nowrap" aria-label="Color legend">
        {[PURPLE, YELLOW, RED].map((color) => (
          <Box key={color} w={9} h={9} bg={color} style={{ borderRadius: '50%' }} />
        ))}
      </Group>
    </Tooltip>
  );
}

// 利用枠は選択したHubが報告したものだけを表示する。表示中は1分ごとに残り時間とペースを再計算する。
function LimitCard({ overview }: { overview: Overview }) {
  const [hubId, setHubId] = useState(overview.hubs[0]?.hubId ?? '');
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);
  const accounts = buildAccounts(overview.limitWindows.filter((row) => row.hubId === hubId)).sort(
    (a, b) =>
      Math.min(
        ...a.circles.flatMap((circle) => circle.windows.map((window) => window.remainingPercent)),
      ) -
      Math.min(
        ...b.circles.flatMap((circle) => circle.windows.map((window) => window.remainingPercent)),
      ),
  );
  return (
    <Card
      bare
      title="Usage limits"
      icon="limits"
      control={
        <Group gap="md" wrap="nowrap">
          <PaceLegend />
          <SegmentedControl
            aria-label="Hub"
            color="violet"
            size="xs"
            data={overview.hubs.map((hub) => ({ value: hub.hubId, label: hub.name }))}
            value={hubId}
            onChange={setHubId}
          />
        </Group>
      }
    >
      {accounts.length === 0 && (
        <Text size="sm" className="muted">
          No limits
        </Text>
      )}
      <div className="limit-accounts">
        {accounts.map((account) => {
          const multiple = new Set(account.circles.map((circle) => circle.group)).size > 1;
          const heading = labels(account.provider, account.planLabel);
          return (
            <div
              key={account.key}
              className="limit-account"
              style={{ '--n': Math.min(account.circles.length, 4) } as CSSProperties}
              aria-label={labels(account.provider, account.accountLabel, account.planLabel)}
            >
              <Group gap={6} wrap="nowrap" className="limit-heading">
                <ProviderIcon provider={account.provider} />
                <Text size="sm" fw={500} style={{ flex: 'none' }}>
                  {heading}
                </Text>
                {account.accountLabel && (
                  <Text size="sm" className="muted limit-plan" title={account.accountLabel}>
                    {account.accountLabel}
                  </Text>
                )}
                {account.monthlyUsd !== null && (
                  <MonthlyLimit value={account.monthlyUsd} lowerBound={account.monthlyLowerBound} />
                )}
              </Group>
              <div className="limit-circles">
                {account.circles.map((circle) => (
                  <LimitCircle
                    key={circle.key}
                    name={multiple ? labels(account.provider, circle.group) : heading}
                    label={multiple ? circle.group : ''}
                    circle={circle}
                    now={now}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function DeviceCard({ overview }: { overview: Overview }) {
  const hubName = new Map(overview.hubs.map((hub) => [hub.hubId, hub.name]));
  return (
    <Card title="Devices" icon="devices">
      <Table verticalSpacing="xs">
        <Table.Thead>
          <Table.Tr>
            <Table.Th className="muted">Host</Table.Th>
            <Table.Th className="muted">Hub</Table.Th>
            {/* 時刻と状態の文字幅で列幅が変わり、更新のたびに列がずれないよう幅を固定する。 */}
            <Table.Th className="muted" w={130}>
              Last seen
            </Table.Th>
            <Table.Th className="muted" w={96}>
              Status
            </Table.Th>
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
