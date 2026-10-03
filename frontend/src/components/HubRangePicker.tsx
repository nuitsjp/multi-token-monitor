import { useState } from 'react';
import { ActionIcon, Button, Group, Popover, Stack, Text, TextInput } from '@mantine/core';
import { MenuIcon } from './MenuIcon.tsx';
import '../hub-range.css';

type Range = { start: string; end: string };
type Props = { range: Range; today: string; onChange: (range: Range) => void };
const dayKey = (date: Date) => date.toISOString().slice(0, 10);
const monthDate = (day: string) => new Date(`${day.slice(0, 7)}-01T00:00:00Z`);
const moveMonth = (month: Date, offset: number) =>
  new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + offset, 1));
const monthLabel = new Intl.DateTimeFormat('ja-JP', {
  year: 'numeric',
  month: 'long',
  timeZone: 'UTC',
});
const weekdays = ['日', '月', '火', '水', '木', '金', '土'];

export function HubRangePicker({ range, today, onChange }: Props) {
  const [opened, setOpened] = useState(false);
  const [draft, setDraft] = useState(range);
  const [month, setMonth] = useState(() => monthDate(range.start));
  const [selectingEnd, setSelectingEnd] = useState(false);
  const valid =
    draft.start !== '' && draft.end !== '' && draft.start <= draft.end && draft.end <= today;

  const open = () => {
    setDraft(range);
    setMonth(monthDate(range.start));
    setSelectingEnd(false);
    setOpened(true);
  };
  const selectDay = (day: string) => {
    if (!selectingEnd) {
      setDraft({ start: day, end: day });
      setSelectingEnd(true);
      return;
    }
    const next =
      day < draft.start ? { start: day, end: draft.start } : { start: draft.start, end: day };
    onChange(next);
    setOpened(false);
  };

  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      position="bottom-end"
      shadow="md"
      trapFocus
      returnFocus
    >
      <Popover.Target>
        <ActionIcon
          variant="subtle"
          color="gray"
          radius="xl"
          size="lg"
          aria-label="任意の期間を選択"
          aria-expanded={opened}
          onClick={() => (opened ? setOpened(false) : open())}
        >
          <MenuIcon name="activity" size={18} />
        </ActionIcon>
      </Popover.Target>
      <Popover.Dropdown className="hub-range-dropdown">
        <Stack gap="sm">
          <Group justify="space-between" wrap="nowrap">
            <ActionIcon
              variant="subtle"
              color="gray"
              aria-label="前の月"
              onClick={() => setMonth(moveMonth(month, -1))}
            >
              ‹
            </ActionIcon>
            <Text size="xs" c="dimmed" aria-live="polite">
              {selectingEnd ? '終了日を選択してください' : '開始日を選択してください'}
            </Text>
            <ActionIcon
              variant="subtle"
              color="gray"
              aria-label="次の月"
              disabled={dayKey(moveMonth(month, 1)) > today}
              onClick={() => setMonth(moveMonth(month, 1))}
            >
              ›
            </ActionIcon>
          </Group>
          <div className="hub-range-months">
            {[month, moveMonth(month, 1)].map((current) => {
              const days = new Date(
                Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 0),
              ).getUTCDate();
              const padding = current.getUTCDay();
              return (
                <section key={dayKey(current)} aria-label={monthLabel.format(current)}>
                  <Text size="sm" fw={500} ta="center" mb={8}>
                    {monthLabel.format(current)}
                  </Text>
                  <div className="hub-range-days">
                    {weekdays.map((label) => (
                      <span className="hub-range-weekday" key={label}>
                        {label}
                      </span>
                    ))}
                    {Array.from({ length: padding }, (_, index) => (
                      <span key={`empty-${index}`} />
                    ))}
                    {Array.from({ length: days }, (_, index) => {
                      const date = new Date(
                        Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), index + 1),
                      );
                      const key = dayKey(date);
                      const selected = key >= draft.start && key <= draft.end;
                      return (
                        <button
                          type="button"
                          key={key}
                          className="hub-range-day"
                          data-selected={selected || undefined}
                          data-edge={key === draft.start || key === draft.end || undefined}
                          disabled={key > today}
                          aria-label={key}
                          aria-pressed={selected}
                          onClick={() => selectDay(key)}
                        >
                          {index + 1}
                        </button>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
          <Group gap="sm" grow wrap="nowrap">
            <TextInput
              type="date"
              label="開始日"
              value={draft.start}
              max={today}
              onChange={(event) => {
                setDraft({ ...draft, start: event.currentTarget.value });
                setSelectingEnd(false);
              }}
              size="xs"
            />
            <TextInput
              type="date"
              label="終了日"
              value={draft.end}
              min={draft.start}
              max={today}
              onChange={(event) => {
                setDraft({ ...draft, end: event.currentTarget.value });
                setSelectingEnd(false);
              }}
              size="xs"
            />
          </Group>
          <Button
            size="xs"
            color="violet"
            disabled={!valid}
            onClick={() => {
              onChange(draft);
              setOpened(false);
            }}
          >
            期間を適用
          </Button>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}
