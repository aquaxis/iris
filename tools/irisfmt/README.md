# irisfmt

IRIS言語のためのフォーマッター・リンターツールチェーン

## 概要

irisfmtは、IRIS言語のソースコードを解析・整形・検証するためのツールセットです。以下のツールで構成されています：

- **irisfmt-syntax** - 構文解析ツール（ASTをJSON形式で出力）
- **irisfmt-format** - コードフォーマッター
- **irisfmt-lint** - スタイルリンター
- **irisfmt-ls** - Language Server（エディタ統合）

## 前提条件

- Node.js 18以上
- pnpm 9.x

## インストール

### CLIツールのインストール（グローバル）

ソースからビルドしてCLIツールをグローバルにインストールする方法：

```bash
# リポジトリをクローン後、依存関係をインストール
cd irisfmt
pnpm install
pnpm build

# pnpmのグローバル設定（初回のみ）
pnpm setup
source ~/.bashrc  # または ~/.zshrc

# 各CLIツールをグローバルにリンク
cd packages/format && pnpm link --global
cd ../lint && pnpm link --global
cd ../syntax && pnpm link --global
```

これにより以下のコマンドが利用可能になります：
- `irisfmt-format` - コードフォーマッター
- `irisfmt-lint` - スタイルリンター
- `irisfmt-syntax` - 構文解析ツール

### パッケージとしてインストール

```bash
# pnpmを使用
pnpm add @irisfmt/format @irisfmt/lint

# npmを使用
npm install @irisfmt/format @irisfmt/lint
```

## クイックスタート

### コードのフォーマット

```bash
# ファイルをフォーマットして標準出力に表示
npx irisfmt-format src/counter.iris

# ファイルを上書き保存
npx irisfmt-format --write src/counter.iris

# フォーマットが必要かチェック（CI用）
npx irisfmt-format --check src/**/*.iris
```

### コードのリント

```bash
# ファイルをリント
npx irisfmt-lint src/counter.iris

# 複数ファイルをリント
npx irisfmt-lint "src/**/*.iris"

# 自動修正を適用
npx irisfmt-lint --fix src/counter.iris
```

## ツール詳細

### irisfmt-format

IRISソースコードを一貫したスタイルに整形します。

```bash
irisfmt-format [options] <files...>

オプション:
  --write, -w     ファイルを上書き保存
  --check, -c     フォーマットが必要かチェック（差分があれば終了コード1）
  --config <path> 設定ファイルのパス
  --help, -h      ヘルプを表示
```

#### 使用例

```bash
# 単一ファイルをフォーマット
irisfmt-format src/counter.iris

# globパターンで複数ファイルをフォーマット
irisfmt-format "src/**/*.iris" --write

# 設定ファイルを指定
irisfmt-format --config .irisfmtrc.json src/counter.iris
```

### irisfmt-lint

IRISソースコードのスタイルと潜在的な問題を検出します。

```bash
irisfmt-lint [options] <files...>

オプション:
  --fix           自動修正を適用
  --config <path> 設定ファイルのパス
  --help, -h      ヘルプを表示
```

#### 使用例

```bash
# 単一ファイルをリント
irisfmt-lint src/counter.iris

# globパターンで複数ファイルをリント
irisfmt-lint "src/**/*.iris"

# 自動修正を適用
irisfmt-lint --fix src/counter.iris
```

### irisfmt-syntax

IRISソースコードを解析し、AST（抽象構文木）をJSON形式で出力します。

```bash
irisfmt-syntax [options] <file>

オプション:
  --pretty, -p    整形されたJSONを出力
  --help, -h      ヘルプを表示
```

#### 使用例

```bash
# ASTをJSON形式で出力
irisfmt-syntax src/counter.iris

# 整形されたJSONを出力
irisfmt-syntax --pretty src/counter.iris

# 出力例
irisfmt-syntax --pretty src/counter.iris
```

出力例：

```json
{
  "type": "Module",
  "name": "counter",
  "ports": [
    { "name": "clk", "direction": "in", "type": "clock" },
    { "name": "count", "direction": "out", "type": { "bit": 8 } }
  ],
  "body": [...]
}
```

### irisfmt-ls

Language Server Protocol (LSP) を実装した言語サーバーです。エディタ内でリアルタイムの診断、フォーマット、クイックフィックスを提供します。

#### サポート機能

| 機能 | 説明 |
|------|------|
| diagnostics | リントエラー・警告のリアルタイム表示 |
| formatting | ドキュメント全体のフォーマット |
| rangeFormatting | 選択範囲のフォーマット |
| codeAction | クイックフィックス（自動修正） |
| hover | キーワードのドキュメント表示 |
| completion | コンテキスト依存のキーワード・型補完 |

#### VSCode拡張機能のインストール

ソースからVSCode拡張機能をビルドしてインストールする方法：

```bash
# 拡張機能をビルド
cd packages/vscode-iris
pnpm install
pnpm package  # .vsixファイルを生成

# VSCodeにインストール
code --install-extension vscode-iris-*.vsix
```

または、VSCodeの拡張機能パネルから「VSIX からインストール」を選択してインストールすることもできます。

#### VSCodeでの設定

`.vscode/settings.json`:

```json
{
  "[iris]": {
    "editor.formatOnSave": true,
    "editor.defaultFormatter": "irisfmt.irisfmt-ls"
  }
}
```

## 設定ファイル

プロジェクトルートに `.irisfmtrc.json` を配置して設定をカスタマイズできます。

```json
{
  "format": {
    "indentSize": 2,
    "maxLineWidth": 100,
    "indentStyle": "space"
  },
  "lint": {
    "rules": {
      "naming-convention": "warning",
      "unused-variable": "error",
      "unused-signal": "warning",
      "unused-import": "warning",
      "no-empty-block": "warning",
      "import-order": "warning",
      "duplicate-import": "error"
    }
  }
}
```

詳細は[設定リファレンス](docs/configuration.md)を参照してください。

## リントルール

| ルール | デフォルト | 説明 |
|--------|-----------|------|
| `naming-convention` | warning | 命名規則のチェック |
| `unused-variable` | warning | 未使用変数の検出 |
| `unused-signal` | warning | 未使用シグナルの検出 |
| `unused-import` | warning | 未使用インポートの検出 |
| `no-empty-block` | warning | 空ブロックの検出 |
| `var-context-restriction` | error | var文の使用制限 |
| `import-order` | warning | インポート順序のチェック |
| `duplicate-import` | warning | 重複インポートの検出 |
| `dead-code` | warning | デッドコードの検出 |
| `complexity` | warning | 関数の複雑度チェック |
| `seq-outside-test` | error | seqブロックのtestモジュール外での使用（開発中） |

詳細は[リントルールリファレンス](docs/lint-rules.md)を参照してください。

## 開発中の機能

以下の新しい言語機能のサポートを開発中です：

| 機能 | 説明 | 状態 |
|------|------|------|
| `seq`ブロック | テストモジュール内でのシーケンシャル処理 | 基盤実装済 |
| `initial`ブロック | シミュレーション専用の初期化ブロック | 基盤実装済 |
| `use rust::`宣言 | 外部Rust関数のインポート | 基盤実装済 |
| `extern rust`ブロック | 外部Rust関数の明示的宣言 | 基盤実装済 |
| `await`構文 | 時間制御・非同期待機 | 基盤実装済 |
| `#delay`構文 | 遅延構文 | 基盤実装済 |

## プログラムからの使用

### フォーマット

```typescript
import { format } from '@irisfmt/format';

const source = `
mod Counter(in clk:clock,out count:bit<8>){
var counter:bit<8>=0;
}
`;

const formatted = format(source);
console.log(formatted);
// 出力:
// mod Counter(in clk: clock, out count: bit<8>) {
//   var counter: bit<8> = 0;
// }
```

### リント

```typescript
import { lint } from '@irisfmt/lint';

const source = `
mod Counter(in clk: clock) {
  let unused: bit<8> = 0;
}
`;

const result = lint(source);
for (const diag of result.diagnostics) {
  console.log(`${diag.severity}: ${diag.message}`);
}
// 出力: warning: Unused signal 'unused'
```

### 設定付きリント

```typescript
import { lint } from '@irisfmt/lint';

const result = lint(source, {
  rules: {
    'unused-signal': 'error',  // 重大度を変更
    'naming-convention': 'off' // ルールを無効化
  }
});
```

## 開発

### セットアップ

```bash
pnpm install
pnpm build
```

### 利用可能なコマンド

| コマンド | 説明 |
|----------|------|
| `pnpm build` | TypeScriptをコンパイル |
| `pnpm test` | テストを実行 |
| `pnpm lint` | ESLintでコードをチェック |
| `pnpm format` | Prettierでコードを整形 |

## 技術スタック

- TypeScript
- ESM (ES Modules)
- Vitest (テスト)
- ESLint v9 (Flat Config)
- Prettier

## 関連ツール

irisfmtはIRIS言語ツールチェーンの一部です：

- **[iris2sv](../iris2sv/)** - IRIS言語からSystemVerilogへのトランスパイラ
- **[sv2iris](../sv2iris/)** - SystemVerilogからIRIS言語へのトランスパイラ

### 典型的なワークフロー

```bash
# 1. SystemVerilogからIRISに変換
sv2iris counter.sv -o counter.iris

# 2. IRISコードをフォーマット
irisfmt-format --write counter.iris

# 3. IRISコードをリント
irisfmt-lint counter.iris

# 4. IRISからSystemVerilogに変換（必要に応じて）
iris2sv counter.iris -o output/
```

## ライセンス

MIT
