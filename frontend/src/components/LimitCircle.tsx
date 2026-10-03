import { Tooltip } from '@mantine/core';
import { cost } from '../format.ts';
import { MonthlyLimit } from './MonthlyLimit.tsx';
import {
  stateOf,
  remainingText,
  windowLabel,
  type LimitCircle as Circle,
  type LimitWindow,
  type Pace,
} from '../limits.ts';

const track = '#2c2e36';
const paceColors: Record<Pace, string> = {
  normal: '#9085e9',
  caution: '#fab219',
  danger: '#f0616d',
};

// 下部を開けた270度の円弧。pathLength=100 の破線で、開始位置（左下）から時計回りに長さを決める。
function Arc({ radius, percent, color }: { radius: number; percent: number; color: string }) {
  const props = {
    cx: 100,
    cy: 100,
    r: radius,
    fill: 'none',
    strokeWidth: 10,
    strokeLinecap: 'round' as const,
    pathLength: 100,
    transform: 'rotate(135 100 100)',
  };
  const filled = (Math.min(100, Math.max(0, percent)) * 0.75).toFixed(3);
  return (
    <>
      <circle {...props} stroke={track} strokeDasharray="75 25" />
      <circle {...props} stroke={color} strokeDasharray={`${filled} 200`} />
    </>
  );
}

const clock = (
  <svg
    viewBox="0 0 24 24"
    width={12}
    height={12}
    fill="none"
    stroke="currentColor"
    strokeWidth={2.4}
    strokeLinecap="round"
    aria-hidden
  >
    <circle cx={12} cy={12} r={9} />
    <path d="M12 7v5l3 2" />
  </svg>
);

const windowKey = (window: LimitWindow) => `${window.kind}/${window.limitKey}`;

const tooltipStyles = {
  tooltip: { background: '#111215', color: '#e4e5e9', border: '1px solid #3a3d48' },
};

// 推定上限額が「N/A」になる理由。コストの範囲を確定できない場合の説明（画面の説明は英語）。
function unavailableText(reason: LimitWindow['unavailableReason']): string {
  switch (reason) {
    case 'unknown-source-device':
      return 'The provider has several accounts and the source device of this account is unknown, so the cost scope cannot be determined.';
    case 'shared-source-device':
      return 'Several accounts share the same source device, so their costs cannot be told apart.';
    case 'no-matching-model':
      return 'No model matches the name of this window group, so the cost scope cannot be determined.';
    case 'not-countable':
      return 'The usage this window counts cannot be identified from model names, so it is not estimated.';
    default:
      return 'The cost scope cannot be determined, so it is not estimated.';
  }
}

export function LimitCircle({
  name,
  label,
  circle,
  now,
}: {
  name: string;
  label: string;
  circle: Circle;
  now: number;
}) {
  const [outer, inner] = circle.windows;
  const monthly = circle.monthlyUsd;
  const line = (window: LimitWindow, y: number) => (
    <text
      key={windowKey(window)}
      x={100}
      y={y}
      textAnchor="middle"
      fontSize={25}
      fontWeight={600}
      fill="#e4e5e9"
    >
      {Math.round(window.remainingPercent)}%{' '}
      <tspan fontSize={16} fontWeight={500} fill="#8b8e99">
        {windowLabel(window)}
      </tspan>
    </text>
  );
  return (
    <div className="limit-circle" aria-label={name}>
      {monthly !== null && <MonthlyLimit value={monthly} />}
      <svg viewBox="0 2 200 180" width={176} height={158} role="img" aria-label={name}>
        {circle.windows.map((window, index) => (
          <Arc
            key={windowKey(window)}
            radius={index === 0 ? 90 : 72}
            percent={window.remainingPercent}
            color={paceColors[stateOf(window, now)]}
          />
        ))}
        <text
          x={100}
          y={inner === undefined ? 178 : 174}
          textAnchor="middle"
          fontSize={14}
          fontWeight={500}
          fill="#e4e5e9"
        >
          {label}
        </text>
        {outer !== undefined && line(outer, inner === undefined ? 108 : 92)}
        {inner !== undefined && line(inner, 123)}
      </svg>
      <div className="limit-rows">
        {circle.windows.map((window) => (
          <div className="limit-row" key={windowKey(window)}>
            <b className="c1">{windowLabel(window)}</b>
            <span className="c2">{clock}</span>
            <span className="c3">{remainingText(window.resetsAt, now)}</span>
            {window.estimate === 'estimated' && window.estimatedLimitUsd !== null ? (
              <>
                <span className="c4 muted">≈</span>
                <span className="c5">{cost(window.estimatedLimitUsd)}</span>
              </>
            ) : (
              <>
                <span className="c4" />
                {window.estimate === 'unavailable' ? (
                  <Tooltip
                    multiline
                    w={240}
                    withArrow
                    styles={tooltipStyles}
                    label={unavailableText(window.unavailableReason)}
                  >
                    <span className="c5 muted">N/A</span>
                  </Tooltip>
                ) : (
                  <span className="c5 muted">Estimating</span>
                )}
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
