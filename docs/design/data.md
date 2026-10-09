# データ設計

保存形式と、論理型からSQLite型への対応の正本です。テーブル構造と責務・値の規則は [DBML](data.dbml) に記載します。変更範囲と論点は [設計標準](../standards/design-and-documentation.md#architecture-method) に従って会話で提示します。

## 保存形式と型の対応

ローカルDBはSQLiteで、保存先は `.env` の `DB_PATH` に従います。全テーブルを `STRICT` とし、DBMLの論理型を次のSQLite型へ対応させます。

| DBMLの論理型 | SQLite型 | 保存形式 |
| --- | --- | --- |
| text | TEXT | 文字列 |
| integer | INTEGER | 整数の件数・トークン数 |
| boolean | INTEGER | 真は1、偽は0 |
| float | REAL | 推定コスト・百分率・枠の長さの浮動小数点数 |
| date | TEXT | `YYYY-MM-DD`。日付の由来と時刻帯の扱いはDBMLの各カラムのNoteに従う |
| timestamp | TEXT | ISO 8601の日時。ローカルで記録する受信時刻はUTC、Hubが報告した日時は受信値を保存する |
| json | TEXT | JSON文字列 |

Hubから受信したstats全体は受信データとして `hub_states` にそのまま保存し、同じトランザクションで本システムのドメインモデル（Hub・端末・トークン利用実績・日別の集計・端末別の日次モデル明細・アカウント・利用枠）へ変換して保存します。閲覧はドメインモデルのテーブルだけを読み、受信データの形式に依存しません。

Hubの認証トークンは登録情報として `hubs` に平文で保存します。DBファイルはローカルの利用者だけが読める場所に置く前提で、暗号化はしません。

保存と変換の手順は [UCP-1](UCP-1.md)、Hubの登録は [UCP-4](UCP-4.md) に従います。
