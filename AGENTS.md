# 開発ガイド

ブラウザで動く野球ゲーム。ゲームの入口は `application/src/main.js` と `application/src/application/vue/`、認証・保存は `application/src/application/firebase/`。

## 開発・検証

- ビルド設定は `application/package.json`・`gulpfile.js`・`webpack.config.js`、配信は `web/` と `docker-compose.yaml`。依存・出力先・接続設定は元の定義を確認する。
- `application/` で `yarn gulp` が開発用のビルド・監視、`yarn gulp:build` が本番用のlint・バンドル・スタイル生成。JavaScriptのバンドルだけなら `yarn webpack:build`。変更した部分に必要なビルドとブラウザ確認を行う。
- アプリやビルド設定を変更した場合は、Node 24で `yarn gulp:build` の後に `yarn test` を実行する。テスト対象は得点境界・乱数・当たり判定・配信と、Firebase認証・ランキング・保存の契約。lintエラーも失敗として扱う。Dart Sass・webpack-dev-server・Firebase modular APIを維持する。開発サーバーの設定は `dev-server.cjs` を確認する。
- `application/.env` の値・認証情報をログや文書に転記しない。
- テスト・動作確認では実Firebaseに接続しない。認証・Firestoreの読み取り・書き込みはモックまたはローカルのFirebase Emulatorで検証する。ブラウザ確認も同様とし、localhostであっても実Firebaseに接続するビルドは使わない。実行前に接続先と通信の分離を確認する。
- ブラウザ確認用には `application/` で `yarn test:browser:build` を実行し、生成された `.test-browser/` をローカルで配信する。Firebaseをメモリ内のモックに置き換えるため、実際の認証・権限・インデックスの検証にはならない。この生成物はデプロイしない。
- デプロイ後は静的ファイルの配信・整合性を確認する。本番画面の表示による自動取得を含め、実Firebaseへの接続を伴う確認は行わず、未確認の範囲を報告する。利用枠の回復確認を目的とする定期的な読み取りやリトライも行わない。
- Firebaseは無料のSparkプランを維持し、Blazeへの変更や課金の有効化を行わない。無料枠超過は読み取り・書き込みの削減と枠の回復で対処する。実接続テストや課金変更は、ユーザーがその操作を改めて明示的に許可した場合に限る。一般的な動作確認・デプロイ・リリースの依頼を許可と解釈しない。
- ソースを編集し、`dist/`・`publish/` の生成物を直接修正しない。Composeは配信用で、アプリの依存インストールやビルドの代わりにはならない。

## 作業の進め方

- 関連箇所・資料・skillsに絞って読み、根拠が足りなければ調査範囲を広げる。
- 判断に必要な不明点は既存資料で確認し、解消できなければ依存する作業の前に質問する。合意済み事項は再確認しない。
- 文書の言語を保ち、日本語は日本人に、英語は英語圏の読者に自然に伝わる表現にする。
- 該当する必須検証を行い、問題を修正する。差分・依存・設定・実行条件が同じなら結果を再利用し、結果と未確認事項を簡潔に報告する。
- 継続する規約と参照先だけを残し、進捗・設定値・他の資料やskillsの手順は複製しない。
