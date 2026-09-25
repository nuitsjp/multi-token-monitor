# React / ASP.NET Core アーキテクチャ

[全体構成](architecture.md)の技術固有の判断を記録します。ユースケースの振る舞いは各 UC、実現パターンは `design/UCP-n.md`、テーブルと値の制約は[データ設計](design/data.md)を正本とします。

本書の実装パスは `reference/` を起点とします。製品の現行設計は生成先ルートの `docs/` で管理します。

## 1. 実行単位と責務

運用時と Visual Studio の F5 では `backend/App.csproj` が React をビルド・配置し、UI と API を単一の .NET プロセスから同じ origin で配信します。コンソール開発では `mise run dev` が Vite と .NET を別々に起動し、Vite が API と SSE をプロキシします。どちらも実 SQLite を使用します。`frontend/Frontend.esproj` は Visual Studio のソリューション表示用で、UI ビルドは所有しません。

フロントエンドの `frontend/src/` は次の責務に分け、依存方向を `eslint.config.mjs` の `no-restricted-imports` で検査します。

| ディレクトリ | 責務 | 参照しないもの |
| --- | --- | --- |
| `app/` | 起動、ルーター生成、共通レイアウト（Shell） | — |
| `routes/` | TanStack Router のファイルルート。画面の割当てと Query の先読み（`loader`） | — |
| `usecases/` | ユースケースの対話、下書き、確認・失敗時の表示 | `features/client`、バックエンド |
| `features/` | API 呼び出し、Query・mutation、変更通知の購読 | `usecases/`、`routes/` |
| `shared/` | 機能に依存しない共用 UI と下書き管理 | `features/`、`usecases/` |

バックエンドは画面単位ではなく API エンドポイント単位で `backend/Features/Notes/` にファイルを分けます。画面やユースケースと API は 1:1 に対応させません。

## 2. API 単位の実装

各 API ファイルにはルート登録の `Map` と、責務を明示する内部 `PresentationLayer`、`ApplicationLayer` を置きます。API 専用の SQL は、1関数が1つの SQL を実行する static `PersistenceLayer` に置きます。複数の API が共有する単件取得・INSERT・DB エラー変換は同じ機能の `Features/Notes/NotePersistence.cs` に置き、各 `ApplicationLayer` から直接呼びます。`ApplicationLayer` は共通の `IApplicationLayer<TRequest, TResult>` を実装し、トランザクションと業務判断を担当します。`PresentationLayer` は公開応答への変換を担当します。DB を使わない `PreviewNotes` に永続化レイヤーは置きません。

`Database` は起動時に生成して必要な `ApplicationLayer` に渡し、static `PersistenceLayer` には状態を持たせません。API 専用の入出力型は担当ファイルに置き、プレビューと一括登録が共有する `BulkInput` だけを独立させます。一括登録はプレビューのアプリケーション処理を再利用し、確認時と確定時に同じ内容を検証します。

API 間で共有する DataAnnotations 属性は `backend/Presentation/Http/Validation/` に1クラス1ファイルで置きます。現在の対象は `NoteTitleAttribute`、`NoteBodyAttribute`、`UuidAttribute` です。タイトルと本文の属性は `Domain/Notes/NoteRules` の判定を呼び、単票保存と一括登録で同じ規則を使います。認証、永続化、通知などの共通処理は、それぞれ `Infrastructure/Authentication/`、`Infrastructure/Persistence/`、`Infrastructure/Notifications/` に置きます。

## 3. HTTP 契約と状態

C# の API 入出力型を契約の正本とし、OpenAPI から `contracts/api.gen.ts` を生成します。React は `contracts/notes.ts` の別名を `@contracts/notes.ts` として import し、生成型を使います。保存と削除の入力は DataAnnotations で自動検証し、フィールド別のエラーを標準の Validation Problem Details で返します。保存入力の項目間条件は `IValidatableObject` で定義し、タイトルは前後の空白を除いた文字数で検証し、トリムは検証後の保存処理で行います。

| HTTP | パス | このアプリでの役割 |
| --- | --- | --- |
| GET | `/api/notes`、`/api/notes/{id}` | 利用者のメモの一覧・単件取得 |
| POST | `/api/notes/save`、`/api/notes/remove` | 版を検査した保存・削除 |
| POST | `/api/notes/preview`、`/api/notes/import` | 一括入力の確認・確定 |
| GET | `/api/session`、`/events/notes` | セッション取得・変更通知 |
| POST | `/api/demo/sign-in`、`/api/demo/sign-out` | ローカル参照用の利用者切替 |

属性検証が必要な保存・削除 POST は、入力型を明示した `MapPost` ハンドラーで登録します。このテンプレートでは汎用 `MapAuthenticatedPost<TRequest>` 経由の削除入力に属性検証が適用されず、不正な UUID が 404 になったためです。認証が必要な API は `IdentityService.RequireAsync` で利用者を確認し、結果は文字列 ID ではなく `Principal` としてアプリケーションレイヤーへ渡します。

公開エラーは HTTP ステータスと標準の Problem Details で表し、独自の FaultCode を応答に含めません。保存・削除の対象なしと版競合はアプリケーションの結果型で表し、プレゼンテーションで 404・409 に変換します。確定後にだけ `ChangeNotifications` が利用者のタブへ変更を通知し、購読側の失敗で確定済みの操作を失敗扱いにはしません。下書きは React が保持し、再取得や保存失敗で上書きしません。

サーバー状態は TanStack Query が保持し、鮮度は確定後の再取得と SSE 通知で保ちます。このため時間経過・フォーカス復帰・再接続による自動再取得と自動リトライは行いません。Query のキーと取得関数は `features/` の `queryOptions` に定義し、フックは `useQueryClient` でクライアントを取得します。ルートの `loader` は同じ `queryOptions` で先読みし、失敗の表示は画面側の Query に任せます。mutation は `mutate` の `onSuccess` で画面の状態を進め、失敗は mutation の `error` として表示します。入力検証のエラーは `errors` の項目名に対応する入力欄の下に、それ以外は操作単位の通知に表示します。

`Program` はエントリポイントに留め、`Hosting/AppHost` は起動モードの選択と各領域の組み立てだけを担当します。サーバー設定と DB 管理コマンドは `Infrastructure/`、HTTP サービス設定・エンドポイント登録・SPA 配信・エラー変換・接続先と Origin の検査は `Presentation/Http/` に置きます。OpenAPI 生成も通常起動と同じエンドポイント登録を使いますが、DB 初期化と HTTP 待受は行いません。HTTP エラー変換と接続先検査、SPA の 404 応答は共通の `ProblemResponses` を使います。

<a id="persistence"></a>
## 4. 永続化

`Database` が DB パスと接続の生成を管理し、`ApplicationLayer` が `BeginTransactionAsync` で `ITransaction` を取得して確定します。トランザクションは `IMMEDIATE` で開始します。SQL は API 専用ならそのファイルの `PersistenceLayer`、同じ機能の API 間で共有するならその機能のディレクトリに置き、Dapper で実行します。

永続化基盤の `Database`、`ITransaction`、`DatabaseTransaction`、`DatabaseCheck` はそれぞれ独立したファイルに置きます。

接続だけが必要な処理は `Database.OpenAsync()` の戻り値を呼び出し側で `await using` し、トランザクションは `BeginTransactionAsync()` の戻り値を `await using` します。DB初期化・利用者更新・整合性検査も非同期メソッドを使います。接続やトランザクションの操作を `Func` に渡すラッパーは置きません。SQLiteバックアップは提供される `BackupDatabase` が同期操作のため、管理コマンドで同期実行します。

C# 内の SQL が1行なら `"BEGIN IMMEDIATE;"` のような通常の文字列、2行以上なら改行した raw string (`"""` ... `"""`) で記述します。

新規メモの ID と更新日時は永続化レイヤーが発行し、日時には SQLite の UTC 時刻を使います。INSERT・UPDATE は `RETURNING` で保存後の `Note` を返し、保存後の読み直しを行いません。書込みは利用者の確認待ちを含まない短いトランザクションで確定します。

<a id="test-boundary"></a>
## 5. テストの分担と並列実行

.NET の単体テストは `tests/dotnet-unit/` に対象クラスの名前空間に沿って配置し、機能間で共有するクラスを対象に1クラスにつき1テストクラスを作ります。単一メンバーのテストはメンバー名の内部クラスに、メンバー間の連携テストはテストクラス直下に置きます。関数実行後のプロパティ確認は連携テストに含めません。各テストケースは Arrange・Act・Assert のコメントで区切ります。

.NET の統合テストは `tests/dotnet-integration/` に API 担当クラスごとに置き、必要なレイヤーを横断する振る舞いを確認します。DB を使うテストケースはそれぞれ専用の一時 SQLite ファイルで `Database` を作り、並列実行時の干渉を防ぎます。

React の単体テストは `tests/frontend-unit/` に `frontend/src/` と同じ相対パスで配置し、機能間で共有するモジュール（`shared/`、`features/client.ts`）を対象に1モジュールにつき1テストファイルを作ります。単一メンバーのテストはメンバー名の `describe` に、メンバー間の連携テストとコンポーネントのテストはファイル直下に置き、各テストケースは Arrange・Act・Assert のコメントで区切ります。ユースケース固有の画面と API 呼び出しは E2E で確認します。

シナリオの E2E は `docs/usecases/` と同じ名称で `tests/e2e/usecases/<ユースケース名>/<シナリオ名>.spec.ts` に1シナリオにつき1テストファイルを作り、そのシナリオの受け入れ条件とユースケースの共通の受け入れ条件を検証します。シナリオ以外の E2E は、HTTP 契約を `tests/e2e/http/`、並列実行時の分離を `tests/e2e/isolation/` に置きます。各テストケースは Arrange・Act・Assert のコメントで区切ります。E2E は Vite と .NET を分離する `dev`、UI を .NET に同梱する `hosted` の両方で同じシナリオを実行します。各テストは .NET プロセスと一時 SQLite ファイルを分離し、UI 操作後は別接続から確定済みデータを確認します。HTTP 契約テストは両モードとも .NET に直接接続します。同一 DB の競合は一つのテスト内で複数の対話を動かして確認します。

<a id="deployment"></a>
## 6. 配備・認証

`mise run package` は UI を含む .NET 配布物を作り、DB 領域は配布物から分離します。配布先に Node.js は不要です。`AUTH_MODE=demo` はローカル参照用であり、共有環境では既存の認証プロキシと HTTPS を使い、検証済みの利用者 ID のみをサーバーに渡します。
