import { useEffect, useState, type FormEvent } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import {
  ActionIcon,
  Alert,
  Button,
  Container,
  Group,
  Loader,
  Modal,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import {
  addHub,
  fetchHubs,
  HubInputRejected,
  type HubStatus,
  type RegisteredHub,
} from '../api/hubs.ts';
import { useOverview } from '../app/overview.tsx';
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
  const [adding, setAdding] = useState(false);
  const open = () => {
    setForm({ name: '', url: '', token: '' });
    setErrors({});
    setAdding(true);
  };
  const { subscribeNotifications } = useOverview();
  useEffect(() => {
    // 取得が重なったときは、最後に始めた取得の結果だけを表示する。
    let latest = 0;
    let active = true;
    const refresh = () => {
      const request = ++latest;
      void fetchHubs().then(
        (value) => {
          if (!active || request !== latest) return;
          setHubs(value);
          setError(undefined);
        },
        (reason: unknown) => {
          if (active && request === latest)
            setError(reason instanceof Error ? reason.message : String(reason));
        },
      );
    };
    const unsubscribe = subscribeNotifications((notification) => {
      if (notification.type === 'changed') refresh();
    });
    refresh();
    return () => {
      active = false;
      unsubscribe();
    };
  }, [subscribeNotifications]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const found = validateHubInput(form);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    void addHub(form).then(
      () => setAdding(false),
      (reason: unknown) => {
        if (reason instanceof HubInputRejected) setErrors(reason.errors);
        else setError(reason instanceof Error ? reason.message : String(reason));
      },
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
        <Group justify="space-between" wrap="nowrap" mb="md">
          <Group gap={8} wrap="nowrap">
            <span className="page-icon">
              <MenuIcon name="hub" />
            </span>
            <Title order={2} fz={17} fw={500} lh={1}>
              Hubs
            </Title>
          </Group>
          <ActionIcon variant="subtle" color="violet" aria-label="Add hub" onClick={open}>
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              strokeLinecap="round"
              aria-hidden
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
          </ActionIcon>
        </Group>
        {hubs === undefined ? (
          <Loader aria-label="Loading" />
        ) : hubs.length === 0 ? (
          <Text c="dimmed" size="sm">
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
                <Text size="xs" c={statusView[hub.status as HubStatus].color}>
                  ● {statusView[hub.status as HubStatus].label}
                </Text>
              </li>
            ))}
          </ul>
        )}
      </section>
      <Modal opened={adding} onClose={() => setAdding(false)} title="Add hub" centered>
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
      </Modal>
    </Container>
  );
}
