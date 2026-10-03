using MultiTokenMonitor.Features.Overview;
using Shouldly;
using Xunit;

namespace MultiTokenMonitor.UnitTests.Features.Overview;

// 枠のコストの範囲の決定と推定上限額を求める純粋関数を、ケースごとに検証する。
public sealed class LimitEstimatorTests
{
    private static LimitWindowInput Window(
        string account, string kind, string? label, double remaining, double baseRemaining, string? device = null) =>
        new(new WindowKey(account, kind, label ?? ""), label, remaining, baseRemaining, device);

    private static CostEntry Cost(string device, string model, double cost) => new(device, model, cost);

    // 枠ごとの1つ目の計測点のコストを、全枠で同じ内容にする。
    private static IReadOnlyDictionary<WindowKey, IReadOnlyList<CostEntry>> Baseline(
        IEnumerable<LimitWindowInput> windows, params CostEntry[] costs) =>
        windows.ToDictionary(window => window.Key, _ => (IReadOnlyList<CostEntry>)costs);

    private static IReadOnlyDictionary<WindowKey, EstimateResult> Estimate(
        string provider,
        IReadOnlyList<LimitWindowInput> windows,
        IReadOnlyList<CostEntry> current,
        params CostEntry[] baseline) =>
        LimitEstimator.Estimate(provider, windows, current, Baseline(windows, baseline));

    private static void ShouldBeEstimated(EstimateResult result, double expected)
    {
        result.Status.ShouldBe(EstimateStatus.Estimated);
        result.Reason.ShouldBeNull();
        result.LimitUsd.ShouldNotBeNull().ShouldBe(expected, 1e-9);
    }

    private static void ShouldBeEstimating(EstimateResult result)
    {
        result.Status.ShouldBe(EstimateStatus.Estimating);
        result.LimitUsd.ShouldBeNull();
        result.Reason.ShouldBeNull();
    }

    private static void ShouldBeUnavailable(EstimateResult result, UnavailableReason reason)
    {
        result.Status.ShouldBe(EstimateStatus.Unavailable);
        result.LimitUsd.ShouldBeNull();
        result.Reason.ShouldBe(reason);
    }

    public sealed class GroupOf
    {
        [Theory]
        [InlineData("Gemini 5-hour", "Gemini")]
        [InlineData("Gemini weekly", "Gemini")]
        [InlineData("Claude/GPT weekly", "Claude/GPT")]
        [InlineData("Claude/GPT 5-hour", "Claude/GPT")]
        [InlineData("Fable weekly", "Fable")]
        [InlineData("Weekly", "")]
        [InlineData("weekly", "")]
        [InlineData("WEEKLY", "")]
        [InlineData("Session", "")]
        [InlineData("5h", "")]
        [InlineData("5-hour", "")]
        [InlineData("Daily", "")]
        [InlineData("Monthly", "")]
        [InlineData("", "")]
        [InlineData(null, "")]
        [InlineData("Cursor Models", "Cursor Models")]
        [InlineData("Other Models", "Other Models")]
        [InlineData("Grok Bot", "Grok Bot")]
        [InlineData("Requests", "Requests")]
        [InlineData("Gemini   5-hour", "Gemini")]
        [InlineData("GEMINI WEEKLY", "GEMINI")]
        [InlineData("メイン weekly", "メイン")]
        [InlineData("メインweekly", "メイン")]
        [InlineData("weeklyplan", "weeklyplan")]
        [InlineData("Gemini weekly extra", "Gemini weekly extra")]
        public void Label_RemovesTrailingWindowWord(string? label, string expected)
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            var group = LimitEstimator.GroupOf(label);

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            group.ShouldBe(expected);
        }
    }

    public sealed class SingleAccountSingleGroup
    {
        [Fact]
        public void Costs_UseAllDevicesAndModelsOfTheProvider()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            var windows = new[] { Window("a", "session", "", 90, 100), Window("a", "weekly", "", 60, 70) };
            CostEntry[] current = [Cost("d1", "m1", 10), Cost("d2", "m2", 5)];

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            var results = Estimate("codex", windows, current, Cost("d1", "m1", 4), Cost("d2", "m2", 1));

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            // 増加は (10-4) + (5-1) = 10。session は使用率10pt、weekly は10pt。
            ShouldBeEstimated(results[windows[0].Key], 100);
            ShouldBeEstimated(results[windows[1].Key], 100);
        }

        [Fact]
        public void SourceDevice_IsIgnoredWhenThereIsOnlyOneAccount()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            var windows = new[] { Window("a", "session", "", 90, 100, device: "d1") };
            CostEntry[] current = [Cost("d1", "m", 3), Cost("d2", "m", 7)];

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            var results = Estimate("codex", windows, current);

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            ShouldBeEstimated(results[windows[0].Key], 100);
        }

        [Fact]
        public void WindowsOfTheSameGroup_UseTheirOwnBaselines()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            var session = Window("a", "session", "", 90, 100);
            var weekly = Window("a", "weekly", "", 90, 100);
            CostEntry[] current = [Cost("d1", "m", 10)];
            var baselines = new Dictionary<WindowKey, IReadOnlyList<CostEntry>>
            {
                [session.Key] = [Cost("d1", "m", 8)],
                [weekly.Key] = [Cost("d1", "m", 5)],
            };

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            var results = LimitEstimator.Estimate("codex", [session, weekly], current, baselines);

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            ShouldBeEstimated(results[session.Key], 20);
            ShouldBeEstimated(results[weekly.Key], 50);
        }

        [Fact]
        public void WindowWithoutBaselineEntry_CountsTheWholeCurrentCost()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            var window = Window("a", "session", "", 90, 100);

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            var results = LimitEstimator.Estimate(
                "codex", [window], [Cost("d1", "m", 2)], new Dictionary<WindowKey, IReadOnlyList<CostEntry>>());

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            ShouldBeEstimated(results[window.Key], 20);
        }
    }

    public sealed class Increase
    {
        [Fact]
        public void PairWhoseCostDecreased_IsFlooredAtZeroAndDoesNotCancelOthers()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            var windows = new[] { Window("a", "session", "", 90, 100) };
            CostEntry[] current = [Cost("d1", "m1", 4), Cost("d1", "m2", 6)];

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            var results = Estimate("p", windows, current, Cost("d1", "m1", 10), Cost("d1", "m2", 0));

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            // m1 は -6 だが0として扱い、m2 の +6 だけが増加になる。
            ShouldBeEstimated(results[windows[0].Key], 60);
        }

        [Fact]
        public void PairMissingFromBaseline_CountsItsWholeCost()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            var windows = new[] { Window("a", "session", "", 90, 100) };
            CostEntry[] current = [Cost("d1", "old", 5), Cost("d1", "new", 3)];

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            var results = Estimate("p", windows, current, Cost("d1", "old", 5));

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            ShouldBeEstimated(results[windows[0].Key], 30);
        }

        [Fact]
        public void PairMissingFromCurrent_CountsZero()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            var windows = new[] { Window("a", "session", "", 90, 100) };

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            var results = Estimate("p", windows, [Cost("d1", "m", 2)], Cost("d1", "m", 2), Cost("d2", "gone", 9));

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            ShouldBeEstimating(results[windows[0].Key]);
        }

        [Fact]
        public void NoCosts_IsEstimating()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            var windows = new[] { Window("a", "session", "", 90, 100) };

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            var results = Estimate("p", windows, []);

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            ShouldBeEstimating(results[windows[0].Key]);
        }

        [Fact]
        public void UnchangedCosts_AreEstimatingEvenWhenUsageMoved()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            var windows = new[] { Window("a", "session", "", 80, 100) };

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            var results = Estimate("p", windows, [Cost("d1", "m", 5)], Cost("d1", "m", 5));

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            ShouldBeEstimating(results[windows[0].Key]);
        }
    }

    public sealed class UsedPercent
    {
        [Theory]
        [InlineData(100, 99.001, false)]
        [InlineData(100, 99, true)]
        [InlineData(100, 98.5, true)]
        [InlineData(100, 100, false)]
        [InlineData(50, 51, false)]
        [InlineData(98.585, 97.651, false)]
        [InlineData(98.585, 97.171, true)]
        public void Increase_IsEstimatedOnlyFromOnePoint(double baseRemaining, double remaining, bool estimated)
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            // 残量が baseRemaining から remaining へ（remaining が大きければ使用率が減っている）。
            var windows = new[] { Window("a", "session", "", remaining, baseRemaining) };

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            var results = Estimate("p", windows, [Cost("d1", "m", 10)], Cost("d1", "m", 5));

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            results[windows[0].Key].Status.ShouldBe(estimated ? EstimateStatus.Estimated : EstimateStatus.Estimating);
        }

        [Fact]
        public void Amount_IsCostIncreaseDividedByUsedPercentTimes100()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            var windows = new[] { Window("a", "session", "", 96, 100) };

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            var results = Estimate("p", windows, [Cost("d1", "m", 0.84)]);

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            ShouldBeEstimated(results[windows[0].Key], 0.84 / 4 * 100);
        }
    }

    public sealed class MultipleGroups
    {
        private static readonly LimitWindowInput[] Antigravity =
        [
            Window("a", "session", "Gemini 5-hour", 97, 100),
            Window("a", "weekly", "Gemini weekly", 97, 100),
            Window("a", "session", "Claude/GPT 5-hour", 95, 100),
            Window("a", "weekly", "Claude/GPT weekly", 95, 100),
        ];

        private static readonly CostEntry[] AntigravityBaseline =
        [
            Cost("d1", "gemini-3.8-flash", 10),
            Cost("d1", "claude-sonnet-5-5-medium", 2),
            Cost("d1", "unknown", 1),
        ];

        [Fact]
        public void EachGroup_CountsOnlyItsOwnModels()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            CostEntry[] current =
            [
                Cost("d1", "gemini-3.8-flash", 10.30),
                Cost("d1", "claude-sonnet-5-5-medium", 7),
                Cost("d1", "unknown", 4),
            ];

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            var results = Estimate("antigravity", Antigravity, current, AntigravityBaseline);

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            // Gemini は +0.30 を3pt、Claude/GPT は +5.00 を5pt。判別できないモデルはどこにも数えない。
            ShouldBeEstimated(results[Antigravity[0].Key], 10);
            ShouldBeEstimated(results[Antigravity[1].Key], 10);
            ShouldBeEstimated(results[Antigravity[2].Key], 100);
            ShouldBeEstimated(results[Antigravity[3].Key], 100);
        }

        [Fact]
        public void OtherGroupsUsage_DoesNotChangeAnEstimate()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            CostEntry[] geminiOnly = [Cost("d1", "gemini-3.8-flash", 10.30), Cost("d1", "claude-sonnet-5-5-medium", 2)];
            CostEntry[] withClaude = [Cost("d1", "gemini-3.8-flash", 10.30), Cost("d1", "claude-sonnet-5-5-medium", 50)];

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            var before = Estimate("antigravity", Antigravity, geminiOnly, AntigravityBaseline);
            var after = Estimate("antigravity", Antigravity, withClaude, AntigravityBaseline);

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            after[Antigravity[0].Key].ShouldBe(before[Antigravity[0].Key]);
            after[Antigravity[1].Key].ShouldBe(before[Antigravity[1].Key]);
            after[Antigravity[2].Key].ShouldNotBe(before[Antigravity[2].Key]);
        }

        [Theory]
        [InlineData("claude-opus-4-6")]
        [InlineData("gpt-5.5")]
        [InlineData("CLAUDE-X")]
        [InlineData("GPT-5")]
        public void TokensOfAGroupName_MatchModelsCaseInsensitively(string model)
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            var windows = new[] { Window("a", "session", "Claude/GPT 5-hour", 90, 100), Window("a", "session", "Gemini 5-hour", 90, 100) };

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            var results = Estimate("antigravity", windows, [Cost("d1", model, 1), Cost("d1", "gemini-x", 1)]);

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            ShouldBeEstimated(results[windows[0].Key], 10);
            ShouldBeEstimated(results[windows[1].Key], 10);
        }

        [Fact]
        public void NamedGroupWithoutAnyMatchingModel_IsUnavailable()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            var windows = new[] { Window("a", "session", "Gemini 5-hour", 90, 100), Window("a", "session", "Claude/GPT 5-hour", 90, 100) };

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            var results = Estimate("antigravity", windows, [Cost("d1", "claude-x", 2)]);

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            ShouldBeUnavailable(results[windows[0].Key], UnavailableReason.NoMatchingModel);
            ShouldBeEstimated(results[windows[1].Key], 20);
        }

        [Fact]
        public void ModelOnlyInTheBaseline_CountsAsAMatchingModel()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            var windows = new[] { Window("a", "session", "Gemini 5-hour", 90, 100), Window("a", "session", "Claude/GPT 5-hour", 90, 100) };

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            var results = Estimate("antigravity", windows, [Cost("d1", "claude-x", 2)], Cost("d1", "gemini-x", 1));

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            ShouldBeEstimating(results[windows[0].Key]);
        }

        [Fact]
        public void UnnamedGroup_CountsTheModelsNoNamedGroupCounts()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            var windows = new[] { Window("a", "weekly", "", 90, 100), Window("a", "weekly", "Fable weekly", 90, 100) };
            CostEntry[] current = [Cost("d1", "claude-opus-5", 4), Cost("d1", "claude-fable-5", 6)];

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            var results = Estimate("claude", windows, current, Cost("d1", "claude-opus-5", 0), Cost("d1", "claude-fable-5", 0));

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            ShouldBeEstimated(results[windows[0].Key], 40);
            ShouldBeEstimated(results[windows[1].Key], 60);
        }

        [Fact]
        public void UnnamedGroup_ExcludesTheModelsOfEveryNamedGroup()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            var windows = new[]
            {
                Window("a", "weekly", "", 90, 100),
                Window("a", "weekly", "Fable weekly", 90, 100),
                Window("a", "weekly", "Opus weekly", 90, 100),
            };
            CostEntry[] current = [Cost("d1", "x-model", 1), Cost("d1", "fable-5", 2), Cost("d1", "opus-5", 4)];

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            var results = Estimate("p", windows, current);

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            ShouldBeEstimated(results[windows[0].Key], 10);
            ShouldBeEstimated(results[windows[1].Key], 20);
            ShouldBeEstimated(results[windows[2].Key], 40);
        }

        [Fact]
        public void ModelMatchingSeveralGroups_IsCountedByEachOfThem()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            var windows = new[] { Window("a", "weekly", "Claude weekly", 90, 100), Window("a", "weekly", "Opus weekly", 90, 100) };

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            var results = Estimate("p", windows, [Cost("d1", "claude-opus-5", 3)]);

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            ShouldBeEstimated(results[windows[0].Key], 30);
            ShouldBeEstimated(results[windows[1].Key], 30);
        }
    }

    public sealed class MultipleAccounts
    {
        [Fact]
        public void AccountsWithDifferentSourceDevices_CountOnlyTheirOwnDevice()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            var pro = Window("pro", "weekly", "", 90, 100, device: "main");
            var plus = Window("plus", "weekly", "", 90, 100, device: "mini");
            CostEntry[] current = [Cost("main", "m", 3), Cost("mini", "m", 8), Cost("other", "m", 100)];

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            var results = Estimate("codex", [pro, plus], current);

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            ShouldBeEstimated(results[pro.Key], 30);
            ShouldBeEstimated(results[plus.Key], 80);
        }

        [Fact]
        public void AccountsSharingASourceDevice_AreUnavailable()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            var first = Window("first", "weekly", "", 90, 100, device: "main");
            var second = Window("second", "weekly", "", 90, 100, device: "main");

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            var results = Estimate("codex", [first, second], [Cost("main", "m", 3)]);

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            ShouldBeUnavailable(results[first.Key], UnavailableReason.SharedSourceDevice);
            ShouldBeUnavailable(results[second.Key], UnavailableReason.SharedSourceDevice);
        }

        [Theory]
        [InlineData(null)]
        [InlineData("")]
        public void AccountWithoutSourceDevice_IsUnavailableButTheOtherAccountIsNot(string? device)
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            var unknown = Window("unknown", "weekly", "", 90, 100, device: device);
            var known = Window("known", "weekly", "", 90, 100, device: "main");

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            var results = Estimate("codex", [unknown, known], [Cost("main", "m", 3), Cost("mini", "m", 9)]);

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            ShouldBeUnavailable(results[unknown.Key], UnavailableReason.UnknownSourceDevice);
            ShouldBeEstimated(results[known.Key], 30);
        }

        [Fact]
        public void ThreeAccounts_OnlyTheOnesSharingADeviceAreUnavailable()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            var a = Window("a", "weekly", "", 90, 100, device: "d1");
            var b = Window("b", "weekly", "", 90, 100, device: "d1");
            var c = Window("c", "weekly", "", 90, 100, device: "d2");

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            var results = Estimate("codex", [a, b, c], [Cost("d1", "m", 1), Cost("d2", "m", 2)]);

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            ShouldBeUnavailable(results[a.Key], UnavailableReason.SharedSourceDevice);
            ShouldBeUnavailable(results[b.Key], UnavailableReason.SharedSourceDevice);
            ShouldBeEstimated(results[c.Key], 20);
        }

        [Fact]
        public void SeveralWindowsOfOneAccount_ShareItsSourceDevice()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            var session = Window("a", "session", "", 90, 100, device: "d1");
            var weekly = Window("a", "weekly", "", 80, 100, device: "d1");
            var other = Window("b", "weekly", "", 90, 100, device: "d2");

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            var results = Estimate("codex", [session, weekly, other], [Cost("d1", "m", 2), Cost("d2", "m", 5)]);

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            ShouldBeEstimated(results[session.Key], 20);
            ShouldBeEstimated(results[weekly.Key], 10);
            ShouldBeEstimated(results[other.Key], 50);
        }

        [Fact]
        public void DeviceScopeAndGroupNameMatch_ApplyTogether()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            var geminiA = Window("a", "weekly", "Gemini weekly", 90, 100, device: "d1");
            var claudeA = Window("a", "weekly", "Claude weekly", 90, 100, device: "d1");
            var geminiB = Window("b", "weekly", "Gemini weekly", 90, 100, device: "d2");
            var claudeB = Window("b", "weekly", "Claude weekly", 90, 100, device: "d2");
            CostEntry[] current =
            [
                Cost("d1", "gemini-x", 1), Cost("d1", "claude-x", 2), Cost("d2", "gemini-x", 4), Cost("d2", "claude-x", 8),
            ];

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            var results = Estimate("p", [geminiA, claudeA, geminiB, claudeB], current);

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            ShouldBeEstimated(results[geminiA.Key], 10);
            ShouldBeEstimated(results[claudeA.Key], 20);
            ShouldBeEstimated(results[geminiB.Key], 40);
            ShouldBeEstimated(results[claudeB.Key], 80);
        }

        [Fact]
        public void UncountableGroup_IsDecidedBeforeTheSourceDevices()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            // 個別ルールで範囲を確定できない枠は、端末の事情より先に判定する。
            var grokBot = Window("a", "weekly", "Grok Bot", 100, 100, device: "d1");
            var other = Window("b", "weekly", "Other Models", 90, 100, device: "d1");

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            var results = Estimate("cursor", [grokBot, other], [Cost("d1", "m", 1)]);

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            ShouldBeUnavailable(results[grokBot.Key], UnavailableReason.NotCountable);
            ShouldBeUnavailable(results[other.Key], UnavailableReason.SharedSourceDevice);
        }
    }

    public sealed class IndividualRules
    {
        private static readonly LimitWindowInput[] Cursor =
        [
            Window("a", "billing", "Cursor Models", 90, 100),
            Window("a", "billing", "Other Models", 90, 100),
            Window("a", "weekly", "Grok Bot", 100, 100),
        ];

        private static readonly CostEntry[] CursorCosts =
        [
            Cost("d1", "composer-2", 1),
            Cost("d1", "cursor-grok-4.6-high", 2),
            Cost("d1", "grok-4.7-high", 4),
            Cost("d1", "cursor-auto", 8),
            Cost("d1", "claude-opus-5-5-medium", 16),
            Cost("d1", "gpt-5.5-medium", 32),
        ];

        [Fact]
        public void Cursor_SplitsModelsByGrokAndComposer()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            var results = Estimate("cursor", Cursor, CursorCosts);

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            // Cursor Models: composer-2 + cursor-grok + grok = 7、Other Models: cursor-auto + claude + gpt = 56。
            ShouldBeEstimated(results[Cursor[0].Key], 70);
            ShouldBeEstimated(results[Cursor[1].Key], 560);
            ShouldBeUnavailable(results[Cursor[2].Key], UnavailableReason.NotCountable);
        }

        [Fact]
        public void Cursor_GroupNamesAreMatchedCaseInsensitively()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            var windows = new[] { Window("a", "billing", "CURSOR MODELS", 90, 100), Window("a", "billing", "other models", 90, 100) };

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            var results = Estimate("cursor", windows, CursorCosts);

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            ShouldBeEstimated(results[windows[0].Key], 70);
            ShouldBeEstimated(results[windows[1].Key], 560);
        }

        [Fact]
        public void Cursor_RuleAppliesEvenWhenOnlyOneGroupIsReported()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            var windows = new[] { Window("a", "billing", "Cursor Models", 90, 100) };

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            var results = Estimate("cursor", windows, CursorCosts);

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            ShouldBeEstimated(results[windows[0].Key], 70);
        }

        [Fact]
        public void Cursor_OtherModelsAlone_CountsEveryModel()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            var windows = new[] { Window("a", "billing", "Other Models", 90, 100) };

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            var results = Estimate("cursor", windows, CursorCosts);

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            ShouldBeEstimated(results[windows[0].Key], 630);
        }

        [Fact]
        public void Cursor_GroupWithoutAnIndividualRule_FollowsTheBasicRule()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            var overall = Window("a", "billing", "Overall", 90, 100);

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            var single = Estimate("cursor", [overall], CursorCosts);
            var withGrokBot = Estimate("cursor", [overall, Window("a", "weekly", "Grok Bot", 100, 100)], CursorCosts);

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            // 1グループなら提供元全体、複数グループで名前に対応するモデルが無ければ N/A。
            ShouldBeEstimated(single[overall.Key], 630);
            ShouldBeUnavailable(withGrokBot[overall.Key], UnavailableReason.NoMatchingModel);
        }

        [Fact]
        public void OtherProviders_DoNotUseTheCursorRules()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            var windows = new[] { Window("a", "billing", "Cursor Models", 90, 100), Window("a", "weekly", "Grok Bot", 100, 100) };

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            var results = Estimate("other", windows, CursorCosts);

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            // 基本ルールでは、名前の語（Cursor・Models、Grok・Bot）を含むモデルを数える。
            // Cursor Models: cursor-grok-4.6-high + cursor-auto = 10 を10pt。Grok Bot は使用率が動いていないので推定中（N/A ではない）。
            ShouldBeEstimated(results[windows[0].Key], 100);
            ShouldBeEstimating(results[windows[1].Key]);
        }
    }

    public sealed class Results
    {
        [Fact]
        public void EveryWindow_HasAResult()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------
            var windows = new[]
            {
                Window("a", "session", "Gemini 5-hour", 90, 100),
                Window("a", "weekly", "Claude/GPT weekly", 90, 100),
                Window("b", "weekly", "", 90, 100, device: "d1"),
            };

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            var results = Estimate("p", windows, []);

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            results.Keys.ShouldBe(windows.Select(window => window.Key), ignoreOrder: true);
        }

        [Fact]
        public void NoWindows_HaveNoResults()
        {
            // -------------------------------------------------------------
            // Arrange
            // -------------------------------------------------------------

            // -------------------------------------------------------------
            // Act
            // -------------------------------------------------------------
            var results = Estimate("p", [], [Cost("d1", "m", 1)]);

            // -------------------------------------------------------------
            // Assert
            // -------------------------------------------------------------
            results.ShouldBeEmpty();
        }
    }
}
