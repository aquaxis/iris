# iris2sv

IRIS to SystemVerilog トランスパイラ

## 概要

iris2svは、IRIS言語で記述されたソースコードをSystemVerilogコードに変換するトランスパイラです。

## 特徴

- IRISのRustライクな構文からSystemVerilogへの変換
- 型安全な変換処理
- 詳細なエラーメッセージ
- モジュール、FSM、インターフェースなどの完全サポート
- テストベンチ構文（`test mod`、`seq`ブロック）のサポート（開発中）
- 外部Rust関数連携（`use rust::`、`extern rust`）のサポート（開発中）

## パッケージ構成

| パッケージ | 説明 |
|-----------|------|
| `@iris2sv/core` | Lexer、Parser、AST、HIR |
| `@iris2sv/analyzer` | シンボルテーブル、型チェッカー |
| `@iris2sv/transform` | IRIS→SystemVerilog変換 |
| `@iris2sv/sv-backend` | SystemVerilog AST、コード生成 |
| `@iris2sv/cli` | コマンドラインツール |

## 開発環境のセットアップ

### 必要条件

- Node.js 18以上
- pnpm 9.x

### インストール

```bash
pnpm install
```

### ビルド

```bash
pnpm build
```

### テスト

```bash
pnpm test
```

### リント

```bash
pnpm lint
```

### グローバルインストール（オプション）

CLIをグローバルに利用可能にするには、ビルド後に以下を実行します：

```bash
# pnpmのグローバル設定（初回のみ）
pnpm setup
source ~/.bashrc  # または ~/.zshrc

# CLIをグローバルにリンク
cd packages/cli
pnpm link --global
```

これにより`iris2sv`コマンドがシステム全体で利用可能になります。

**代替方法**: グローバルインストールなしで実行する場合：

```bash
# プロジェクトルートから
node packages/cli/dist/cli.js <INPUT>
```

## 使用方法

```bash
iris2sv [OPTIONS] <INPUT>...

Arguments:
  <INPUT>...  入力ファイルまたはディレクトリ

Options:
  -o, --output <DIR>  出力ディレクトリ（デフォルト: ./output）
  -w, --watch         ファイル変更の監視モード
  --verbose           詳細なログ出力
  -h, --help          ヘルプの表示
  -V, --version       バージョンの表示
```

## 技術スタック

- TypeScript
- ESM (ES Modules)
- Vitest (テスト)
- ESLint v9 (Flat Config)
- Prettier

## 関連ツール

iris2svはIRIS言語ツールチェーンの一部です：

- **[irisfmt](../irisfmt/)** - IRIS言語のフォーマッター・リンターツールチェーン
- **[sv2iris](../sv2iris/)** - SystemVerilogからIRIS言語へのトランスパイラ

### 典型的なワークフロー

```bash
# 1. IRISコードを作成・編集後、フォーマット
irisfmt-format --write counter.iris

# 2. リントでコード品質をチェック
irisfmt-lint counter.iris

# 3. IRISからSystemVerilogに変換
iris2sv counter.iris -o output/
```

## ライセンス

MIT
