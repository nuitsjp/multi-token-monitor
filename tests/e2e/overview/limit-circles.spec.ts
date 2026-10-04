import type { Locator } from '@playwright/test';
import { expect, query, receivedAt, test as base } from './overview.ts';
import {
  createStats,
  startFakeHub,
  type FakeHub,
  type FakeLimitWindow,
  type FakeStats,
} from '../hub-sync/fake-hub.ts';

// 主成功シナリオ「保存済みの最新利用状況を1画面で見る」のうち、利用枠の円・残り時間・ペース・月換算上限額・凡例を検証する。

const MINUTE = 60_000;
const PURPLE = '#9085e9';
const YELLOW = '#fab219';
const RED = '#f0616d';

interface Account {
  provider: string;
  accountKey: string;
  windows: FakeLimitWindow[];
}

const inMinutes = (minutes: number) => new Date(Date.now() + minutes * MINUTE).toISOString();

/** 残り時間は、テストの実行中に分がずれないよう、約50秒の余裕を持たせて指定する。 */
const limitWindow = (
  kind: string,
  label: string,
  remaining: number,
  leftMinutes: number | null,
  windowMinutes?: number,
): FakeLimitWindow => ({
  kind,
  label,
  usedPercent: 100 - remaining,
  remainingPercent: remaining,
  resetsAt: leftMinutes === null ? null : inMinutes(leftMinutes + 0.9),
  showMeter: true,
  ...(windowMinutes === undefined ? {} : { windowMinutes }),
});

function statsWith(accounts: Account[]): FakeStats {
  const stats = createStats(1);
  stats.limits.providers = accounts.map((account) => ({
    provider: account.provider,
    accountKey: account.accountKey,
    accountLabel: `Account ${account.accountKey}`,
    planLabel: 'Pro',
    windows: account.windows,
  }));
  return stats;
}

// 残り時間の基準が実行時刻になるよう、契約は関数で指定してテストごとに作る。
const accountsOf = (build: () => Account[]) => ({ accounts: { build } });

const test = base.extend<{ alpha: FakeHub; accounts: { build: () => Account[] } }>({
  accounts: [{ build: () => [] }, { option: true }],
  alpha: async ({ accounts }, use) => {
    const hub = await startFakeHub('alpha-secret-token', statsWith(accounts.build()));
    await use(hub);
    await hub.close();
  },
  hubs: async ({ alpha }, use) => {
    await use([{ id: 'alpha', name: 'Alpha Hub', url: alpha.url, token: alpha.token }]);
  },
});

const circle = (limits: Locator, name: string) =>
  limits.locator(`.limit-circle[aria-label="${name}"]`);

test.describe('契約の残量順', () => {
  test.use(
    accountsOf(() => [
      { provider: 'codex', accountKey: 'cx', windows: [limitWindow('session', '', 35, 200)] },
      {
        provider: 'claude',
        accountKey: 'cl',
        windows: [limitWindow('session', '', 90, 200), limitWindow('weekly', '', 15, 5000)],
      },
      { provider: 'antigravity', accountKey: 'ag', windows: [limitWindow('daily', '', 25, 600)] },
    ]),
  );

  test('最小残量のWindowで契約を昇順に並べ、同期後も並べ直す', async ({ page, app, alpha }) => {
    await expect.poll(() => receivedAt(app.databasePath, 'alpha')).toBeTruthy();
    await page.goto('/');
    const accounts = page.getByRole('region', { name: 'Usage limits' }).locator('.limit-account');
    const order = () =>
      accounts.evaluateAll((items) => items.map((item) => item.getAttribute('aria-label')));
    await expect
      .poll(order)
      .toEqual([
        'claude · Account cl · Pro',
        'antigravity · Account ag · Pro',
        'codex · Account cx · Pro',
      ]);

    const next = structuredClone(alpha.stats);
    const window = next.limits.providers[1].windows[1];
    window.remainingPercent = 80;
    window.usedPercent = 20;
    alpha.stats = next;
    alpha.send('stats', next);
    await expect
      .poll(order)
      .toEqual([
        'antigravity · Account ag · Pro',
        'codex · Account cx · Pro',
        'claude · Account cl · Pro',
      ]);
  });
});

/** 円の中の円弧の色。窓ごとに、下地の円弧と残量の円弧が1組ずつ並ぶ。 */
const arcColors = (target: Locator) =>
  target
    .locator('svg[role="img"] > circle')
    .evaluateAll((arcs) =>
      arcs.filter((_, index) => index % 2 === 1).map((arc) => arc.getAttribute('stroke')),
    );

test.describe('枠の重ね方とグループ', () => {
  test.use(
    accountsOf(() => [
      {
        provider: 'antigravity',
        accountKey: 'ag',
        windows: [
          limitWindow('session', 'Gemini 5-hour', 72, 200, 300),
          limitWindow('weekly', 'Gemini weekly', 35, 5000, 10080),
          limitWindow('session', 'Claude/GPT 5-hour', 18, 240, 300),
          limitWindow('weekly', 'Claude/GPT weekly', 62, 8000, 10080),
        ],
      },
      {
        provider: 'codex',
        accountKey: 'cx',
        windows: [
          limitWindow('weekly', '', 60, 6000),
          limitWindow('billing', 'Monthly', 45, 20000),
          limitWindow('session', '', 90, 250),
        ],
      },
      { provider: 'claude', accountKey: 'cl', windows: [limitWindow('daily', 'Daily', 50, 600)] },
    ]),
  );

  test('LMT-1 契約×枠グループごとに円を作り、外側が短い枠、内側が長い枠で、3枠目は次の円に回る', async ({
    page,
    app,
  }) => {
    // Arrange
    const db = app.databasePath;
    await expect.poll(() => receivedAt(db, 'alpha')).toBeTruthy();

    // Act
    await page.goto('/');

    // Assert: Antigravityは1契約で、GeminiとClaude/GPTの円に分かれ、各円に5hと7dが重なる。
    const limits = page.getByRole('region', { name: 'Usage limits' });
    const antigravity = limits.locator('[aria-label="antigravity · Account ag · Pro"]');
    await expect(antigravity).toContainText('antigravity · Pro');
    await expect(antigravity.locator('.limit-circle')).toHaveCount(2);
    const gemini = circle(antigravity, 'antigravity · Gemini');
    const claudeGpt = circle(antigravity, 'antigravity · Claude/GPT');
    await expect(gemini).toContainText('72% 5h');
    await expect(gemini).toContainText('35% 7d');
    await expect(claudeGpt).toContainText('18% 5h');
    await expect(claudeGpt).toContainText('62% 7d');

    // Assert: 円の中は短い枠が外側（先頭）で、行も長さの短い順に並ぶ。
    await expect(gemini.locator('.limit-row .c1')).toHaveText(['5h', '7d']);

    // Assert: 枠が3つの契約は、長さ順に2つずつ円に詰め、余りは次の円になる。
    const codex = limits.locator('[aria-label="codex · Account cx · Pro"]');
    const circles = codex.locator('.limit-circle');
    await expect(circles).toHaveCount(2);
    await expect(circles.nth(0)).toContainText('90% 5h');
    await expect(circles.nth(0)).toContainText('60% 7d');
    await expect(circles.nth(1)).toContainText('45% 1mo');
    await expect(circles.nth(1).locator('.limit-row')).toHaveCount(1);

    // Assert: 枠が1つの円は1本だけ描き、Hubが長さを送らない枠のラベルは kind から決める。
    const claude = circle(limits, 'claude · Pro');
    await expect(claude).toContainText('50% 1d');
    await expect(claude.locator('svg[role="img"] > circle')).toHaveCount(2);

    // Assert: Hubが送った枠の長さは保存する。送らない枠は NULL のまま保存する。
    const stored = query<{ provider: string; label: string; window_minutes: number | null }>(
      db,
      'SELECT provider, label, window_minutes FROM latest_limit_windows WHERE hub_id = ? ORDER BY provider, label',
      'alpha',
    );
    expect(
      stored.filter((row) => row.provider === 'antigravity').map((row) => row.window_minutes),
    ).toEqual([300, 10080, 300, 10080]);
    expect(
      stored.filter((row) => row.provider !== 'antigravity').map((row) => row.window_minutes),
    ).toEqual([null, null, null, null]);
  });
});

test.describe('残り時間とペース', () => {
  test.use(
    accountsOf(() => [
      {
        provider: 'codex',
        accountKey: 'cx',
        // 5h: 残り1h5m、残量90%（理想は約22%）。7d: 残り2d3h、残量20%（理想は約30%）。
        windows: [limitWindow('session', '', 90, 65), limitWindow('weekly', '', 20, 51 * 60)],
      },
      {
        provider: 'claude',
        accountKey: 'cl',
        // 5h: 残り2h30m、残量5%（理想は50%）。7d: リセット時刻なし、残量35%。
        windows: [limitWindow('session', '', 5, 150), limitWindow('weekly', '', 35, null)],
      },
      {
        provider: 'codex',
        accountKey: 'cy',
        // 5h: 残り4h10m、残量55%（理想は約83%、ペース約0.66）。7d: 残り1h、残量45%（ペースは大きい）。
        windows: [limitWindow('session', '', 55, 250), limitWindow('weekly', '', 45, 60)],
      },
    ]),
  );

  test('LMT-2 残り時間は Xh Ym・Xd Yh で示し、円弧の色をペースと残量の悪い方で紫・黄・赤に変える', async ({
    page,
    app,
  }) => {
    // Arrange
    await expect.poll(() => receivedAt(app.databasePath, 'alpha')).toBeTruthy();

    // Act
    await page.goto('/');

    // Assert: 残り時間の書式。リセット時刻が無い枠は「—」。
    const limits = page.getByRole('region', { name: 'Usage limits' });
    const codex = limits.locator('[aria-label="codex · Account cx · Pro"]');
    const claude = limits.locator('[aria-label="claude · Account cl · Pro"]');
    await expect(codex.locator('.limit-row .c3')).toHaveText(['1h 5m', '2d 3h']);
    await expect(claude.locator('.limit-row .c3')).toHaveText(['2h 30m', '—']);

    // Assert: ペースと残量の悪い方の色。codexの7dはペース黄・残量20%で赤、claudeの7dはペース判定なし・残量35%で黄。
    await expect.poll(() => arcColors(codex)).toEqual([PURPLE, RED]);
    await expect.poll(() => arcColors(claude)).toEqual([RED, YELLOW]);
    // Assert: codex cy の5hはペース約0.66（黄）・残量55%、7dはペースが大きく残量45%で紫。
    const codexCy = limits.locator('[aria-label="codex · Account cy · Pro"]');
    await expect.poll(() => arcColors(codexCy)).toEqual([YELLOW, PURPLE]);
  });

  test('LMT-3 画面を開いたままでも1分ごとに残り時間を再計算し、閲覧用APIは呼び直さない', async ({
    page,
    app,
  }) => {
    // Arrange
    await expect.poll(() => receivedAt(app.databasePath, 'alpha')).toBeTruthy();
    await page.clock.install({ time: Date.now() });
    let overviewRequests = 0;
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/api/overview') overviewRequests++;
    });
    await page.goto('/');
    const codex = page
      .getByRole('region', { name: 'Usage limits' })
      .locator('[aria-label="codex · Account cx · Pro"]');
    await expect(codex.locator('.limit-row .c3').first()).toHaveText('1h 5m');
    const before = overviewRequests;

    // Act
    await page.clock.fastForward('01:00');

    // Assert
    await expect(codex.locator('.limit-row .c3').first()).toHaveText('1h 4m');
    expect(overviewRequests).toBe(before);
  });
});

test.describe('月換算上限額', () => {
  test.use(
    accountsOf(() => [
      {
        provider: 'codex',
        accountKey: 'cx',
        windows: [
          limitWindow('session', '', 90, 250),
          limitWindow('weekly', '', 60, 6000),
          limitWindow('billing', 'Monthly', 45, 20000),
        ],
      },
    ]),
  );

  for (const sample of [
    { name: '5時間枠', sessionDrop: 90, weeklyDrop: 1, expected: '$496/mo' },
    { name: '週次枠', sessionDrop: 1, weeklyDrop: 10, expected: '$133/mo' },
  ]) {
    test(`LMT-4 ${sample.name}の月換算額が小さい場合はその値を採用する`, async ({
      page,
      app,
      alpha,
    }) => {
      await expect.poll(() => receivedAt(app.databasePath, 'alpha')).toBeTruthy();
      await page.goto('/');
      const limits = page.getByRole('region', { name: 'Usage limits' });
      await expect(limits.getByText('Estimating', { exact: true })).toHaveCount(3);

      const before = receivedAt(app.databasePath, 'alpha');
      const next = structuredClone(alpha.stats);
      // 月次枠は動かさない（月額は枠グループの最小値なので、比べる2枠だけを動かす）。
      for (const target of next.limits.providers[0].windows.filter(
        (item) => item.kind !== 'billing',
      )) {
        const drop = target.kind === 'session' ? sample.sessionDrop : sample.weeklyDrop;
        target.remainingPercent = (target.remainingPercent ?? 0) - drop;
        target.usedPercent = 100 - target.remainingPercent;
      }
      next.devices[0].periods.allTime.clientModelCosts.codex['gpt-5'] += 3;
      alpha.stats = next;
      alpha.send('stats', next);
      await expect.poll(() => receivedAt(app.databasePath, 'alpha')).not.toBe(before);

      // 同じ $3 の増分に対し、5h は 3 / 使用率差 × 100 × 148.8、
      // weekly は 3 / 使用率差 × 100 × 31/7。小さい方を整数表示する。
      await expect(limits.locator('.limit-heading .limit-monthly')).toHaveText(sample.expected);
    });
  }

  test('LMT-4 枠グループごとに、各枠を月換算した最小値を1つ示し（グループが1つの契約は見出し行の右端）、求められないグループには出さない', async ({
    page,
    app,
    alpha,
  }) => {
    // Arrange
    const db = app.databasePath;
    await expect.poll(() => receivedAt(db, 'alpha')).toBeTruthy();
    await page.goto('/');
    const limits = page.getByRole('region', { name: 'Usage limits' });

    // Assert: どの枠も Estimating の間は、どのグループにも出ない。
    await expect(limits.getByText('Estimating', { exact: true })).toHaveCount(3);
    await expect(limits.locator('.limit-monthly')).toHaveCount(0);

    // Act: 週次と月次の残量を10ポイント減らし、累計コストを3増やして送る。
    const before = receivedAt(db, 'alpha');
    const next = structuredClone(alpha.stats);
    const windows = next.limits.providers[0].windows;
    for (const target of windows.filter((item) => item.kind !== 'session')) {
      target.remainingPercent = (target.remainingPercent ?? 0) - 10;
      target.usedPercent = 100 - target.remainingPercent;
    }
    next.devices[0].periods.allTime.clientModelCosts.codex['gpt-5'] += 3;
    alpha.stats = next;
    alpha.send('stats', next);
    await expect.poll(() => receivedAt(db, 'alpha')).not.toBe(before);

    // Assert: 週次の推定上限額 $30 は 30 ÷ 10,080 × 44,640 で $133、月次の $30 は換算しない。
    // 枠グループ（この契約は全体で1グループ）の最小値 $30 を、見出し行の右端に1つだけ示す（円は2つあるが、円には出ない）。
    await expect(limits.locator('.limit-heading .limit-monthly')).toHaveText('$30/mo');
    await expect(limits.locator('.limit-monthly')).toHaveCount(1);
    await expect(limits.locator('.limit-group-monthly')).toHaveCount(0);
    await expect(limits.locator('.limit-circle')).toHaveCount(2);

    // Act & Assert: マウスオーバーで、枠グループの月換算上限額を合計した参考値であることを英語で示す。
    await limits.locator('.limit-heading .limit-monthly').hover();
    await expect(
      page.getByRole('tooltip').filter({ hasText: 'the total of the monthly limits' }),
    ).toBeVisible();
  });
});

test.describe('凡例', () => {
  test.use(
    accountsOf(() => [
      { provider: 'codex', accountKey: 'cx', windows: [limitWindow('session', '', 90, 65)] },
    ]),
  );

  test('LMT-5 切り替えの左に色の点だけの凡例を示し、マウスオーバーで2つの規則を示す', async ({
    page,
    app,
  }) => {
    // Arrange
    await expect.poll(() => receivedAt(app.databasePath, 'alpha')).toBeTruthy();

    // Act
    await page.goto('/');

    // Assert: 文字は無く、色の点が3つ。
    const legend = page.getByLabel('Color legend');
    await expect(legend).toHaveText('');
    await expect(legend.locator('> *')).toHaveCount(3);

    // Act & Assert: マウスオーバーでペースの規則と残量の規則を示す。
    await legend.hover();
    const tooltip = page.getByRole('tooltip');
    await expect(tooltip).toContainText('remaining ÷ ideal remaining');
    await expect(tooltip).toContainText('> 40%');
    await expect(tooltip).toContainText('< 25%');
    await expect(tooltip).toContainText('worse state');
  });
});
