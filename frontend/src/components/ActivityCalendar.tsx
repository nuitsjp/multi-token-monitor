import { Text } from '@mantine/core';
import type { Overview } from '../api/overview.ts';
import { full } from '../format.ts';

type Day = Overview['activity']['days'][number];

const weeks = 52;
const weekdayRows = [
  { row: 3, label: 'Mon' },
  { row: 5, label: 'Wed' },
  { row: 7, label: 'Fri' },
];
const monthNames = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

const pad = (value: number) => String(value).padStart(2, '0');
const key = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

// 0は最も薄い色、それ以外は表示期間内の最大値に対する比で4段階に分ける。
function level(tokens: number, max: number) {
  if (tokens <= 0) return 0;
  const ratio = tokens / max;
  return ratio <= 0.25 ? 1 : ratio <= 0.5 ? 2 : ratio <= 0.75 ? 3 : 4;
}

export function ActivityLegend() {
  return (
    <div className="activity-legend muted" aria-hidden>
      Less
      {[0, 1, 2, 3, 4].map((value) => (
        <span key={value} className={`activity-cell level-${value}`} />
      ))}
      More
    </div>
  );
}

// 今日を含む週で終わる直近52週を、列＝週・行＝曜日（日曜始まり）で並べる。
export function ActivityCalendar({ days, today }: { days: Day[]; today: Date }) {
  if (days.length === 0)
    return (
      <Text size="sm" className="muted">
        No history
      </Text>
    );
  const byDate = new Map(days.map((day) => [day.date, day]));
  const start = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() - today.getDay() - (weeks - 1) * 7,
  );
  const cells = Array.from({ length: weeks * 7 }, (_, index) => {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);
    return { date, day: byDate.get(key(date)), future: date > today, week: Math.floor(index / 7) };
  });
  const max = Math.max(1, ...cells.map((cell) => cell.day?.tokens ?? 0));
  const months = cells.filter((cell) => cell.date.getDate() === 1 && !cell.future);
  return (
    <div className="activity-box">
      <div className="activity" role="img" aria-label="Activity">
        {months.map((cell) => (
          <span
            key={key(cell.date)}
            className="activity-month muted"
            style={{ gridColumn: cell.week + 2 }}
          >
            {monthNames[cell.date.getMonth()]}
          </span>
        ))}
        {weekdayRows.map(({ row, label }) => (
          <span key={label} className="activity-weekday muted" style={{ gridRow: row }}>
            {label}
          </span>
        ))}
        {cells.map((cell) => {
          const tokens = cell.day?.tokens ?? 0;
          return cell.future ? null : (
            <span
              key={key(cell.date)}
              className={`activity-cell level-${level(tokens, max)}`}
              style={{ gridColumn: cell.week + 2, gridRow: (cell.date.getDay() % 7) + 2 }}
              title={`${key(cell.date)} · ${full.format(tokens)} tokens${
                cell.day?.costUsd == null ? '' : ` · $${cell.day.costUsd.toFixed(2)}`
              }`}
            />
          );
        })}
      </div>
    </div>
  );
}
