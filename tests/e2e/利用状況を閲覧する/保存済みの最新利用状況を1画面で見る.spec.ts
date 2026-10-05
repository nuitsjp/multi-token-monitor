import {
  createStats as createStats_part1,
  startFakeHub as startFakeHub_part1,
  withDaily as withDaily_part1,
  createStats as createStats_part2,
  startFakeHub as startFakeHub_part2,
  createStats as createStats_part4,
  startFakeHub as startFakeHub_part4,
  PERIODS as PERIODS_part7,
  recalculateTotals as recalculateTotals_part7,
} from '../hub-sync/fake-hub.ts';
import type {
  FakeDay as FakeDay_part1,
  FakeHub as FakeHub_part2,
  FakeLimitWindow as FakeLimitWindow_part2,
  FakeStats as FakeStats_part2,
  FakeHub as FakeHub_part4,
  FakeLimitWindow as FakeLimitWindow_part4,
  FakeStats as FakeStats_part4,
  FakeStats as FakeStats_part7,
} from '../hub-sync/fake-hub.ts';
import {
  expect as expect_part1,
  test as base_part1,
  TIME_ZONE as TIME_ZONE_part1,
  waitReceived as waitReceived_part1,
  expect as expect_part2,
  receivedAt as receivedAt_part2,
  test as base_part2,
  expect as expect_part4,
  query as query_part4,
  receivedAt as receivedAt_part4,
  test as base_part4,
  expect as expect_part7,
  periodLabels as periodLabels_part7,
  receivedAt as receivedAt_part7,
  test as test_part7,
  TIME_ZONE as TIME_ZONE_part7,
  waitReceived as waitReceived_part7,
  dumpDatabase as dumpDatabase_part9,
  expect as expect_part9,
  expectPeriod as expectPeriod_part9,
  localTime as localTime_part9,
  periodLabels as periodLabels_part9,
  receivedAt as receivedAt_part9,
  test as test_part9,
  TIME_ZONE as TIME_ZONE_part9,
  waitReceived as waitReceived_part9,
} from '../overview/overview.ts';
import {
  test as describePart1,
  test as describePart2,
  test as describePart4,
  test as describePart7,
  test as describePart9,
} from '@playwright/test';
import type { Locator as Locator_part4, Page as Page_part7 } from '@playwright/test';

describePart1.describe('activity', () => {
  const createStats = createStats_part1;
  const startFakeHub = startFakeHub_part1;
  const withDaily = withDaily_part1;
  type FakeDay = FakeDay_part1;
  const expect = expect_part1;
  const base = base_part1;
  const TIME_ZONE = TIME_ZONE_part1;
  const waitReceived = waitReceived_part1;

  // 主成功シナリオ「保存済みの最新利用状況を1画面で見る」のうち、Activityと区画の配置を検証する。
  // 日付はブラウザーの時刻帯（TIME_ZONE）での今日から遡って作る。
  const pad = (value: number) => String(value).padStart(2, '0');
  function daysAgo(count: number): string {
    const [year, month, day] = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE })
      .format(new Date())
      .split('-')
      .map(Number);
    const date = new Date(Date.UTC(year, month - 1, day - count));
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
  }

  const histories: Record<'alpha' | 'beta', FakeDay[]> = {
    alpha: [
      { date: daysAgo(1), tokens: 1000, cost: 1.5 },
      { date: daysAgo(2), tokens: 500 },
      { date: daysAgo(400), tokens: 9 },
    ],
    beta: [
      { date: daysAgo(1), tokens: 3000, cost: 0.5 },
      { date: daysAgo(3), tokens: 250 },
    ],
  };

  const test = base.extend({
    // eslint-disable-next-line no-empty-pattern -- Playwrightは依存のないfixtureにも分割代入を要求する
    alpha: async ({}, use) => {
      const hub = await startFakeHub(
        'alpha-secret-token',
        withDaily(createStats(1), histories.alpha),
      );
      await use(hub);
      await hub.close();
    },
    // eslint-disable-next-line no-empty-pattern
    beta: async ({}, use) => {
      const hub = await startFakeHub(
        'beta-secret-token',
        withDaily(createStats(2), histories.beta),
      );
      await use(hub);
      await hub.close();
    },
  });

  // 全体の合計とBy modelが横に並ぶ幅で確かめる。
  test.use({ timezoneId: TIME_ZONE, viewport: { width: 1600, height: 1000 } });

  test('OVW-12 Activityは全Hubの日別を日付ごとに合算し、期間を切り替えても変えない', async ({
    page,
    app,
  }) => {
    await test.step('開始条件', async () => {
      // Arrange
      await waitReceived(app.databasePath);
    });
    await test.step('手順1', async () => {
      // Act
      await page.goto('/');
    });

    // Assert: 直近52週を、今日より後の日を除いて描く。右上の凡例は文字情報を含まない。
    const activity = page.getByRole('region', { name: 'Activity' });
    const cells = activity.locator('.activity-cell[title]');
    const weekday = new Date(`${daysAgo(0)}T00:00:00Z`).getUTCDay();
    await test.step('受け入れ条件', async () => {
      await expect(cells).toHaveCount(51 * 7 + weekday + 1);

      await expect(activity.getByText('No history')).toHaveCount(0);

      await expect(activity.locator('.activity-legend')).toHaveText('LessMore');
    });

    // 同じ日の値はHub間で合算し、コストは値のあるHubだけを合計する。
    const cell = (count: number) => activity.locator(`[title^="${daysAgo(count)} "]`);
    await test.step('受け入れ条件', async () => {
      await expect(cell(1)).toHaveAttribute('title', `${daysAgo(1)} · 4,000 tokens · $2.00`);

      await expect(cell(2)).toHaveAttribute('title', `${daysAgo(2)} · 500 tokens`);

      await expect(cell(3)).toHaveAttribute('title', `${daysAgo(3)} · 250 tokens`);

      // 蓄積のない日は0のマス、52週より前の日は描かない。
      await expect(cell(4)).toHaveAttribute('title', `${daysAgo(4)} · 0 tokens`);

      await expect(cell(400)).toHaveCount(0);

      // 最大の日が最も濃く、0の日が最も薄い。
      await expect(cell(1)).toHaveClass(/level-4/);

      await expect(cell(4)).toHaveClass(/level-0/);
    });

    // Act: 期間を切り替える。
    const before = await cells.evaluateAll((items) => items.map((item) => item.className));
    await test.step('手順2', async () => {
      for (const name of ['Month', 'All time', 'Today']) {
        await page.getByText(name, { exact: true }).click();
        await expect(page.getByRole('radio', { name })).toBeChecked();
      }
    });
    await test.step('受け入れ条件', async () => {
      // Assert: Activityは変わらない。
      expect(await cells.evaluateAll((items) => items.map((item) => item.className))).toEqual(
        before,
      );
    });
  });

  test('OVW-13 Hub別はDevicesの上に同じ幅で置き、Activityは左列、By modelは右に置く', async ({
    page,
    app,
  }) => {
    await test.step('開始条件', async () => {
      // Arrange
      await waitReceived(app.databasePath);
    });
    await test.step('手順1', async () => {
      // Act
      await page.goto('/');
    });
    await test.step('受け入れ条件', async () => {
      // Assert
      await expect(page.getByRole('region', { name: 'Activity' })).toBeVisible();
    });
    const box = async (name: string) => (await page.getByRole('region', { name }).boundingBox())!;
    const [hub, devices, activity, model, total] = await Promise.all(
      ['By hub', 'Devices', 'Activity', 'By model', 'Total'].map(box),
    );
    await test.step('受け入れ条件', async () => {
      expect(hub.width).toBeCloseTo(devices.width, 0);

      expect(hub.x).toBeCloseTo(devices.x, 0);

      expect(hub.y + hub.height).toBeLessThan(devices.y);

      expect(activity.y).toBeGreaterThan(total.y + total.height - 1);

      expect(activity.x).toBeLessThan(model.x);

      expect(activity.y + activity.height).toBeCloseTo(model.y + model.height, -1);
    });
  });
});
describePart2.describe('estimate-scope', () => {
  const expect = expect_part2;
  const receivedAt = receivedAt_part2;
  const base = base_part2;
  const createStats = createStats_part2;
  const startFakeHub = startFakeHub_part2;
  type FakeHub = FakeHub_part2;
  type FakeLimitWindow = FakeLimitWindow_part2;
  type FakeStats = FakeStats_part2;

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
  function setCost(
    stats: FakeStats,
    deviceIndex: number,
    tool: string,
    model: string,
    cost: number,
  ) {
    const allTime = stats.devices[deviceIndex].periods.allTime;
    allTime.clientModels[tool] = { ...allTime.clientModels[tool], [model]: 1 };
    allTime.clientModelCosts[tool] = { ...allTime.clientModelCosts[tool], [model]: cost };
  }

  function addCost(
    stats: FakeStats,
    deviceIndex: number,
    tool: string,
    model: string,
    add: number,
  ) {
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

    test('EST-1 他のグループの利用ではコストが変わらず、月換算上限額はグループごとに円のラベルへ、合計は見出し行の右端へ出る', async ({
      page,
      app,
      alpha,
    }) => {
      // Arrange
      const db = app.databasePath;
      await test.step('受け入れ条件', async () => {
        await expect.poll(() => receivedAt(db, 'alpha')).toBeTruthy();
      });
      await test.step('手順1', async () => {
        await page.goto('/');
      });
      const limits = page.getByRole('region', { name: 'Usage limits' });
      await test.step('受け入れ条件', async () => {
        await expect(limits.getByText('Estimating', { exact: true })).toHaveCount(4);

        await expect(limits.locator('.limit-monthly')).toHaveCount(0);
      });
      await test.step('開始条件', async () => {
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
      });
      await test.step('受け入れ条件', async () => {
        // Assert: グループごとに、そのグループのモデルだけで求めた金額になる。
        await expect(limits.getByText('$10.00', { exact: true })).toHaveCount(2);

        await expect(limits.getByText('$100.00', { exact: true })).toHaveCount(2);
      });
      await test.step('開始条件', async () => {
        // 月額は2グループで2つ、グループの先頭の円のラベルに出て、見出し行の右端にはその合計が出る。
        await expect
          .poll(async () =>
            (await limits.locator('.limit-group-monthly').allTextContents())
              .map((text) => text.trim())
              .sort(),
          )
          .toEqual(['$44/mo', '$443/mo']);
      });
      await test.step('受け入れ条件', async () => {
        await expect(limits.locator('.limit-heading .limit-monthly')).toHaveText('$487/mo');
      });
      // 円の下のラベルは「枠グループ名 金額/mo」で、長いラベルも円弧の端（丸めた端を含む）より下に置く。
      const labels = limits.locator('.limit-circle svg[role="img"] > text[font-size="14"]');
      await test.step('開始条件', async () => {
        await expect
          .poll(async () => (await labels.allTextContents()).sort())
          .toEqual(['Claude/GPT $443/mo', 'Gemini $44/mo']);
      });
      const clearances = await limits.locator('.limit-circle svg[role="img"]').evaluateAll((svgs) =>
        svgs.map((svg) => {
          const label = svg.querySelector<SVGTextElement>(':scope > text[font-size="14"]')!;
          const arcBottom = Math.max(
            ...[...svg.querySelectorAll<SVGCircleElement>(':scope > circle')].map(
              (arc) =>
                arc.cy.baseVal.value +
                arc.r.baseVal.value * Math.SQRT1_2 +
                Number(arc.getAttribute('stroke-width')) / 2,
            ),
          );
          return label.getBBox().y - arcBottom;
        }),
      );
      await test.step('受け入れ条件', async () => {
        expect(clearances).toHaveLength(2);

        for (const clearance of clearances) expect(clearance).toBeGreaterThan(0);
      });
      await test.step('開始条件', async () => {
        // Act: Claude/GPT のモデルだけ、使用率を動かさずにコストを増やす。
        await send(alpha, db, (next) => {
          addCost(next, 0, 'antigravity', 'claude-sonnet-5-5-medium', 20);
        });
      });
      await test.step('受け入れ条件', async () => {
        // Assert: Gemini の値は変わらず、Claude/GPT だけが (5+20)/5×100 になる。
        await expect(limits.getByText('$500.00', { exact: true })).toHaveCount(2);

        await expect(limits.getByText('$10.00', { exact: true })).toHaveCount(2);
      });
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

    test('EST-2 Estimating と N/A を別に表示し、N/A には理由を示す', async ({
      page,
      app,
      alpha,
    }) => {
      // Arrange
      const db = app.databasePath;
      await test.step('受け入れ条件', async () => {
        await expect.poll(() => receivedAt(db, 'alpha')).toBeTruthy();
      });
      await test.step('手順1', async () => {
        await page.goto('/');
      });
      const limits = page.getByRole('region', { name: 'Usage limits' });
      await test.step('受け入れ条件', async () => {
        // Assert: 範囲を確定できる2枠は Estimating、確定できない Grok Bot は N/A。
        await expect(limits.getByText('Estimating', { exact: true })).toHaveCount(2);

        await expect(limits.getByText('N/A', { exact: true })).toHaveCount(1);
      });
      await test.step('手順4', async () => {
        // Act & Assert: N/A にマウスオーバーすると、英語で理由を示す。
        await limits.getByText('N/A', { exact: true }).hover();
      });
      await test.step('受け入れ条件', async () => {
        await expect(
          page.getByRole('tooltip').filter({ hasText: 'cannot be identified from model names' }),
        ).toBeVisible();
      });
      await test.step('開始条件', async () => {
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
      });
      await test.step('受け入れ条件', async () => {
        // Assert: グループごとの金額と月額（1か月の枠は換算しない）になり、Grok Bot は N/A のまま。
        await expect(limits.getByText('$20.00', { exact: true })).toBeVisible();

        await expect(limits.getByText('$40.00', { exact: true })).toBeVisible();

        await expect(limits.getByText('N/A', { exact: true })).toHaveCount(1);

        await expect(limits.getByText('Estimating', { exact: true })).toHaveCount(0);
      });
      await test.step('開始条件', async () => {
        await expect
          .poll(async () =>
            (await limits.locator('.limit-group-monthly').allTextContents())
              .map((text) => text.trim())
              .sort(),
          )
          .toEqual(['$20/mo', '$40/mo']);
      });
      await test.step('受け入れ条件', async () => {
        // 値を持たない Grok Bot は名前だけを示し、見出しの合計は値を持つグループだけの下限値になる。
        await expect(
          limits.locator(
            '.limit-circle[aria-label="cursor · Grok Bot"] svg > text[font-size="14"]',
          ),
        ).toHaveText('Grok Bot');

        await expect(limits.locator('.limit-heading .limit-monthly')).toHaveText('≥ $60/mo');
      });
      await test.step('開始条件', async () => {
        await limits.locator('.limit-heading .limit-monthly').hover();
      });
      await test.step('受け入れ条件', async () => {
        await expect(
          page.getByRole('tooltip').filter({ hasText: 'so this is a lower bound' }),
        ).toBeVisible();
      });
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

      test('EST-3 各アカウントは取得元の端末のコストだけで推定する', async ({
        page,
        app,
        alpha,
      }) => {
        // Arrange
        const db = app.databasePath;
        await test.step('受け入れ条件', async () => {
          await expect.poll(() => receivedAt(db, 'alpha')).toBeTruthy();
        });
        await test.step('手順1', async () => {
          await page.goto('/');
        });
        const limits = page.getByRole('region', { name: 'Usage limits' });
        await test.step('受け入れ条件', async () => {
          await expect(limits.getByText('Estimating', { exact: true })).toHaveCount(2);
        });
        await test.step('開始条件', async () => {
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
        });
        await test.step('受け入れ条件', async () => {
          // Assert: 他の端末の利用は数えない。
          await expect(limits.getByText('$50.00', { exact: true })).toBeVisible();

          await expect(limits.getByText('$150.00', { exact: true })).toBeVisible();

          await expect(limits.getByText('N/A', { exact: true })).toHaveCount(0);
        });
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
        await test.step('受け入れ条件', async () => {
          await expect.poll(() => receivedAt(db, 'alpha')).toBeTruthy();
        });
        await test.step('手順1', async () => {
          await page.goto('/');
        });
        const limits = page.getByRole('region', { name: 'Usage limits' });
        await test.step('開始条件', async () => {
          // Act: 使用率とコストが動く（共有する端末に $3 を足し、どちらも10pt）。
          await send(alpha, db, (next) => addCost(next, 0, 'opencode', 'm', 3), {
            'pro/Weekly': 90,
            'plus/Weekly': 90,
          });
        });
        await test.step('受け入れ条件', async () => {
          // Assert: どちらも金額にならず N/A のまま（Estimating ではない）。
          await expect(limits.getByText('N/A', { exact: true })).toHaveCount(2);

          await expect(limits.getByText('Estimating', { exact: true })).toHaveCount(0);

          await expect(limits.getByText('$30.00', { exact: true })).toHaveCount(0);
        });
        await test.step('手順4', async () => {
          await limits.getByText('N/A', { exact: true }).first().hover();
        });
        await test.step('受け入れ条件', async () => {
          await expect(
            page.getByRole('tooltip').filter({ hasText: 'share the same source device' }),
          ).toBeVisible();
        });
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
        await test.step('受け入れ条件', async () => {
          await expect.poll(() => receivedAt(db, 'alpha')).toBeTruthy();
        });
        await test.step('手順1', async () => {
          await page.goto('/');
        });
        const limits = page.getByRole('region', { name: 'Usage limits' });
        await test.step('開始条件', async () => {
          // Act
          await send(alpha, db, (next) => addCost(next, 1, 'opencode', 'm', 2), {
            'pro/Weekly': 90,
            'plus/Weekly': 80,
          });
        });
        await test.step('受け入れ条件', async () => {
          // Assert: 端末の分かるアカウントは $2 を20pt、分からないアカウントは N/A。
          await expect(limits.getByText('$10.00', { exact: true })).toBeVisible();

          await expect(limits.getByText('N/A', { exact: true })).toHaveCount(1);
        });
        await test.step('手順4', async () => {
          await limits.getByText('N/A', { exact: true }).hover();
        });
        await test.step('受け入れ条件', async () => {
          await expect(
            page
              .getByRole('tooltip')
              .filter({ hasText: 'source device of this account is unknown' }),
          ).toBeVisible();
        });
      });
    });
  });
});
describePart4.describe('limit-circles', () => {
  type Locator = Locator_part4;
  const expect = expect_part4;
  const query = query_part4;
  const receivedAt = receivedAt_part4;
  const base = base_part4;
  const createStats = createStats_part4;
  const startFakeHub = startFakeHub_part4;
  type FakeHub = FakeHub_part4;
  type FakeLimitWindow = FakeLimitWindow_part4;
  type FakeStats = FakeStats_part4;

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
      await test.step('受け入れ条件', async () => {
        await expect.poll(() => receivedAt(app.databasePath, 'alpha')).toBeTruthy();
      });
      await test.step('手順1', async () => {
        await page.goto('/');
      });
      const accounts = page.getByRole('region', { name: 'Usage limits' }).locator('.limit-account');
      const order = () =>
        accounts.evaluateAll((items) => items.map((item) => item.getAttribute('aria-label')));
      await test.step('開始条件', async () => {
        await expect
          .poll(order)
          .toEqual([
            'claude · Account cl · Pro',
            'antigravity · Account ag · Pro',
            'codex · Account cx · Pro',
          ]);
      });

      const next = structuredClone(alpha.stats);
      const window = next.limits.providers[1].windows[1];
      await test.step('開始条件', async () => {
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
      await test.step('受け入れ条件', async () => {
        await expect.poll(() => receivedAt(db, 'alpha')).toBeTruthy();
      });
      await test.step('手順1', async () => {
        // Act
        await page.goto('/');
      });

      // Assert: Antigravityは1契約で、GeminiとClaude/GPTの円に分かれ、各円に5hと7dが重なる。
      const limits = page.getByRole('region', { name: 'Usage limits' });
      const antigravity = limits.locator('[aria-label="antigravity · Account ag · Pro"]');
      await test.step('受け入れ条件', async () => {
        await expect(antigravity).toContainText('antigravity · Pro');

        await expect(antigravity.locator('.limit-circle')).toHaveCount(2);
      });
      const gemini = circle(antigravity, 'antigravity · Gemini');
      const claudeGpt = circle(antigravity, 'antigravity · Claude/GPT');
      await test.step('受け入れ条件', async () => {
        await expect(gemini).toContainText('72% 5h');

        await expect(gemini).toContainText('35% 7d');

        await expect(claudeGpt).toContainText('18% 5h');

        await expect(claudeGpt).toContainText('62% 7d');

        // Assert: 円の中は短い枠が外側（先頭）で、行も長さの短い順に並ぶ。
        await expect(gemini.locator('.limit-row .c1')).toHaveText(['5h', '7d']);
      });

      // Assert: 枠が3つの契約は、長さ順に2つずつ円に詰め、余りは次の円になる。
      const codex = limits.locator('[aria-label="codex · Account cx · Pro"]');
      const circles = codex.locator('.limit-circle');
      await test.step('受け入れ条件', async () => {
        await expect(circles).toHaveCount(2);

        await expect(circles.nth(0)).toContainText('90% 5h');

        await expect(circles.nth(0)).toContainText('60% 7d');

        await expect(circles.nth(1)).toContainText('45% 1mo');

        await expect(circles.nth(1).locator('.limit-row')).toHaveCount(1);
      });

      // Assert: 枠が1つの円は1本だけ描き、Hubが長さを送らない枠のラベルは kind から決める。
      const claude = circle(limits, 'claude · Pro');
      await test.step('受け入れ条件', async () => {
        await expect(claude).toContainText('50% 1d');

        await expect(claude.locator('svg[role="img"] > circle')).toHaveCount(2);
      });

      // Assert: Hubが送った枠の長さは保存する。送らない枠は NULL のまま保存する。
      const stored = query<{ provider: string; label: string; window_minutes: number | null }>(
        db,
        'SELECT provider, label, window_minutes FROM latest_limit_windows WHERE hub_id = ? ORDER BY provider, label',
        'alpha',
      );
      await test.step('受け入れ条件', async () => {
        expect(
          stored.filter((row) => row.provider === 'antigravity').map((row) => row.window_minutes),
        ).toEqual([300, 10080, 300, 10080]);

        expect(
          stored.filter((row) => row.provider !== 'antigravity').map((row) => row.window_minutes),
        ).toEqual([null, null, null, null]);
      });
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
      await test.step('受け入れ条件', async () => {
        // Arrange
        await expect.poll(() => receivedAt(app.databasePath, 'alpha')).toBeTruthy();
      });
      await test.step('手順1', async () => {
        // Act
        await page.goto('/');
      });

      // Assert: 残り時間の書式。リセット時刻が無い枠は「—」。
      const limits = page.getByRole('region', { name: 'Usage limits' });
      const codex = limits.locator('[aria-label="codex · Account cx · Pro"]');
      const claude = limits.locator('[aria-label="claude · Account cl · Pro"]');
      await test.step('受け入れ条件', async () => {
        await expect(codex.locator('.limit-row .c3')).toHaveText(['1h 5m', '2d 3h']);

        await expect(claude.locator('.limit-row .c3')).toHaveText(['2h 30m', '—']);

        // Assert: ペースと残量の悪い方の色。codexの7dはペース黄・残量20%で赤、claudeの7dはペース判定なし・残量35%で黄。
        await expect.poll(() => arcColors(codex)).toEqual([PURPLE, RED]);

        await expect.poll(() => arcColors(claude)).toEqual([RED, YELLOW]);
      });
      // Assert: codex cy の5hはペース約0.66（黄）・残量55%、7dはペースが大きく残量45%で紫。
      const codexCy = limits.locator('[aria-label="codex · Account cy · Pro"]');
      await test.step('受け入れ条件', async () => {
        await expect.poll(() => arcColors(codexCy)).toEqual([YELLOW, PURPLE]);
      });
    });

    test('LMT-3 画面を開いたままでも1分ごとに残り時間を再計算し、閲覧用APIは呼び直さない', async ({
      page,
      app,
    }) => {
      await test.step('受け入れ条件', async () => {
        // Arrange
        await expect.poll(() => receivedAt(app.databasePath, 'alpha')).toBeTruthy();
      });
      await test.step('開始条件', async () => {
        await page.clock.install({ time: Date.now() });
      });
      let overviewRequests = 0;
      await test.step('開始条件', async () => {
        page.on('request', (request) => {
          if (new URL(request.url()).pathname === '/api/overview') overviewRequests++;
        });
      });
      await test.step('手順1', async () => {
        await page.goto('/');
      });
      const codex = page
        .getByRole('region', { name: 'Usage limits' })
        .locator('[aria-label="codex · Account cx · Pro"]');
      await test.step('受け入れ条件', async () => {
        await expect(codex.locator('.limit-row .c3').first()).toHaveText('1h 5m');
      });
      const before = overviewRequests;
      await test.step('開始条件', async () => {
        // Act
        await page.clock.fastForward('01:00');
      });
      await test.step('受け入れ条件', async () => {
        // Assert
        await expect(codex.locator('.limit-row .c3').first()).toHaveText('1h 4m');

        expect(overviewRequests).toBe(before);
      });
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
        await test.step('開始条件', async () => {
          await expect.poll(() => receivedAt(app.databasePath, 'alpha')).toBeTruthy();
        });
        await test.step('手順1', async () => {
          await page.goto('/');
        });
        await test.step('受け入れ条件', async () => {
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
      });
    }

    test('LMT-4 枠グループごとに、各枠を月換算した最小値を1つ示し（グループが1つの契約は見出し行の右端）、求められないグループには出さない', async ({
      page,
      app,
      alpha,
    }) => {
      // Arrange
      const db = app.databasePath;
      await test.step('受け入れ条件', async () => {
        await expect.poll(() => receivedAt(db, 'alpha')).toBeTruthy();
      });
      await test.step('手順1', async () => {
        await page.goto('/');
      });
      const limits = page.getByRole('region', { name: 'Usage limits' });
      await test.step('受け入れ条件', async () => {
        // Assert: どの枠も Estimating の間は、どのグループにも出ない。
        await expect(limits.getByText('Estimating', { exact: true })).toHaveCount(3);

        await expect(limits.locator('.limit-monthly')).toHaveCount(0);
      });

      // Act: 週次と月次の残量を10ポイント減らし、累計コストを3増やして送る。
      const before = receivedAt(db, 'alpha');
      const next = structuredClone(alpha.stats);
      const windows = next.limits.providers[0].windows;
      await test.step('開始条件', async () => {
        for (const target of windows.filter((item) => item.kind !== 'session')) {
          target.remainingPercent = (target.remainingPercent ?? 0) - 10;
          target.usedPercent = 100 - target.remainingPercent;
        }

        next.devices[0].periods.allTime.clientModelCosts.codex['gpt-5'] += 3;

        alpha.stats = next;

        alpha.send('stats', next);
      });
      await test.step('受け入れ条件', async () => {
        await expect.poll(() => receivedAt(db, 'alpha')).not.toBe(before);

        // Assert: 週次の推定上限額 $30 は 30 ÷ 10,080 × 44,640 で $133、月次の $30 は換算しない。
        // 枠グループ（この契約は全体で1グループ）の最小値 $30 を、見出し行の右端に1つだけ示す（円は2つあるが、円には出ない）。
        await expect(limits.locator('.limit-heading .limit-monthly')).toHaveText('$30/mo');

        await expect(limits.locator('.limit-monthly')).toHaveCount(1);

        await expect(limits.locator('.limit-group-monthly')).toHaveCount(0);

        await expect(limits.locator('.limit-circle')).toHaveCount(2);
      });
      await test.step('開始条件', async () => {
        // Act & Assert: マウスオーバーで、枠グループの月換算上限額を合計した参考値であることを英語で示す。
        await limits.locator('.limit-heading .limit-monthly').hover();
      });
      await test.step('受け入れ条件', async () => {
        await expect(
          page.getByRole('tooltip').filter({ hasText: 'the total of the monthly limits' }),
        ).toBeVisible();
      });
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
      await test.step('受け入れ条件', async () => {
        // Arrange
        await expect.poll(() => receivedAt(app.databasePath, 'alpha')).toBeTruthy();
      });
      await test.step('手順1', async () => {
        // Act
        await page.goto('/');
      });

      // Assert: 文字は無く、色の点が3つ。
      const legend = page.getByLabel('Color legend');
      await test.step('受け入れ条件', async () => {
        await expect(legend).toHaveText('');

        await expect(legend.locator('> *')).toHaveCount(3);
      });
      await test.step('開始条件', async () => {
        // Act & Assert: マウスオーバーでペースの規則と残量の規則を示す。
        await legend.hover();
      });
      const tooltip = page.getByRole('tooltip');
      await test.step('受け入れ条件', async () => {
        await expect(tooltip).toContainText('remaining ÷ ideal remaining');

        await expect(tooltip).toContainText('> 40%');

        await expect(tooltip).toContainText('< 25%');

        await expect(tooltip).toContainText('worse state');
      });
    });
  });
});
describePart7.describe('slot-number', () => {
  type Page = Page_part7;
  const expect = expect_part7;
  const periodLabels = periodLabels_part7;
  const receivedAt = receivedAt_part7;
  const test = test_part7;
  const TIME_ZONE = TIME_ZONE_part7;
  const waitReceived = waitReceived_part7;
  const PERIODS = PERIODS_part7;
  const recalculateTotals = recalculateTotals_part7;
  type FakeStats = FakeStats_part7;

  // 主成功シナリオ「保存済みの最新利用状況を1画面で見る」のうち、トークン数と推定コストのスロット表示を検証する。

  test.use({ timezoneId: TIME_ZONE });

  interface Spin {
    /** 回り始めの数字、上へ回るか、止まるまでの時間。 */
    from: number;
    up: boolean;
    duration: number;
  }

  interface Slot {
    text: string;
    /** 記録を消してから回したリールを、左から順に並べる。 */
    reels: Spin[];
  }

  type Recorded = Spin & { strip: Element };

  /**
   * 画面がリールを回し始めるたびに、その要素と回り方を記録する。
   * 回転は左の桁から順に止まるため、確かめる時点で回っているかを見ると遅い環境で先に止まった桁を数え損なう。
   */
  async function recordSpins(page: Page) {
    await page.addInitScript(() => {
      const spins: Recorded[] = [];
      (window as unknown as { spins: Recorded[] }).spins = spins;
      const animate = Element.prototype.animate;
      Element.prototype.animate = function (keyframes, options) {
        const frames = keyframes as Keyframe[];
        if (this.classList.contains('slot-strip') && 'transform' in frames[0]!) {
          const y = (frame: Keyframe) =>
            (Number(/-?[\d.]+/.exec(String(frame.transform))![0]) * 30) / 100;
          spins.push({
            strip: this,
            from: Math.round(-y(frames[0]!)) % 10,
            up: y(frames.at(-1)!) < y(frames[0]!),
            duration: Number((options as KeyframeAnimationOptions).duration),
          });
        }
        return animate.call(this, keyframes, options);
      };
    });
  }

  const clearSpins = (page: Page) =>
    page.evaluate(() => {
      (window as unknown as { spins: Recorded[] }).spins.length = 0;
    });

  const spinCount = (page: Page) =>
    page.evaluate(() => (window as unknown as { spins: Recorded[] }).spins.length);

  /** 指定した要素（text を含むものだけ）の中の数値ごとに、表示中の値と、記録を消してから回したリールを返す。 */
  function slots(page: Page, selector: string, text = ''): Promise<Slot[]> {
    return page.evaluate(
      ({ selector, text }) => {
        const spins = (window as unknown as { spins: Recorded[] }).spins;
        return [...document.querySelectorAll(selector)]
          .filter((element) => element.textContent!.includes(text))
          .flatMap((element) => [...element.querySelectorAll('.slot')])
          .map((slot) => ({
            text: slot.querySelector('.slot-text')!.textContent!,
            reels: [...slot.querySelectorAll('.slot-strip')].flatMap((strip) =>
              spins
                .filter((spin) => spin.strip === strip)
                .map(({ from, up, duration }) => ({ from, up, duration })),
            ),
          }));
      },
      { selector, text },
    );
  }

  const digits = (text: string) => [...text].filter((char) => /\d/.test(char)).length;

  /** 右端から桁を対応づけ、値が変わった数字の桁を数える。 */
  function changedDigits(before: string, after: string) {
    const old = [...before].reverse();
    return [...after].reverse().filter((char, index) => /\d/.test(char) && char !== old[index])
      .length;
  }

  /** 画面が状態を描き終えるまで待つ。 */
  const painted = (page: Page) =>
    page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );

  /** Alphaの利用量を増やし、上位5件に入る新しいモデルを加えた次の状態を作る。 */
  function advance(stats: FakeStats): FakeStats {
    const next = structuredClone(stats);
    next.updatedAt = new Date().toISOString();
    for (const name of PERIODS) {
      const models = next.devices[0].periods[name].clientModels;
      models.codex['gpt-5'] += 5000;
      models.codex['model-new'] = 900_000;
    }
    recalculateTotals(next, Date.now());
    return next;
  }

  const TOTAL = '[aria-label="Total"]';

  test('小さい数字も初回表示と期間切り替えの停止後に同じ縦位置へ揃う', async ({ page, app }) => {
    await test.step('開始条件', async () => {
      await waitReceived(app.databasePath);
    });
    await test.step('手順1', async () => {
      await page.goto('/');
    });
    await test.step('受け入れ条件', async () => {
      await expect(page.locator(`${TOTAL} .slot`)).toHaveCount(2);
    });
    await test.step('開始条件', async () => {
      // 小さい文字で端数のある行高を再現する。
      await page.addStyleTag({ content: '.slot { font-size: 14px; line-height: 1.55; }' });
    });
    await test.step('手順2', async () => {
      for (const period of [null, periodLabels.month, periodLabels.today]) {
        if (period !== null) {
          const tokens = page.locator(`${TOTAL} .slot-text`).first();
          const before = await tokens.textContent();
          await page.getByText(period, { exact: true }).click();
          await expect(tokens).not.toHaveText(before!);
        }
        await page.waitForFunction(() =>
          [...document.querySelectorAll('.slot-strip')].every(
            (strip) => strip.getAnimations().length === 0,
          ),
        );
        const referenceStyle = await page.addStyleTag({
          content:
            '.slot.reference::before { content: none; } .slot.reference .slot-text { position: static; width: auto; height: auto; overflow: visible; clip-path: none; }',
        });
        for (const selector of [TOTAL, '[aria-label="By hub"]', '[aria-label="By model"] td']) {
          const slot = page.locator(selector).locator('.slot').first();
          const rendered = await slot.screenshot();
          await slot.evaluate((element) => element.classList.add('reference'));
          const plainText = await slot.screenshot();
          await slot.evaluate((element) => element.classList.remove('reference'));
          expect(rendered.equals(plainText)).toBe(true);
        }
        await referenceStyle.evaluate((element) => element.parentNode!.removeChild(element));
      }
    });
  });

  test('OVW-5 画面を開くと、トークン数と推定コストの全桁が0から回って左の桁から順に止まる', async ({
    page,
    app,
  }) => {
    await test.step('開始条件', async () => {
      // Arrange
      await waitReceived(app.databasePath);

      await recordSpins(page);
    });
    await test.step('手順1', async () => {
      // Act
      await page.goto('/');
    });
    const total = page.getByRole('region', { name: 'Total' });
    await test.step('受け入れ条件', async () => {
      await expect(total.locator('.slot')).toHaveCount(2);

      // Assert: 数字の全桁が上へ回り、記号は回らない。左の桁ほど早く止まる（左から順に止まる）。
      for (const slot of await slots(page, TOTAL)) {
        expect(slot.reels).toHaveLength(digits(slot.text));
        expect(slot.reels.every((reel) => reel.up && reel.from === 0)).toBe(true);
        const durations = slot.reels.map((reel) => reel.duration);
        expect(durations).toEqual([...durations].sort((a, b) => a - b));
        expect(new Set(durations).size).toBe(durations.length);
      }
    });
    // 表示中の値は textContent に1回だけ現れる。
    const [tokens, cost] = (await slots(page, TOTAL)).map((slot) => slot.text);
    await test.step('受け入れ条件', async () => {
      await expect(total).toContainText(`Tokens${tokens}Est. cost${cost}USD`);
    });
  });

  test('OVW-6 期間を切り替えると、変わった桁だけが増えたら上へ、減ったら下へ回る', async ({
    page,
    app,
  }) => {
    await test.step('開始条件', async () => {
      // Arrange
      await waitReceived(app.databasePath);

      await recordSpins(page);
    });
    await test.step('手順1', async () => {
      await page.goto('/');
    });
    await test.step('受け入れ条件', async () => {
      await expect(page.getByRole('region', { name: 'Total' }).locator('.slot')).toHaveCount(2);
    });
    const today = (await slots(page, TOTAL))[0]!.text;
    await test.step('開始条件', async () => {
      await clearSpins(page);
    });
    await test.step('手順2', async () => {
      // Act: Today から Month へ切り替えると、トークン数が増える。
      await page.getByText(periodLabels.month, { exact: true }).click();
    });
    await test.step('受け入れ条件', async () => {
      await expect.poll(async () => (await slots(page, TOTAL))[0]!.text).not.toBe(today);
    });

    // Assert
    const month = (await slots(page, TOTAL))[0]!;
    await test.step('受け入れ条件', async () => {
      expect(month.reels).toHaveLength(changedDigits(today, month.text));

      expect(month.reels.every((reel) => reel.up)).toBe(true);
    });
    await test.step('開始条件', async () => {
      // Act & Assert: Month から Today へ戻すと、トークン数が減って下へ回る。
      await clearSpins(page);
    });
    await test.step('手順2', async () => {
      await page.getByText(periodLabels.today, { exact: true }).click();
    });
    await test.step('受け入れ条件', async () => {
      await expect.poll(async () => (await slots(page, TOTAL))[0]!.text).toBe(today);
    });
    const back = (await slots(page, TOTAL))[0]!;
    await test.step('受け入れ条件', async () => {
      expect(back.reels).toHaveLength(changedDigits(month.text, today));

      expect(back.reels.every((reel) => !reel.up)).toBe(true);
    });
  });

  test('OVW-8 アニメーションを減らす設定では、開いたときも期間の切り替えや同期でも回さない', async ({
    page,
    app,
    alpha,
  }) => {
    // Arrange
    const db = app.databasePath;
    await test.step('開始条件', async () => {
      await waitReceived(db);

      await recordSpins(page);

      await page.emulateMedia({ reducedMotion: 'reduce' });
    });
    await test.step('手順1', async () => {
      // Act & Assert: 開いたとき
      await page.goto('/');
    });
    await test.step('受け入れ条件', async () => {
      await expect(page.getByRole('region', { name: 'Total' }).locator('.slot')).toHaveCount(2);
    });
    await test.step('開始条件', async () => {
      await painted(page);
    });
    await test.step('受け入れ条件', async () => {
      expect(await spinCount(page)).toBe(0);
    });

    // Act & Assert: 期間の切り替え
    const today = (await slots(page, TOTAL))[0]!.text;
    await test.step('手順2', async () => {
      await page.getByText(periodLabels.month, { exact: true }).click();
    });
    await test.step('受け入れ条件', async () => {
      await expect.poll(async () => (await slots(page, TOTAL))[0]!.text).not.toBe(today);
    });
    await test.step('開始条件', async () => {
      await painted(page);
    });
    await test.step('受け入れ条件', async () => {
      expect(await spinCount(page)).toBe(0);
    });

    // Act & Assert: 同期
    const month = (await slots(page, TOTAL))[0]!.text;
    const before = receivedAt(db, 'alpha');
    await test.step('開始条件', async () => {
      alpha.send('stats', advance(alpha.stats));
    });
    await test.step('受け入れ条件', async () => {
      await expect.poll(() => receivedAt(db, 'alpha')).not.toBe(before);

      await expect.poll(async () => (await slots(page, TOTAL))[0]!.text).not.toBe(month);
    });
    await test.step('開始条件', async () => {
      await painted(page);
    });
    await test.step('受け入れ条件', async () => {
      expect(await spinCount(page)).toBe(0);
    });
  });
});
describePart9.describe('view-overview', () => {
  const dumpDatabase = dumpDatabase_part9;
  const expect = expect_part9;
  const expectPeriod = expectPeriod_part9;
  const localTime = localTime_part9;
  const periodLabels = periodLabels_part9;
  const receivedAt = receivedAt_part9;
  const test = test_part9;
  const TIME_ZONE = TIME_ZONE_part9;
  const waitReceived = waitReceived_part9;

  // 主成功シナリオ「保存済みの最新利用状況を1画面で見る」と、ユースケース共通の受け入れ条件を検証する。

  test.use({ timezoneId: TIME_ZONE });

  test('OVW-1 全Hubへ到達でき、期間の切り替えで合計・Hub別・内訳を切り替える', async ({
    page,
    app,
    alpha,
    beta,
  }) => {
    // Arrange
    const db = app.databasePath;
    await test.step('開始条件', async () => {
      await waitReceived(db);
    });
    const stats = { alpha: alpha.stats, beta: beta.stats };
    await test.step('手順1', async () => {
      // Act
      await page.goto('/');
    });
    await test.step('受け入れ条件', async () => {
      // Assert: 初期表示は Today の先頭ページ。合計はトークン数と推定コストだけで、Hubは2件見える。
      await expectPeriod(page, stats, 'today');
    });
    const total = page.getByRole('region', { name: 'Total' });
    await test.step('受け入れ条件', async () => {
      await expect(total).not.toContainText('Hubs');

      await expect(total).not.toContainText('Devices');
    });
    const byHub = page.getByRole('region', { name: 'By hub' });
    const hubPage = page.getByLabel('Hub page');
    await test.step('受け入れ条件', async () => {
      await expect(byHub.locator('.hub-slot[aria-label]')).toHaveCount(2);

      await expect(byHub.locator('.hub-slot[aria-hidden]')).toHaveCount(0);

      await expect(byHub.locator('[aria-label="Offline Hub"]')).toHaveCount(0);
    });
    await test.step('手順3', async () => {
      // Act: 次のページへ送る。
      await hubPage.getByRole('button', { name: '2', exact: true }).click();
    });
    await test.step('受け入れ条件', async () => {
      // Assert: 未受信のHubと空の2件目だけが見え、期間は変わらない。空枠はHub行と同じ高さを保つ。
      await expect(byHub.locator('[aria-label="Offline Hub"]')).toContainText('Not received');

      await expect(byHub.locator('.hub-slot[aria-label]')).toHaveCount(1);

      await expect(byHub.locator('[aria-label="Alpha Hub"]')).toHaveCount(0);
    });
    const slotHeight = await byHub
      .locator('.hub-slot')
      .evaluateAll((slots) => slots.map((slot) => getComputedStyle(slot).minHeight));
    await test.step('受け入れ条件', async () => {
      expect(slotHeight).toEqual(['52px', '52px']);

      await expect(page.getByRole('radio', { name: 'Today' })).toBeChecked();
    });
    await test.step('手順2', async () => {
      // Act & Assert: 期間を切り替えてもHubのページは維持する。
      await page.getByText('Month', { exact: true }).click();
    });
    await test.step('受け入れ条件', async () => {
      await expect(page.getByRole('radio', { name: 'Month' })).toBeChecked();

      await expect(byHub.locator('[aria-label="Offline Hub"]')).toBeVisible();

      await expect(byHub.locator('[aria-label="Alpha Hub"]')).toHaveCount(0);
    });
    await test.step('手順5', async () => {
      // Act & Assert: 再読み込みで Today の先頭ページに戻る。
      await page.reload();
    });
    await test.step('受け入れ条件', async () => {
      await expect(page.getByRole('radio', { name: 'Today' })).toBeChecked();

      await expect(byHub.locator('[aria-label="Alpha Hub"]')).toBeVisible();

      await expect(byHub.locator('[aria-label="Beta Hub"]')).toBeVisible();

      await expect(byHub.locator('[aria-label="Offline Hub"]')).toHaveCount(0);

      // 時刻はブラウザーのローカル時刻で表示する。
      await expect(byHub.locator('[aria-label="Alpha Hub"]')).toContainText(
        `Received ${localTime(receivedAt(db, 'alpha')!)} · Updated ${localTime(alpha.stats.updatedAt)}`,
      );
    });

    // 端末は全Hub分を表示し、鮮度切れに目印を付ける。
    const devices = page.getByRole('region', { name: 'Devices' });
    const staleDevice = alpha.stats.devices[1];
    await test.step('受け入れ条件', async () => {
      await expect(devices.getByRole('row')).toHaveCount(7);

      await expect(
        devices.getByRole('row', { name: new RegExp(staleDevice.hostname) }),
      ).toContainText(`Alpha Hub${localTime(staleDevice.updatedAt)}Stale`);
    });
    await test.step('手順2', async () => {
      // Act & Assert: 期間を切り替えると、合計・Hub別・内訳が選択した期間の値になる。
      for (const name of ['month', 'allTime'] as const) {
        await page.getByText(periodLabels[name], { exact: true }).click();
        await expectPeriod(page, stats, name);
      }
    });
  });

  test('OVW-2 利用枠はHubを切り替えて、そのHubが報告した枠だけを表示する', async ({
    page,
    app,
  }) => {
    await test.step('開始条件', async () => {
      // Arrange
      await waitReceived(app.databasePath);
    });
    await test.step('手順1', async () => {
      await page.goto('/');
    });
    const limits = page.getByRole('region', { name: 'Usage limits' });
    await test.step('手順2', async () => {
      await page.getByText('Month', { exact: true }).click();
    });
    await test.step('受け入れ条件', async () => {
      // Assert: 初期表示は一覧の先頭のHub。メーターを表示しない枠（Credits）は出さない。
      await expect(limits.getByRole('radio', { name: 'Alpha Hub' })).toBeChecked();

      await expect(limits.getByLabel('codex · Account 1 · Pro', { exact: true })).toBeVisible();

      await expect(limits).toContainText('90% 5h');

      await expect(limits).toContainText('60% 7d');

      await expect(limits).not.toContainText('Credits');

      await expect(limits.getByLabel('codex · Account 2 · Pro', { exact: true })).toHaveCount(0);
    });
    await test.step('手順4', async () => {
      // Act & Assert: Hubを切り替えると、そのHubの枠に変わり、期間の選択は変えない。
      await limits.getByText('Beta Hub', { exact: true }).click();
    });
    await test.step('受け入れ条件', async () => {
      await expect(limits.getByLabel('codex · Account 2 · Pro', { exact: true })).toBeVisible();

      await expect(limits.getByLabel('codex · Account 1 · Pro', { exact: true })).toHaveCount(0);

      await expect(page.getByRole('radio', { name: 'Month' })).toBeChecked();
    });
    await test.step('手順4', async () => {
      await limits.getByText('Offline Hub', { exact: true }).click();
    });
    await test.step('受け入れ条件', async () => {
      await expect(limits).toContainText('No limits');
    });
  });

  test('OVW-4 閲覧はURLと認証トークンを含まず、保存済みの状態を変更しない', async ({
    page,
    app,
    alpha,
    beta,
    refusing,
  }) => {
    // Arrange
    const db = app.databasePath;
    await test.step('開始条件', async () => {
      await waitReceived(db);
    });
    const before = dumpDatabase(db);
    await test.step('手順1', async () => {
      // Act
      await page.goto('/');
    });
    await test.step('受け入れ条件', async () => {
      await expect(page.getByRole('region', { name: 'Total' })).toBeVisible();
    });
    const response = await page.request.get('/api/overview');
    await test.step('受け入れ条件', async () => {
      // Assert
      expect(response.status()).toBe(200);
    });
    const body = await response.text();
    const html = await page.content();
    await test.step('受け入れ条件', async () => {
      for (const secret of [
        alpha.url,
        beta.url,
        new URL(alpha.url).host,
        new URL(beta.url).host,
        refusing.url,
        new URL(refusing.url).host,
        alpha.token,
        beta.token,
        'offline-token',
      ]) {
        expect(body).not.toContain(secret);
        expect(html).not.toContain(secret);
      }

      expect(dumpDatabase(db)).toBe(before);
    });
  });

  test('OVW-9 推定上限額は2つの計測点から求め、条件を満たさない枠は Estimating と表示する', async ({
    page,
    app,
    alpha,
    beta,
  }) => {
    // Arrange
    const db = app.databasePath;
    await test.step('開始条件', async () => {
      await waitReceived(db);
    });
    await test.step('手順1', async () => {
      await page.goto('/');
    });
    const limits = page.getByRole('region', { name: 'Usage limits' });
    // 残量とコストの増加を指定して、Hubに stats を送らせる。
    const send = async (
      hub: typeof alpha,
      hubId: string,
      remaining: number,
      cost: number,
    ): Promise<void> => {
      const before = receivedAt(db, hubId);
      const next = structuredClone(hub.stats);
      const session = next.limits.providers[0].windows[0];
      session.remainingPercent = remaining;
      session.usedPercent = 100 - remaining;
      next.devices[0].periods.allTime.clientModelCosts.codex['gpt-5'] += cost;
      hub.stats = next;
      hub.send('stats', next);
      await expect.poll(() => receivedAt(db, hubId)).not.toBe(before);
    };
    await test.step('受け入れ条件', async () => {
      // Assert: 受信が1回だけの枠は、計測点が1つなので推定しない。
      await expect(limits.getByText('Estimating', { exact: true })).toHaveCount(2);
    });
    await test.step('開始条件', async () => {
      // Act & Assert: 使用率の増加が1ポイント未満なら推定しない。
      await send(alpha, 'alpha', 89.4, 1.5);
    });
    await test.step('受け入れ条件', async () => {
      await expect(limits).toContainText('89% 5h');

      await expect(limits.getByText('Estimating', { exact: true })).toHaveCount(2);
    });
    await test.step('開始条件', async () => {
      // Act & Assert: 1ポイント以上増えたら、コストの増加 ÷ 使用率の増加 × 100 を表示する。
      // 残量が変わらない Weekly は推定しない。
      await send(alpha, 'alpha', 89, 0.5);
    });
    await test.step('受け入れ条件', async () => {
      await expect(limits.getByText('$200.00', { exact: true })).toBeVisible();

      await expect(limits.getByText('Estimating', { exact: true })).toHaveCount(1);
    });
    await test.step('開始条件', async () => {
      // Act & Assert: 使用率が1ポイント以上増えても、コストが増えていなければ推定しない。
      await send(beta, 'beta', 80, 0);
    });
    await test.step('手順4', async () => {
      await limits.getByText('Beta Hub', { exact: true }).click();
    });
    await test.step('受け入れ条件', async () => {
      await expect(limits).toContainText('80% 5h');

      await expect(limits.getByText('Estimating', { exact: true })).toHaveCount(2);
    });
  });

  const twoHubs = test.extend({
    hubs: async ({ alpha, beta }, use) => {
      await use([
        { id: 'alpha', name: 'Alpha Hub', url: alpha.url, token: alpha.token },
        { id: 'beta', name: 'Beta Hub', url: beta.url, token: beta.token },
      ]);
    },
  });

  twoHubs('OVW-10 Hubが2件のときはページを送らず、両方を表示する', async ({ page, app }) => {
    // Arrange
    const db = app.databasePath;
    await test.step('開始条件', async () => {
      await expect
        .poll(() => [receivedAt(db, 'alpha'), receivedAt(db, 'beta')].every(Boolean))
        .toBe(true);
    });
    await test.step('手順1', async () => {
      // Act
      await page.goto('/');
    });

    // Assert
    const byHub = page.getByRole('region', { name: 'By hub' });
    await test.step('受け入れ条件', async () => {
      await expect(page.getByRole('radio', { name: 'Today' })).toBeChecked();

      await expect(page.getByLabel('Hub page')).toHaveCount(0);

      await expect(byHub.locator('[aria-label="Alpha Hub"]')).toBeVisible();

      await expect(byHub.locator('[aria-label="Beta Hub"]')).toBeVisible();

      await expect(byHub.locator('.hub-slot[aria-hidden]')).toHaveCount(0);
    });
  });

  const oneHub = test.extend({
    hubs: async ({ alpha }, use) => {
      await use([{ id: 'alpha', name: 'Alpha Hub', url: alpha.url, token: alpha.token }]);
    },
  });

  oneHub('OVW-11 Hubが1件のときはページを送らず、空の2件目で高さを保つ', async ({ page, app }) => {
    // Arrange
    const db = app.databasePath;
    await test.step('受け入れ条件', async () => {
      await expect.poll(() => Boolean(receivedAt(db, 'alpha'))).toBe(true);
    });
    await test.step('手順1', async () => {
      // Act
      await page.goto('/');
    });

    // Assert
    const byHub = page.getByRole('region', { name: 'By hub' });
    await test.step('受け入れ条件', async () => {
      await expect(page.getByLabel('Hub page')).toHaveCount(0);

      await expect(byHub.locator('.hub-slot[aria-label]')).toHaveCount(1);

      await expect(byHub.locator('[aria-label="Alpha Hub"]')).toBeVisible();
    });
    const slotHeight = await byHub
      .locator('.hub-slot')
      .evaluateAll((slots) => slots.map((slot) => getComputedStyle(slot).minHeight));
    await test.step('受け入れ条件', async () => {
      expect(slotHeight).toEqual(['52px', '52px']);
    });
  });
});
