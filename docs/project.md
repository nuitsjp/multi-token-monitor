# Token Monitor Analytics のプロジェクト定義

プロジェクト共通の要件・制約、ユースケース一覧、確認した事実、および実行・検証手順の正本です。全体構造は [アーキテクチャ](architecture.md) を参照します。

## 1. 目的と範囲

| 項目 | 内容 |
| --- | --- |
| 解決する問題・達成したい結果 | 私用・業務など別々の Token Monitor Hub に集約されたAIツールの利用状況を、Hubごとに開かずに1か所で確認できるようにする |
| 利用者・利用場面 | Hubを利用する本人が、自分のPCでアプリケーションを起動し、ブラウザーで閲覧する |
| 今回の対象 | 設定したHubからの最新状態の受信と保存、保存済み最新状態の閲覧 |
| 今回の対象外 | Hubへの書き込み（端末削除・サブスクリプション編集）、受信履歴の蓄積、アプリケーションからのHubの登録・編集、利用者向けWeb認証、旧製品のDB移行と旧製品機能の暗黙の復元 |

## 2. 制約・品質要求・受け入れ条件

- Windows上で、ループバックアドレス（127.0.0.1）だけで待ち受けます。単一の利用者が使い、利用者向けの認証は設けません。
- Hubの接続情報（URL・認証トークン）はGit管理外の設定ファイルに置きます。DB、ログ、閲覧用のAPIと画面には含めません。アプリケーションは設定ファイルを更新しません。
- Hubごとに保存するのは最新状態だけです。受信履歴は保存しません。
- あるHubで障害が起きても、他のHubの受信とWebサーバーは止めません。
- 受け入れ条件は各シナリオに記載し、`mise run verify` の合格を完了の条件とします。

<a id="usecases"></a>
## 3. ユースケース一覧

ユースケースの共通事項は `usecases/<名称>/README.md`、シナリオと固有の受け入れ条件は同じディレクトリの `scenarios/<名称>.md` に記載します。案の検討・保存は [提示と保存の手順](standards/mock-driven-development.md#discussion) に従います（未着手のユースケースは下表に名称だけを置き、本文とリンクは作りません）。

ユースケースの単位・系列の分割・モック適用は [モック標準のユースケース分割](standards/mock-driven-development.md#discussion) に従います。

| ユースケース | 主アクター | 目的 | 実装順序 | 実現パターン | モック適用 |
| --- | --- | --- | --- | --- | --- |
| [Hubから利用状況を同期する](usecases/Hubから利用状況を同期する/README.md) | 利用者 | 設定したHubの最新利用状況をローカルに保存し、閲覧できる状態に保つ | 1 | [UCP-1](design/UCP-1.md) | 対象外（UI確認不要） |
| [利用状況を閲覧する](usecases/利用状況を閲覧する/README.md) | 利用者 | 登録したHubの最新利用状況を1画面で確認する | 2 | [UCP-2](design/UCP-2.md) | 対象 |

<a id="design"></a>
## 4. 確認した事実

- 対象のHubは [Javis603/token-monitor](https://github.com/Javis603/token-monitor) の固定版 `8b6cee22eabb7bf7ce0226655b46907300e14a04` です。`docs/API.md` によると、`GET /api/stats/stream` はSSEで次の3種類のイベントを送ります（2026-09-25に確認）。
  - `snapshot`: 接続時の全体状態
  - `stats`: 全体状態の置換
  - `freshness`: 時刻と鮮度情報だけの更新。要求ヘッダー `x-token-monitor-stream: 2` を付けた場合だけ送られます。
- 旧リポジトリで取得した実Hubの応答資料には、アカウントや端末の情報が含まれます。そのためこのリポジトリには複製せず、必要になった時点で改めて測ります。

<a id="commands"></a>
## 5. 実行・切り替え・検証手順

作業ディレクトリはリポジトリのルートです。コマンドはすべてここで実行します。

| 目的 | コマンド | 期待結果 |
| --- | --- | --- |
| 環境構築 | `mise run setup` | 固定版のNode.js・.NET・Pythonと、npm・NuGetの依存を導入します。`.env` がなければ `.env.example` から作成します |
| E2E用ブラウザーの導入 | `mise run setup:browser` | E2Eで使うChromiumを導入します |
| 開発起動 | `mise run dev` | `http://127.0.0.1:5173/` でVite（HMR）の画面を開けます。.NETは `.env` の `HOST`・`PORT`（既定 `127.0.0.1:3000`）で起動します |
| 配布物のビルドと起動 | `mise run build` の後に `mise run start` | `dist/server` に配布物を作り、`http://127.0.0.1:3000/`（`.env` の `HOST`・`PORT`）で画面とAPIを同じポートから配信します |
| 停止 | 起動したターミナルで Ctrl+C | 開発起動ではViteと.NETの両方が停止します |
| 全体検証 | `mise run verify` | API契約の一致、型検査、Lint、整形、文書検査、.NETとフロントエンドの単体テスト、開発構成と配布構成のE2Eがすべて合格します |
| 文書検査 | `python scripts/doc_check.py .` | NGが0件です |

Hub同期のE2E（`tests/e2e/hub-sync/`）は、テストごとにBearerトークンを検証する偽Hubを立て、接続設定のURLをそこへ向けて本番の受信・保存処理を通し、別の読み取り専用接続から保存値を照合します。

設定は `mise run setup` が作る `.env` に置きます。`HOST` は `127.0.0.1` または `::1` だけを受け付けます。DBは `DB_PATH`（既定 `./data/app.sqlite`）のSQLiteファイルで、起動時に作成・移行します。

Hubの接続設定は、`config/hubs.example.json` を `data/hubs.local.json`（Git管理外）へ複製し、各Hubの `id`・`name`・`url`（`http(s)://ホスト[:ポート]` の形式）・`token` を記入して作ります。`.env` の `HUB_CONFIG_PATH`（`.env.example` では `./data/hubs.local.json`）がこのファイルを指します。設定が不正な場合は起動せず、理由を標準エラーに出力して終了します。起動後はHubごとに受信を開始し、保存と受信停止をHub IDと原因の分類だけでログに出力します。

閲覧画面のモックは、環境変数 `VITE_OVERVIEW_MOCK=1` を付けた開発起動で有効になります。画面が閲覧用API（`GET /api/overview`）を呼ばず、`frontend/src/api/overview.mock.ts` の固定データを表示します。既定（未設定）は実APIを呼び、APIが失敗しても固定データは表示しません。

| 目的 | コマンド | 期待結果 |
| --- | --- | --- |
| モック有効で開発起動 | PowerShellで `$env:VITE_OVERVIEW_MOCK='1'; mise run dev` | `http://127.0.0.1:5173/` に、Hub「私用」「業務」と未受信の「検証用」の固定データが表示されます |
| モック無効の確認 | 環境変数を外して `mise run dev` | 画面は `GET /api/overview` を呼び、固定データのHub名は表示されません |

保存済みの状態は、アプリケーションの起動中でも別の読み取り専用接続で確認できます（テーブルは [データ設計](design/data.md) を参照）。

| 目的 | コマンド | 期待結果 |
| --- | --- | --- |
| Hubごとの受信時刻の確認 | `python -c "import sqlite3; db = sqlite3.connect('file:data/app.sqlite?mode=ro', uri=True); print(db.execute('SELECT h.hub_id, h.name, s.received_at FROM hubs h LEFT JOIN hub_states s USING (hub_id)').fetchall())"` | 設定した全Hubが表示され、受信済みのHubには最後に保存した受信時刻が表示されます |
