# React + .NET Template のプロジェクト定義

## 1. 目的と範囲

React の対話制御から実 ASP.NET Core（.NET 10）・SQLite への更新までを通す参照実装です。C# 名前空間は `NotesSample` です。メモの編集と一括登録の 2 つのパターン、および個別 DB による並列 E2E を提供します。生成時には製品ルートへアプリ一式をコピーし、製品側だけ指定した名前空間へ置換します。

<a id="constraints"></a>
## 2. 制約・受け入れ条件

SPA、単一 ASP.NET Core サーバー、同一 origin、SQLite を既定とします。各利用者のメモは所有者 ID で分離します。4 worker の E2E において、同一ユーザー・同一タイトルを用いてもテスト間で干渉しないこと、UI から実 HTTP API を経由して実ファイル DB を別接続で検証することを条件とします。

一括登録の上限はサンプルとして 100 件です。SQLite の配置、保存方式、トランザクション境界は [データ設計](design/data.md) に従います。

<a id="usecases"></a>
## 3. ユースケース一覧

| ユースケース | 主アクター | 目的 | 実装順序 | 実現パターン | モック適用 |
| --- | --- | --- | --- | --- | --- |
| [メモを作成・編集して保存する](usecases/メモを作成・編集して保存する/README.md) | 利用者 | メモを作成・編集して保存する | 1 | [UCP-1](design/UCP-1.md) | 対象 |
| [複数のメモを確認して一括登録する](usecases/複数のメモを確認して一括登録する/README.md) | 利用者 | 複数のメモを確認して一括登録する | 2 | [UCP-2](design/UCP-2.md) | 対象 |

<a id="design"></a>
## 4. 確認した事実

共通資材の配布元と採用元固定コミットは [ルートの文書方針](../../docs/document-policy.md#adoption) に従います。直接依存は `package.json` と各 `.csproj`、参照アプリの実行ツールとタスクはこのディレクトリの `mise.toml` に記載します。`mise.toml` の `[tools]` は Node.js 24.21.0、.NET SDK 10.0.401、Python 3.13.15 です。

- **ASP.NET Core / .NET SDK**: .NET SDK 10.0.401 と ASP.NET Core .NET 10 を使用します。`backend/App.csproj` が単一サーバーの実行単位で、UI のビルドと静的ファイルの配置も所有します。`App.slnx` は `frontend/Frontend.esproj`、バックエンド、単体テスト、統合テストを束ねます。
- **HTTP JSON / SSE**: ブラウザとサーバーは HTTP JSON の公開エンドポイントで通信し、`/events/notes` は確定後の変更通知に SSE を使用します。エンドポイント、DTO、エラー形状は [React + .NET アーキテクチャ](architecture-react-dotnet.md) に記録します。
- **SQLite**: `Microsoft.Data.Sqlite` と Dapper で実 SQLite を操作し、マイグレーションは `backend/Infrastructure/Persistence/Migrations` に配置します。WAL、外部キー制約、有限の busy timeout を設定し、短い書込みトランザクションで確定します（[SQLite WAL](https://sqlite.org/wal.html)）。
- **公開契約**: C# の API 入出力型を正本とし、OpenAPI と React 用の型を `mise run contracts` で生成します。`contracts/openapi.json` と `contracts/api.gen.ts` はコミットし、`contracts/notes.ts` は生成型の別名だけを定義します。
- **Playwright fixtures**: 開発サーバー形式と配布形式で同じシナリオを実行します。環境生成と破棄を一体化し、fullyParallel と複数 worker を利用します（[fixtures](https://playwright.dev/docs/test-fixtures)）。各 E2E は .NET プロセス、ポート、一時 DB、ブラウザ、Cookie を分離し、独立した Node.js `node:sqlite` 読取専用接続で DB を確認します。

<a id="commands"></a>
## 5. 実行・切り替え・検証手順

参照アプリの mise タスクは生成先または source の `reference/` から実行します。以下の `backend/`、`frontend/`、`contracts/`、`dist/` などのパスも `reference/` を起点とします。

採用先では生成したプロジェクトの `reference/`、テンプレート開発では `react-dotnet-template/reference/` を作業ディレクトリとします。どちらも Docker や外部 DB は不要で、サンプルの `mise.toml` に固定した Node.js 24.21.0、.NET SDK 10.0.401、Python 3.13.15 を使用します。初回セットアップ前にこの `mise.toml` の内容を確認して信頼し、ツールと依存を導入します。

```powershell
mise trust
mise run setup
```

`mise run setup` は `mise install`、npm 依存の `ci`、`.env` の作成、ルートツリーの生成、`dotnet restore App.slnx --locked-mode` を行い、PATH 上の mise の実体パスを絶対パスで `backend/mise.local.props` に記録します。このローカルファイルは Git 管理と配布物から除外されます。`mise run setup` は source と生成先の初回セットアップ時に必要で、mise を移動した後も再実行してください。F5 は npm の依存取得を行いません。依存更新時などに setup を再実行する場合は npm の依存定義とロックを併せて更新し、NuGet は `.csproj` の版を変更してロックを更新します。更新後は `mise run setup` と `mise run verify` で確認します。生成先の製品アプリの依存とロックは採用先で管理します。

Visual Studio で F5 を使う場合はこのディレクトリの `App.slnx` を開き、`backend/App.csproj` の App をスタートアッププロジェクトに設定します。source の場合は `react-dotnet-template/reference/` へ移動して `mise trust` と初回の `mise run setup` を完了してから開いてください。既存の `.suo` に保存された利用者設定がソリューションのプロジェクト順より優先されるため、App の選択を確認してください。frontend（`frontend/Frontend.esproj`）はソリューションの表示用であり、依存取得や UI ビルドを所有しません。`App.csproj` は `backend/mise.local.props` に記録された mise の絶対パスで `mise exec` を実行し、固定版 Node.js を選択します。Visual Studio 起動時の PATH に mise を追加する必要はありません。F5 のたびに npm の依存を再取得する必要はありません。

F5 は `backend/Properties/launchSettings.json` の App プロファイルで `backend/App.csproj` を起動します。App が React をビルドして静的ファイルを配置し、単一の .NET プロセスで UI と API を配信します。固定の URL は `http://127.0.0.1:3000/notes` です。ソリューションの frontend プロジェクトに依存取得や事前の UI ビルドをさせる必要はありません。

コンソール開発は次のコマンドで開始します。依存取得先へ組織のプロキシ経由で接続する場合は、実行前に端末の `HTTPS_PROXY` を設定します。値をリポジトリへ保存せず、TLS 検証を無効化しません。

```powershell
mise run dev
```

`mise run dev` は Vite（`http://127.0.0.1:5173`）と ASP.NET Core（`http://127.0.0.1:3000`）を起動します。Vite は HMR を提供し、`/api`、`/events`、`/health` の要求を ASP.NET Core へプロキシします。画面は `http://127.0.0.1:5173/notes` で開き、実 DB（既定は `data/app.sqlite`）を使用します。ユーザー選択（Alice/Bob）はローカル参照用であり認証ではありません。共有環境では [認証・配備](#deployment) を設定します。

全タスクの入口は mise です。

| タスク | 内容 |
| --- | --- |
| `mise run setup` | 固定ツールの導入、npm 依存、NuGet 依存の復元 |
| `mise run setup:browser` | Playwright の Chromium を導入 |
| `mise run dev` | Vite の HMR と ASP.NET Core を実 DB で起動 |
| `mise run build` | UI をビルドして単一 .NET 配布物へ publish |
| `mise run build:frontend` | React UI だけをビルド |
| `mise run build:backend` | UI ビルドを除外して API だけをビルド |
| `mise run start` | ビルド済みの単一 .NET 配布物を起動 |
| `mise run typecheck` | ルートツリー生成と TypeScript 型検査 |
| `mise run lint` | ESLint による検査 |
| `mise run format` | Prettier による整形 |
| `mise run format:check` | Prettier の整形済み検査 |
| `mise run check:docs` | 参照文書の検査。source では共通の `template/` と拡張側を一時生成先へ配置して検査 |
| `mise run test:frontend` | Vitest の単体テスト |
| `mise run test:backend` | UI ビルドを除外した .NET テスト |
| `mise run test:e2e:dev` | バックエンドだけをビルドし、Vite 開発サーバーで E2E |
| `mise run test:e2e:hosted` | 一体ビルドを行い、単一 .NET 配信で E2E |
| `mise run verify` | 型、Lint、整形、参照文書、単体、バックエンド、dev/hosted E2E。source では文書を一時生成先、アプリの build・test を `reference/` で検査 |
| `mise run package` | `verify` 後に配布物を生成 |
| `mise run db:backup -- <path>` | 実 DB の整合したバックアップを作成 |
| `mise run db:check [-- <path>]` | 指定 DB（省略時は設定済み DB）を検査 |

`mise run build` は Vite で UI をビルドし、`backend/App.csproj` の publish に含めて `dist/server` を生成します。`mise run start` は同じ配布物を `http://127.0.0.1:3000/notes` で起動します。停止は Ctrl+C とします。配布物には Node.js を含めません。

E2E は同じシナリオを開発サーバー形式と配布形式で切り替えて実行します。初回だけ次を実行してください。

```powershell
mise run setup:browser
mise run test:e2e:dev
mise run test:e2e:hosted
```

既定は 4 worker です。テストごとの分離、UI 操作後の DB 確認、同一 DB の競合境界は [並列 E2E](architecture-react-dotnet.md#test-boundary) に従います。両モードとも実 HTTP API と実 DB を使用し、テスト失敗時のアーティファクトは `dist/e2e-results-dev/`・`dist/e2e-results-hosted/` と `dist/playwright-report-dev/`・`dist/playwright-report-hosted/` に配置されます。試験 DB は fixture が自動削除します。実データや診断ログはリポジトリへ含めません。

仕様確認用モックが必要な期間のみ、既存のモック標準に従って作成します。本番ビルドでモックを使用せず、実処理へ切り替えた後は固定データを削除し、E2E は実 HTTP API で検証します。

変更後は `mise run verify` を実行し、型検査、Lint、整形、文書、Vitest、.NET 機能テスト、開発サーバー形式 E2E、配布形式 E2E がすべて合格した状態を維持します。

<a id="deployment"></a>
### 認証・配備

`AUTH_MODE=demo` はローカル参照用の簡易ユーザー選択であり、認証ではありません。

共有サーバー配備時は、配布物の外側に DB を置き、次の環境変数を設定して起動します。

```dotenv
HOST=127.0.0.1
PORT=3000
DB_PATH=../persistent/app.sqlite
AUTH_MODE=proxy
PUBLIC_ORIGIN=https://app.example.com
```

ASP.NET Core サーバーは loopback 限定とします。認証リバースプロキシが全エンドポイントを保護し、クライアントからの `x-authenticated-user` ヘッダーを除去したうえで、検証済みの利用者 ID を付与します。プロキシ側で TLS 終端、SSE バッファリング無効化、適切なタイムアウトを設定します。

配布先で `.env` が自動で読み込まれるとは仮定しません。PowerShell では `$env:HOST='127.0.0.1'` などを設定し、bash では `HOST=127.0.0.1 PORT=3000 DB_PATH=../persistent/app.sqlite AUTH_MODE=proxy PUBLIC_ORIGIN=https://app.example.com dotnet App.dll` のように環境変数を付けて `dotnet App.dll` を起動します。

`mise run package` は `mise run verify` 後に `release/app` を生成し、`dist/server` の内容と `LICENSE` を `release/app` 直下へ配置します。source で実行する場合はリポジトリルートの `LICENSE`、生成先では生成先の `LICENSE` を使用します。配布先には Node.js を配置せず、.NET 10 ASP.NET Core runtime を用意して `dotnet App.dll` を実行します。DB 領域は配布ディレクトリの外側に配置します。

### DB 運用

マイグレーションは `backend/Infrastructure/Persistence/Migrations` に配置し、適用済み SQL は変更しません（現行 `user_version=1`）。

```powershell
mise run db:backup -- ./backups/manual.sqlite
mise run db:check -- ./backups/manual.sqlite
```

上記の mise タスクは、それぞれ `dotnet App.dll db:backup <path>` と `dotnet App.dll db:check <path>` に引数を渡します。バックアップは整合性のあるスナップショットを作成します。復元時はサーバー停止後、既存 DB と WAL/SHM を退避し、チェック済みバックアップを配置して起動します。

## API契約の更新

C# の入出力型を変更したら `mise run contracts` を実行し、生成された `contracts/openapi.json` と `contracts/api.gen.ts` を同じ変更に含めます。生成ファイルは手で編集しません。`mise run contracts:check` は C# から再生成した内容との差分を検出し、ずれていれば失敗します。`mise run verify` も最初にこの検査を行います。

Visual Studio の F5、React ビルド、`mise run dev` は起動前に型を再生成します。`mise run setup` は生成済み契約を書き換えないため、CI でも古い型を検出できます。生成コマンドは UI ビルドを省いた .NET を `dist/contracts/backend` に作り、`App.dll openapi <出力先>` で契約を出力します。HTTP の待受と DB の初期化・接続は行いません。フロントエンド単体テストはコミット済みの型を利用し、.NET 上で動かす必要はありません。
