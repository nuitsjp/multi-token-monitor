# 月換算上限額の推移を表示する

## 主アクター
利用者。

## 目的
製品ごとの月換算上限額と、支払額に対する倍率の推移を確認し、製品どうしで比較する。

## 前提
アプリケーションが起動し、接続設定にあるHubが登録されている。

## 用語
- 製品: Homeの利用枠で月換算上限額を1つ示す単位。Hub × 契約（提供元＋アカウント）× 枠グループとする。契約の枠グループが1つなら、製品は契約と同じである。
- 月換算上限額: Homeの「月換算上限額」と同じ式で求めた値。
- プラン: 提供元と、Hubが報告するプラン名の組。
- 価格表: プランごとの月額（USD）と最終更新日時を持つ、DBのマスター。
- 支払額: 製品の契約のプランを価格表で引いた、その日の月額。
- 倍率: 月換算上限額 ÷ 支払額。

## 共通の受け入れ条件
- 動作合意済みの画面を基準とし、By modelと同じ文字サイズ・余白・配色を使う。
- 画面の表示はすべて英語とする。月換算上限額と支払額は「$643/mo」の形（整数のドル）、倍率は「×12.4」の形（小数1桁）で示す。
- 閲覧は保存済みの日次記録を読み、Hubへの接続やデータの書き換えを行わない。
- HubのURL・認証トークンを画面・閲覧APIに含めない。
- 倍率は、各日の記録に保存した月換算上限額と支払額から求める。価格表が後で変わっても、過去の日の支払額と倍率は変わらない。
- 記録のない日は値をゼロにせず、線を途切れさせる。支払額が無い日（価格表にプランが無い）の倍率も同じ扱いとする。
- 記録はこの機能を導入した日から始まる。それより前の日は、Hubが値を持たないため遡って作らない。
- 日次記録の作り方は [設定したHubの最新状態を受信して保存する](../Hubから利用状況を同期する/scenarios/設定したHubの最新状態を受信して保存する.md) に従う。

## 価格表
- 契約のプラン名は、Hubが報告する `planLabel` を使い、空なら `accountLabel` を使う。大文字・小文字は区別しない。
- 価格表には、アプリに同梱した価格一覧と、設定画面での編集（今後追加する）の2つの出所がある。プランごとに最終更新日時を比べ、新しい方を使う。
- 起動時に、同梱の価格一覧（プランごとの月額と最終更新日時）をDBと比べ、DBに無いプランと、同梱の最終更新日時の方が新しいプランをDBへ書き込む。同梱の一覧から消えたプランは、DBから消さない。
- 設定画面での編集は今回の対象外とする。追加するときは、編集した時刻を最終更新日時としてDBに書く。
- 同梱の初期値は、Token Monitor（固定版 `8b6cee22eabb7bf7ce0226655b46907300e14a04`）が報告するプランのうち、プラン名から月額を1つに決められるものだけとする。無料、従量課金、席単位の課金、プラン名からティアを区別できないもの（Claudeの `Max`・`Team`、Grokの `SuperGrok`、MiniMaxの `Token Plan` など）は収録せず、支払額は空（倍率はN/A）とする。
- Codexの `Pro 5x` は100、`Pro 20x` は200とする。公式の料金ページはPro 100・Pro 200・Pro 500を載せるが、5x・20xとの対応を示していないため、この対応を採る。

初期の価格表（USD／月、月払いの定価。2026-10-04に公式の料金ページで確認）:

| 提供元 | プラン名 | 月額 | 出典 |
| --- | --- | --- | --- |
| claude | Pro | 20 | https://claude.com/pricing |
| claude | Max 5x | 100 | https://support.claude.com/en/articles/11049741-what-is-the-max-plan |
| claude | Max 20x | 200 | 同上 |
| codex | Plus | 20 | https://learn.chatgpt.com/docs/pricing |
| codex | Go | 8 | 同上 |
| codex | Pro 5x | 100 | https://help.openai.com/en/articles/9793128-about-chatgpt-pro-plans |
| codex | Pro 20x | 200 | 同上 |
| cursor | Pro | 20 | https://cursor.com/en-US/pricing |
| cursor | Pro+ | 60 | 同上 |
| cursor | Ultra | 200 | 同上 |
| copilot | Pro | 10 | https://docs.github.com/en/copilot/get-started/plans |
| copilot | Pro+ | 39 | 同上 |
| copilot | Max | 100 | 同上 |
| zed | Zed Pro | 10 | https://zed.dev/pricing |
| kiro | Pro | 20 | https://kiro.dev/pricing/ |
| kiro | Pro+ | 40 | 同上 |
| kiro | Pro Max | 100 | 同上 |
| kiro | Power | 200 | 同上 |
| kiro | Q Developer Pro | 19 | https://aws.amazon.com/q/developer/pricing/ |
| qoder | Pro | 20 | https://docs.qoder.com/account/pricing |
| qoder | Pro+ | 60 | 同上 |
| qoder | Ultra | 200 | 同上 |
| commandcode | Go | 1 | https://commandcode.ai/pricing |
| commandcode | GOAT | 10 | 同上 |
| commandcode | Pro | 20 | 同上 |
| commandcode | Max 10x | 100 | 同上 |
| commandcode | Max 20x | 200 | 同上 |
| zai | GLM Coding Lite | 18 | https://z.ai/subscribe |
| zai | GLM Coding Pro | 80 | 同上 |
| zai | GLM Coding Max | 168 | 同上 |
| ollama | Pro | 20 | https://ollama.com/pricing |
| ollama | Max | 100 | 同上 |
| antigravity | Plus | 4.99 | https://gemini.google/subscriptions/ |
| antigravity | Pro | 19.99 | 同上 |
| alibaba | Lite | 8 | https://www.alibabacloud.com/help/en/model-studio/token-plan-personal-overview |
| alibaba | Essential | 16 | 同上 |
| alibaba | Standard | 25 | 同上 |
| alibaba | Pro | 80 | 同上 |
| mimo | Lite | 6 | https://mimo.mi.com/docs/en-US/price/token-plan |
| mimo | Standard | 16 | 同上 |
| mimo | Pro | 50 | 同上 |
| mimo | Max | 100 | 同上 |

## シナリオ
- [製品を選んで月換算上限額の推移を見る](scenarios/製品を選んで月換算上限額の推移を見る.md)

## 実現パターン
- [UCP-1. Hubから受信した最新状態をDBへ反映する](../../design/UCP-1.md)
- [UCP-2. 保存済みのドメインモデルを閲覧用APIで画面へ渡す](../../design/UCP-2.md)
- [UCP-3. DBへの保存確定を画面へ通知し、取得し直させる](../../design/UCP-3.md)
