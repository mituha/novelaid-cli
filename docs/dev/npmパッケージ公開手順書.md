# npm パッケージ公開手順書

本書は、小説執筆補助CLIツール `novelaid-cli` を公式 npm レジストリ（https://www.npmjs.com/）へ一般公開するための準備、設定要件、検証手順、および公開後の運用ガイドをまとめた開発仕様書です。

---

## 1. 目的と概要

* **目的**:
  * 世界中の作家やユーザーが `npm install -g novelaid-cli` または `npx novelaid-cli` だけで即座に `novelaid-cli` を利用できるようにする。
* **基本方針**:
  * ソースコード（TypeScript）、内部開発ドキュメント（`docs/`）、日次ログやメイキング記事（`making/`）などの開発資源を配布物に混入させず、**実行に必要な最小限の成果物（`bin/`, `dist/`）のみを軽量・安全に公開**する。
  * 公開前のドライラン検証と、ビルド忘れを物理的に防止するライフサイクルフックを導入する。

---

## 2. アカウントと認証の要件

### 2.1 パッケージ名の確認状況
2026年10月時点の調査により、以下のパッケージ名はいずれも npm レジストリ上で誰にも取得されておらず、**即座に登録可能**であることが確認されています。

* `novelaid-cli`（現在採用中）: 空きあり（利用可能）
* `novelaid`: 空きあり（利用可能）

### 2.2 npm アカウントの準備
1. **アカウント作成**:
   - [npmjs.com](https://www.npmjs.com/signup) にてアカウントを作成。
2. **メールアドレス認証（必須）**:
   - 登録後、認証メール内のリンクをクリックして確認を完了してください（未認証状態では `npm publish` が `403 Forbidden` で拒否されます）。
3. **二要素認証（2FA / Two-Factor Authentication）の設定（必須推奨）**:
   - npm では現在、パッケージを公開するアカウントに対して 2FA（認証アプリによるワンタイムパスワード）の設定が強く要求されます。
   - Account Settings ➔ Two-Factor Authentication から設定を有効化します。

### 2.3 ターミナルでのログイン認証
CLIから公開作業を行うため、以下のコマンドでログインします。

```powershell
# ログイン（ブラウザまたはワンタイムパスワード入力）
npm login

# ログイン状態の確認（ログイン中のユーザー名が表示されればOK）
npm whoami
```

---

## 3. `package.json` の設定仕様

### 3.1 【最重要】同梱ファイル制御（`files` フィールド）の落とし穴と解決策
npm は、プロジェクトルートに `.npmignore` が存在しない場合、**フォールバックとして `.gitignore` を参照**して同梱ファイルを除外します。

この挙動により、以下の重大な問題が発生します。
* `.gitignore` に `dist/` が記載されているため、**肝心の実行ファイル（コンパイル済みJavaScript）が配布物から除外されてしまう**（インストール先で `MODULE_NOT_FOUND` が発生）。
* `.gitignore` に記載されていない `docs/`, `making/`, `src/`, `.agents/` などの内部ファイルが**すべて外部に丸見えで配布されてしまう**。

#### 解決策
`package.json` に明示的な **`files` ホワイトリスト** を指定します。
`files` に指定されたディレクトリは、`.gitignore` の除外設定をオーバーライドして確実にパッケージに同梱され、それ以外の不要なファイルはすべて自動的に除外されます。

```json
{
  "files": [
    "bin",
    "dist"
  ]
}
```
※ `README.md` および `package.json` は `files` の指定に関わらず自動的に同梱されます。

### 3.2 ビルド忘れ防止（`prepublishOnly` フック）
TypeScript プロジェクトにおいて最も起こりやすい事故は、「ソースコードを変更したのに `npm run build` を忘れたまま公開し、古いコードが配信されてしまう」ことです。

これを防止するため、npm のライフサイクルスクリプト **`prepublishOnly`** を導入します。

```json
{
  "scripts": {
    "dev": "tsx src/cli.ts",
    "build": "tsc",
    "prepublishOnly": "npm run build",
    "start": "node dist/cli.js"
  }
}
```
これにより、`npm publish` を実行した瞬間に npm が自動で `npm run build` を実行し、最新のコンパイル済み成果物（`dist/`）を生成してからパッケージ化が行われます。

### 3.3 推奨メタデータの追加

```json
{
  "name": "novelaid-cli",
  "version": "0.1.0",
  "description": "Novel writing assistant powered by Pi Coding Agent SDK",
  "type": "module",
  "bin": {
    "novelaid": "./bin/novelaid.js"
  },
  "files": [
    "bin",
    "dist"
  ],
  "engines": {
    "node": ">=18.0.0"
  },
  "scripts": {
    "dev": "tsx src/cli.ts",
    "build": "tsc",
    "prepublishOnly": "npm run build",
    "start": "node dist/cli.js"
  },
  "keywords": [
    "novel",
    "assistant",
    "ai",
    "agent",
    "cli",
    "writing",
    "tui"
  ],
  "author": "Mizuki Mituha",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/mituha/novelaid-cli.git"
  },
  "homepage": "https://github.com/mituha/novelaid-cli",
  "bugs": {
    "url": "https://github.com/mituha/novelaid-cli/issues"
  }
}
```

---

## 4. 公開前検証（ドライラン）手順

いきなり公開するのではなく、必ずローカルで中身と動作を検証します。

### 手順 1: ドライランによる同梱ファイルチェック
実際に tarball に含まれるファイル一覧とサイズをシミュレーション確認します。

```powershell
npm pack --dry-run
```
* **確認チェックリスト**:
  - [ ] `dist/` 配下の `.js` ファイルが含まれているか。
  - [ ] `bin/novelaid.js` が含まれているか。
  - [ ] `docs/`, `making/`, `src/`, `.agents/` が**除外されているか**。

### 手順 2: ローカル tarball 生成とインストールテスト
実際のアーカイブファイルを生成し、ローカルでインストール・起動テストを行います。

```powershell
# 1. パッケージ tarball（.tgz）を作成
npm pack

# 2. 生成された .tgz をグローバルインストール（または npx で直接実行）
npx ./novelaid-cli-0.1.0.tgz --test
# または
npm install -g ./novelaid-cli-0.1.0.tgz
novelaid --version

# 3. テスト完了後に .tgz を削除
Remove-Item novelaid-cli-0.1.0.tgz
```

---

## 5. 公開手順（`npm publish`）

### 5.1 初回公開
準備が整ったら、以下のコマンドで npm レジストリへ公開します。

```powershell
npm publish
```
※もし将来的に組織やユーザーのスコープ付きパッケージ（例: `@username/novelaid-cli`）として公開する場合は、デフォルトが非公開（private）となるため、`--access public` オプションが必要です。
```powershell
npm publish --access public
```

### 5.2 公開後の確認
ブラウザで以下のURLを開き、ページが正常に生成されていることを確認します。
* `https://www.npmjs.com/package/novelaid-cli`

一般ユーザー環境からのテスト：
```powershell
npx novelaid-cli
```

---

## 6. 公開後の運用とバージョン管理

### 6.1 バージョン上書き禁止ルール（不変性）
npm レジストリでは、**一度公開したバージョン番号（例: 0.1.0）のファイルを上書きして再公開することはできません**（`403 Forbidden` になります）。
バグ修正や機能追加を行った場合は、必ずセマンティックバージョニングに従ってバージョン番号を繰り上げます。

### 6.2 バージョンアップコマンド
```powershell
# パッチ更新（バグ修正など: 0.1.0 -> 0.1.1）
npm version patch

# マイナー更新（新機能追加: 0.1.1 -> 0.2.0）
npm version minor

# メジャー更新（破壊的変更: 0.2.0 -> 1.0.0）
npm version major

# 新バージョンを公開
npm publish
```
※ `npm version` コマンドを実行すると、`package.json` の更新と同時に Git のコミットおよびタグ（`v0.1.1` 等）が自動生成されます。
