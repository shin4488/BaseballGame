# 開発ガイド

ブラウザで動く野球ゲーム。ゲームの入口は `application/src/main.js` と `application/src/application/vue/`、認証・保存は `application/src/application/firebase/`。機能を変えるときは [機能メモ](application/document/features.md)の関連箇所も確認する。

## 開発・検証

- ビルド設定は `application/package.json`・`gulpfile.js`・`webpack.config.js`、配信は `web/` と `docker-compose.yaml`。依存・出力先・接続設定は元の定義を確認する。
- `application/` で `yarn gulp` が開発用のビルド・監視、`yarn gulp:build` が本番用のlint・バンドル・スタイル生成。JavaScriptのバンドルだけなら `yarn webpack:build`。変更した部分に必要なビルドとブラウザ確認を行う。
- Node 24で `yarn gulp:build` の後に `yarn test` を実行する。テストは得点の境界値・乱数・当たり判定・配信ファイルを確認する。lintエラーはビルド失敗として扱う。スタイル生成には公式Dart Sassを使う。
- `application/.env` の値・認証情報をログや文書に転記しない。Firebaseの認証・保存を伴う確認では接続先と書込対象を確認し、実データへの操作を単なるビルド確認に含めない。
- ソースを編集し、`dist/`・`publish/` の生成物を直接修正しない。Composeは配信用で、アプリの依存インストールやビルドの代わりにはならない。

## 調査と指示の保守

- `AGENTS.md` は `CLAUDE.md` への相対リンク。本文は一度読み、実体を編集する。
- `rg` は対象ディレクトリから名前・見出し・シンボルを探す。通常は `-g` で依存・成果物・ログ・ロックファイル・生成コードを除外し、依存・生成・型・障害の調査では直接読む。見つからなければ範囲・除外を見直す。
- 必須検証を行い、要点・失敗箇所を報告する。同じ差分・依存・設定・実行条件の結果は再利用する。
- ここは恒久規約・必須条件・主要コマンド・参照先に限る。進捗はチャット・既存Issue/PR、機能・構成・依存・設定等の現在値は元の定義へ。規約・条件・参照先の変更や継続して必要な判断基準の追加時に更新する。
- スキルは説明から選び、該当 `SKILL.md` に従う。一覧・手順は転記せず、このガイドの必須適用条件は守る。
