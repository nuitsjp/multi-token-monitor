import { useEffect, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import {
  Alert,
  Badge,
  Container,
  Group,
  Loader,
  Paper,
  Progress,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core';
import { fetchOverview, type Overview } from '../api/overview.ts';
export const Route = createFileRoute('/')({ component: Home });

type Period = keyof Overview['periods'];
const periods: { value: Period; label: string }[] = [
  { value: 'today', label: '今日' },
  { value: 'month', label: '今月' },
  { value: 'allTime', label: '累計' },
];

const tokens = (value: number) => value.toLocaleString('ja-JP');
const cost = (value: number | null) =>
  value === null
    ? '—'
    : `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const time = (value: string | null) =>
  value === null ? '—' : new Date(value).toLocaleString('ja-JP');

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
    <Container component="main" size="lg" py="xl">
      <Group justify="space-between" mb="lg">
        <Title order={1}>Token Monitor Analytics</Title>
        <SegmentedControl
          aria-label="期間"
          data={periods}
          value={period}
          onChange={(value) => setPeriod(value as Period)}
        />
      </Group>
      {error !== undefined ? (
        <Alert color="red" title="表示できません">
          {error}
        </Alert>
      ) : overview === undefined ? (
        <Loader aria-label="読み込み中" />
      ) : (
        <Dashboard overview={overview} period={period} />
      )}
    </Container>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Paper component="section" aria-label={title} withBorder p="md">
      <Title order={2} size="h4" mb="sm">
        {title}
      </Title>
      {children}
    </Paper>
  );
}

function Dashboard({ overview, period }: { overview: Overview; period: Period }) {
  const usage = overview.periods[period];
  const hubName = new Map(overview.hubs.map((hub) => [hub.hubId, hub.name]));
  const hubUsage = new Map(usage.hubs.map((hub) => [hub.hubId, hub]));
  return (
    <Stack>
      <Section title="全体の合計">
        <SimpleGrid cols={2}>
          <div>
            <Text size="sm" c="dimmed">
              トークン数
            </Text>
            <Text size="xl" fw={700}>
              {tokens(usage.total.tokens)}
            </Text>
          </div>
          <div>
            <Text size="sm" c="dimmed">
              推定コスト（USD）
            </Text>
            <Text size="xl" fw={700}>
              {cost(usage.total.costUsd)}
            </Text>
          </div>
        </SimpleGrid>
      </Section>

      <Section title="Hub別">
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Hub</Table.Th>
              <Table.Th>最終受信</Table.Th>
              <Table.Th>Hubの更新</Table.Th>
              <Table.Th ta="right">トークン数</Table.Th>
              <Table.Th ta="right">推定コスト</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {overview.hubs.map((hub) => {
              const row = hubUsage.get(hub.hubId);
              return (
                <Table.Tr key={hub.hubId}>
                  <Table.Td>{hub.name}</Table.Td>
                  {hub.receivedAt === null ? (
                    <Table.Td colSpan={4}>
                      <Badge color="gray">未受信</Badge>
                    </Table.Td>
                  ) : (
                    <>
                      <Table.Td>{time(hub.receivedAt)}</Table.Td>
                      <Table.Td>{time(hub.updatedAt)}</Table.Td>
                      <Table.Td ta="right">{tokens(row?.tokens ?? 0)}</Table.Td>
                      <Table.Td ta="right">{cost(row?.costUsd ?? null)}</Table.Td>
                    </>
                  )}
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </Section>

      <Section title="ツール・モデル別の内訳">
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>ツール</Table.Th>
              <Table.Th>モデル</Table.Th>
              <Table.Th ta="right">トークン数</Table.Th>
              <Table.Th ta="right">推定コスト</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {[...usage.models]
              .sort((a, b) => b.tokens - a.tokens)
              .map((row) => (
                <Table.Tr key={`${row.tool}/${row.model}`}>
                  <Table.Td>{row.tool}</Table.Td>
                  <Table.Td>{row.model}</Table.Td>
                  <Table.Td ta="right">{tokens(row.tokens)}</Table.Td>
                  <Table.Td ta="right">{cost(row.costUsd)}</Table.Td>
                </Table.Tr>
              ))}
          </Table.Tbody>
        </Table>
      </Section>

      <Section title="利用枠">
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>提供元</Table.Th>
              <Table.Th>アカウント</Table.Th>
              <Table.Th>プラン</Table.Th>
              <Table.Th>枠</Table.Th>
              <Table.Th>残量</Table.Th>
              <Table.Th>次のリセット</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {overview.limitWindows.map((row) => (
              <Table.Tr key={`${row.provider}/${row.accountKey}/${row.kind}/${row.limitKey}`}>
                <Table.Td>{row.provider}</Table.Td>
                <Table.Td>{row.accountLabel ?? '—'}</Table.Td>
                <Table.Td>{row.planLabel ?? '—'}</Table.Td>
                <Table.Td>{row.label ?? row.limitKey}</Table.Td>
                <Table.Td miw={160}>
                  <Group gap="xs" wrap="nowrap">
                    <Progress value={row.remainingPercent} w={100} />
                    <Text size="sm">{row.remainingPercent}%</Text>
                  </Group>
                </Table.Td>
                <Table.Td>{time(row.resetsAt)}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Section>

      <Section title="端末">
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Hub</Table.Th>
              <Table.Th>ホスト名</Table.Th>
              <Table.Th>OS</Table.Th>
              <Table.Th>最終送信</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {overview.devices.map((device) => (
              <Table.Tr key={`${device.hubId}/${device.deviceId}`}>
                <Table.Td>{hubName.get(device.hubId) ?? device.hubId}</Table.Td>
                <Table.Td>
                  <Group gap="xs">
                    {device.hostname}
                    {device.stale && <Badge color="orange">鮮度切れ</Badge>}
                  </Group>
                </Table.Td>
                <Table.Td>{device.osName ?? '—'}</Table.Td>
                <Table.Td>{time(device.updatedAt)}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Section>
    </Stack>
  );
}
