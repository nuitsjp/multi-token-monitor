import { expect, receivedAt, test as base } from './overview.ts';
import {
  createStats,
  startFakeHub,
  type FakeHub,
  type FakeLimitWindow,
  type FakeStats,
} from '../hub-sync/fake-hub.ts';

// 主成功シナリオ「保存済みの最新利用状況を1画面で見る」のうち、推定上限額の「枠のコストの範囲」
// （枠グループ・アカウント・取得元の端末ごとの分離）と、Estimating・N/A の区別、月換算上限額の位置を検証する。

const MINUTE = 60_000;

interface Account {
  provider: string;
  accountKey: string;
  sourceDeviceId?: string;
  windows: FakeLimitWindow[];
}

/** リセット時刻はテストの間に過ぎない先の時刻にする。 */
const window = (kind: string, label: string, remaining: number): FakeLimitWindow => ({
  kind,
  label,
  usedPercent: 100 - remaining,
  remainingPercent: remaining,
  resetsAt: new Date(Date.now() + 90 * MINUTE).toISOString(),
  showMeter: true,
});

/** 端末の allTime に、ツール・モデルごとの累計の推定コストを設定する（today・month は変えない）。 */
function setCost(stats: FakeStats, deviceIndex: number, tool: string, model: string, cost: number) {
  const allTime = stats.devices[deviceIndex].periods.allTime;
  allTime.clientModels[tool] = { ...allTime.clientModels[tool], [model]: 1 };
  allTime.clientModelCosts[tool] = { ...allTime.clientModelCosts[tool], [model]: cost };
}

function addCost(stats: FakeStats, deviceIndex: number, tool: string, model: string, add: number) {
  const current = stats.devices[deviceIndex].periods.allTime.clientModelCosts[tool]?.[model] ?? 0;
  setCost(stats, deviceIndex, tool, model, current + add);
}

interface Scenario {
  accounts: () => Account[];
  costs: (stats: FakeStats) => void;
}

const test = base.extend<{ alpha: FakeHub; scenario: Scenario }>({
  scenario: [{ accounts: () => [], costs: () => {} }, { option: true }],
  alpha: async ({ scenario }, use) => {
    const stats = createStats(1);
    stats.limits.providers = scenario.accounts().map((account) => ({
      provider: account.provider,
      accountKey: account.accountKey,
      accountLabel: `Account ${account.accountKey}`,
      planLabel: 'Pro',
      ...(account.sourceDeviceId === undefined ? {} : { sourceDeviceId: account.sourceDeviceId }),
      windows: account.windows,
    }));
    scenario.costs(stats);
    const hub = await startFakeHub('alpha-secret-token', stats);
    await use(hub);
    await hub.close();
  },
  hubs: async ({ alpha }, use) => {
    await use([{ id: 'alpha', name: 'Alpha Hub', url: alpha.url, token: alpha.token }]);
  },
});

/** 残量を指定した値に変え、コストを足した stats を送って、保存を待つ。 */
async function send(
  hub: FakeHub,
  db: string,
  change: (next: FakeStats) => void,
  remaining: Record<string, number> = {},
) {
  const before = receivedAt(db, 'alpha');
  const next = structuredClone(hub.stats);
  for (const provider of next.limits.providers)
    for (const target of provider.windows) {
      const value = remaining[`${provider.accountKey}/${target.label}`];
      if (value === undefined) continue;
      target.remainingPercent = value;
      target.usedPercent = 100 - value;
    }
  change(next);
  hub.stats = next;
  hub.send('stats', next);
  await expect.poll(() => receivedAt(db, 'alpha')).not.toBe(before);
}

test.describe('枠グループが複数の契約', () => {
  test.use({
    scenario: {
      accounts: () => [
        {
          provider: 'antigravity',
          accountKey: 'ag',
          windows: [
            window('session', 'Gemini 5-hour', 100),
            window('weekly', 'Gemini weekly', 100),
            window('session', 'Claude/GPT 5-hour', 100),
            window('weekly', 'Claude/GPT weekly', 100),
          ],
        },
      ],
      costs: (stats) => {
        setCost(stats, 0, 'antigravity', 'gemini-3.8-flash', 10);
        setCost(stats, 0, 'antigravity', 'claude-sonnet-5-5-medium', 2);
        setCost(stats, 0, 'antigravity', 'unknown', 1);
      },
    },
  });

  test('EST-1 他のグループの利用ではコストが変わらず、月換算上限額はグループごとに先頭の円の右上へ出る', async ({
    page,
    app,
    alpha,
  }) => {
    // Arrange
    const db = app.databasePath;
    await expect.poll(() => receivedAt(db, 'alpha')).toBeTruthy();
    await page.goto('/');
    const limits = page.getByRole('region', { name: 'Usage limits' });
    await expect(limits.getByText('Estimating', { exact: true })).toHaveCount(4);
    await expect(limits.locator('.limit-monthly')).toHaveCount(0);

    // Act: Gemini は3pt・$0.30、Claude/GPT は5pt・$5.00。判別できないモデル（unknown）の利用も増やす。
    await send(
      alpha,
      db,
      (next) => {
        addCost(next, 0, 'antigravity', 'gemini-3.8-flash', 0.3);
        addCost(next, 0, 'antigravity', 'claude-sonnet-5-5-medium', 5);
        addCost(next, 0, 'antigravity', 'unknown', 50);
      },
      {
        'ag/Gemini 5-hour': 97,
        'ag/Gemini weekly': 97,
        'ag/Claude/GPT 5-hour': 95,
        'ag/Claude/GPT weekly': 95,
      },
    );

    // Assert: グループごとに、そのグループのモデルだけで求めた金額になる。
    await expect(limits.getByText('$10.00', { exact: true })).toHaveCount(2);
    await expect(limits.getByText('$100.00', { exact: true })).toHaveCount(2);
    // 月額は2グループで2つ、グループの先頭の円の右上に出て、見出し行には出ない。
    await expect(limits.locator('.limit-circle .limit-monthly')).toHaveCount(2);
    await expect(limits.locator('.limit-heading .limit-monthly')).toHaveCount(0);
    await expect
      .poll(async () => (await limits.locator('.limit-monthly').allInnerTexts()).sort())
      .toEqual(['$44/mo', '$443/mo']);

    // Act: Claude/GPT のモデルだけ、使用率を動かさずにコストを増やす。
    await send(alpha, db, (next) => {
      addCost(next, 0, 'antigravity', 'claude-sonnet-5-5-medium', 20);
    });

    // Assert: Gemini の値は変わらず、Claude/GPT だけが (5+20)/5×100 になる。
    await expect(limits.getByText('$500.00', { exact: true })).toHaveCount(2);
    await expect(limits.getByText('$10.00', { exact: true })).toHaveCount(2);
  });
});

test.describe('個別ルールのある提供元', () => {
  test.use({
    scenario: {
      accounts: () => [
        {
          provider: 'cursor',
          accountKey: 'cu',
          windows: [
            window('billing', 'Cursor Models', 90),
            window('billing', 'Other Models', 90),
            window('weekly', 'Grok Bot', 100),
          ],
        },
      ],
      costs: (stats) => {
        setCost(stats, 0, 'cursor', 'composer-2', 1);
        setCost(stats, 0, 'cursor', 'cursor-grok-4.6-high', 2);
        setCost(stats, 0, 'cursor', 'cursor-auto', 4);
        setCost(stats, 0, 'cursor', 'claude-opus-5-5-medium', 8);
      },
    },
  });

  test('EST-2 Estimating と N/A を別に表示し、N/A には理由を示す', async ({ page, app, alpha }) => {
    // Arrange
    const db = app.databasePath;
    await expect.poll(() => receivedAt(db, 'alpha')).toBeTruthy();
    await page.goto('/');
    const limits = page.getByRole('region', { name: 'Usage limits' });

    // Assert: 範囲を確定できる2枠は Estimating、確定できない Grok Bot は N/A。
    await expect(limits.getByText('Estimating', { exact: true })).toHaveCount(2);
    await expect(limits.getByText('N/A', { exact: true })).toHaveCount(1);

    // Act & Assert: N/A にマウスオーバーすると、日本語で理由を示す。
    await limits.getByText('N/A', { exact: true }).hover();
    await expect(
      page.getByRole('tooltip').filter({ hasText: '特定できないため、推定しません' }),
    ).toBeVisible();

    // Act: Cursor Models は3pt・composer と grok の $0.60、Other Models は5pt・それ以外の $2.00。
    await send(
      alpha,
      db,
      (next) => {
        addCost(next, 0, 'cursor', 'composer-2', 0.2);
        addCost(next, 0, 'cursor', 'cursor-grok-4.6-high', 0.4);
        addCost(next, 0, 'cursor', 'cursor-auto', 0.5);
        addCost(next, 0, 'cursor', 'claude-opus-5-5-medium', 1.5);
      },
      { 'cu/Cursor Models': 87, 'cu/Other Models': 85 },
    );

    // Assert: グループごとの金額と月額（1か月の枠は換算しない）になり、Grok Bot は N/A のまま。
    await expect(limits.getByText('$20.00', { exact: true })).toBeVisible();
    await expect(limits.getByText('$40.00', { exact: true })).toBeVisible();
    await expect(limits.getByText('N/A', { exact: true })).toHaveCount(1);
    await expect(limits.getByText('Estimating', { exact: true })).toHaveCount(0);
    await expect
      .poll(async () =>
        (await limits.locator('.limit-circle .limit-monthly').allInnerTexts()).sort(),
      )
      .toEqual(['$20/mo', '$40/mo']);
  });
});

test.describe('同じ提供元に複数のアカウントがある契約', () => {
  test.describe('取得元の端末が分かれる', () => {
    test.use({
      scenario: {
        accounts: () => [
          {
            provider: 'opencode',
            accountKey: 'pro',
            sourceDeviceId: 'device-1-1',
            windows: [window('weekly', 'Weekly', 100)],
          },
          {
            provider: 'opencode',
            accountKey: 'plus',
            sourceDeviceId: 'device-1-2',
            windows: [window('weekly', 'Weekly', 100)],
          },
        ],
        costs: (stats) => {
          setCost(stats, 0, 'opencode', 'm', 1);
          setCost(stats, 1, 'opencode', 'm', 5);
          setCost(stats, 2, 'opencode', 'm', 100);
        },
      },
    });

    test('EST-3 各アカウントは取得元の端末のコストだけで推定する', async ({ page, app, alpha }) => {
      // Arrange
      const db = app.databasePath;
      await expect.poll(() => receivedAt(db, 'alpha')).toBeTruthy();
      await page.goto('/');
      const limits = page.getByRole('region', { name: 'Usage limits' });
      await expect(limits.getByText('Estimating', { exact: true })).toHaveCount(2);

      // Act: どちらも2pt。取得元の端末に $1 と $3、取得元でない端末には $50 を足す。
      await send(
        alpha,
        db,
        (next) => {
          addCost(next, 0, 'opencode', 'm', 1);
          addCost(next, 1, 'opencode', 'm', 3);
          addCost(next, 2, 'opencode', 'm', 50);
        },
        { 'pro/Weekly': 98, 'plus/Weekly': 98 },
      );

      // Assert: 他の端末の利用は数えない。
      await expect(limits.getByText('$50.00', { exact: true })).toBeVisible();
      await expect(limits.getByText('$150.00', { exact: true })).toBeVisible();
      await expect(limits.getByText('N/A', { exact: true })).toHaveCount(0);
    });
  });

  test.describe('取得元の端末を共有する', () => {
    test.use({
      scenario: {
        accounts: () => [
          {
            provider: 'opencode',
            accountKey: 'pro',
            sourceDeviceId: 'device-1-1',
            windows: [window('weekly', 'Weekly', 100)],
          },
          {
            provider: 'opencode',
            accountKey: 'plus',
            sourceDeviceId: 'device-1-1',
            windows: [window('weekly', 'Weekly', 100)],
          },
        ],
        costs: (stats) => setCost(stats, 0, 'opencode', 'm', 1),
      },
    });

    test('EST-4 同じ取得元の端末を共有するアカウントは N/A で、理由を示す', async ({
      page,
      app,
      alpha,
    }) => {
      // Arrange
      const db = app.databasePath;
      await expect.poll(() => receivedAt(db, 'alpha')).toBeTruthy();
      await page.goto('/');
      const limits = page.getByRole('region', { name: 'Usage limits' });

      // Act: 使用率とコストが動く（共有する端末に $3 を足し、どちらも10pt）。
      await send(alpha, db, (next) => addCost(next, 0, 'opencode', 'm', 3), {
        'pro/Weekly': 90,
        'plus/Weekly': 90,
      });

      // Assert: どちらも金額にならず N/A のまま（Estimating ではない）。
      await expect(limits.getByText('N/A', { exact: true })).toHaveCount(2);
      await expect(limits.getByText('Estimating', { exact: true })).toHaveCount(0);
      await expect(limits.getByText('$30.00', { exact: true })).toHaveCount(0);
      await limits.getByText('N/A', { exact: true }).first().hover();
      await expect(
        page.getByRole('tooltip').filter({ hasText: '同じ取得元の端末を共有しているため' }),
      ).toBeVisible();
    });
  });

  test.describe('取得元の端末が不明', () => {
    test.use({
      scenario: {
        accounts: () => [
          { provider: 'opencode', accountKey: 'pro', windows: [window('weekly', 'Weekly', 100)] },
          {
            provider: 'opencode',
            accountKey: 'plus',
            sourceDeviceId: 'device-1-2',
            windows: [window('weekly', 'Weekly', 100)],
          },
        ],
        costs: (stats) => setCost(stats, 1, 'opencode', 'm', 1),
      },
    });

    test('EST-5 取得元の端末が分からないアカウントだけが N/A になる', async ({
      page,
      app,
      alpha,
    }) => {
      // Arrange
      const db = app.databasePath;
      await expect.poll(() => receivedAt(db, 'alpha')).toBeTruthy();
      await page.goto('/');
      const limits = page.getByRole('region', { name: 'Usage limits' });

      // Act
      await send(alpha, db, (next) => addCost(next, 1, 'opencode', 'm', 2), {
        'pro/Weekly': 90,
        'plus/Weekly': 80,
      });

      // Assert: 端末の分かるアカウントは $2 を20pt、分からないアカウントは N/A。
      await expect(limits.getByText('$10.00', { exact: true })).toBeVisible();
      await expect(limits.getByText('N/A', { exact: true })).toHaveCount(1);
      await limits.getByText('N/A', { exact: true }).hover();
      await expect(
        page.getByRole('tooltip').filter({ hasText: '取得元の端末が分からないため' }),
      ).toBeVisible();
    });
  });
});
