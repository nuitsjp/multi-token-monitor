import { useEffect, useState, type FormEvent } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { Alert, Button, Container, Group, Loader, Text, TextInput, Title } from '@mantine/core';
import { addHub, fetchHubs, type HubStatus, type RegisteredHub } from '../api/hubs.ts';
import { MenuIcon } from '../components/MenuIcon.tsx';
import { validateHubInput, type HubInputErrors } from '../hub-form.ts';

export const Route = createFileRoute('/settings')({ component: Settings });

const statusView: Record<HubStatus, { label: string; color: string }> = {
  connected: { label: 'Connected', color: '#0ca30c' },
  notReceived: { label: 'Not received', color: '#fab219' },
  reconnecting: { label: 'Reconnecting', color: '#fab219' },
};

export function Settings() {
  const [hubs, setHubs] = useState<RegisteredHub[]>();
  const [error, setError] = useState<string>();
  const [form, setForm] = useState({ name: '', url: '', token: '' });
  const [errors, setErrors] = useState<HubInputErrors>({});
  const refresh = () =>
    fetchHubs().then(setHubs, (reason: unknown) =>
      setError(reason instanceof Error ? reason.message : String(reason)),
    );
  useEffect(() => {
    void refresh();
    // 受信状態の変化を反映するため定期的に取得し直す（実装では保存の通知で取得し直す）。
    const timer = setInterval(() => void refresh(), 1000);
    return () => clearInterval(timer);
  }, []);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const found = validateHubInput(form);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    void addHub(form).then(
      () => {
        setForm({ name: '', url: '', token: '' });
        return refresh();
      },
      (reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)),
    );
  };

  return (
    <Container component="main" size="xl" py="md">
      <Group gap={10} wrap="nowrap" mb="md">
        <span className="page-icon">
          <MenuIcon name="settings" size={26} />
        </span>
        <Title order={1} fz={26} lh={1} fw={600}>
          Settings
        </Title>
      </Group>
      {error ? (
        <Alert color="red" title="Unable to save hubs" mb="md">
          {error}
        </Alert>
      ) : null}
      <section className="card settings-card" aria-label="Hubs">
        <Group gap={8} wrap="nowrap" mb="md">
          <span className="page-icon">
            <MenuIcon name="hub" />
          </span>
          <Title order={2} fz={17} fw={500} lh={1}>
            Hubs
          </Title>
        </Group>
        {hubs === undefined ? (
          <Loader aria-label="Loading" />
        ) : hubs.length === 0 ? (
          <Text c="dimmed" size="sm" mb="md">
            No hubs registered.
          </Text>
        ) : (
          <ul className="settings-hubs">
            {hubs.map((hub) => (
              <li key={hub.hubId} className="settings-hub">
                <Text fw={500}>{hub.name}</Text>
                <Text size="sm" c="dimmed">
                  {hub.url}
                </Text>
                <Text size="xs" c={statusView[hub.status].color}>
                  ● {statusView[hub.status].label}
                </Text>
              </li>
            ))}
          </ul>
        )}
        <form className="settings-form" onSubmit={submit} noValidate aria-label="Add hub">
          <TextInput
            label="Name"
            value={form.name}
            error={errors.name}
            onChange={(event) => setForm({ ...form, name: event.currentTarget.value })}
          />
          <TextInput
            label="URL"
            placeholder="https://hub.example.com"
            value={form.url}
            error={errors.url}
            onChange={(event) => setForm({ ...form, url: event.currentTarget.value })}
          />
          <TextInput
            label="Token"
            type="password"
            autoComplete="off"
            value={form.token}
            error={errors.token}
            onChange={(event) => setForm({ ...form, token: event.currentTarget.value })}
          />
          <Button type="submit" color="violet">
            Add hub
          </Button>
        </form>
      </section>
    </Container>
  );
}
