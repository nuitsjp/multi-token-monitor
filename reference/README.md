# メモアプリの参照実装

React の対話制御から ASP.NET Core の HTTP API、SQLite への確定までを示すサンプルです。C# 名前空間は `NotesSample` です。UI と API を単一の .NET プロセスで配信する構成と、開発時に Vite を分離する構成を含みます。製品開発を開始しても、このディレクトリを参照用として残します。

環境構築と検証はこのディレクトリで `mise trust`、`mise run setup`、`mise run setup:browser`、`mise run verify` を実行します。ここにある `mise.toml` はサンプル専用です。`mise run dev` は Vite と .NET を起動し、`mise run build` と `mise run start` は UI を同梱した .NET サーバーを使用します。Visual Studio では [App.slnx](App.slnx) を開き、`backend/App.csproj` をスタートアッププロジェクトにします。詳細なタスクと配備手順は[プロジェクト定義](docs/project.md#commands)を参照してください。

この参照実装の仕様は[ユースケース一覧](docs/project.md#usecases)、[全体構成](docs/architecture.md)、[React・.NET 固有設計](docs/architecture-react-dotnet.md)、[実現パターン](docs/design/UCP-1.md)、[データ設計](docs/design/data.md)に記録します。生成時にはこの実装を製品ルートにもコピーし、製品側だけ名前空間、ソリューション・プロジェクト・アセンブリ名を指定した製品名に合わせます。この `reference/` の `App.slnx`、`backend/App.csproj`、`frontend/Frontend.esproj`、`tests/dotnet-unit/Backend.UnitTests.csproj`、`tests/dotnet-integration/Backend.IntegrationTests.csproj` は元の名前で残します。製品の仕様・設計は親ディレクトリの `docs/` で管理し、ここにあるメモの仕様を承認済みの製品仕様とは扱いません。
