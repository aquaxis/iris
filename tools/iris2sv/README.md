# iris2sv

IRIS to SystemVerilog トランスパイラ

## 概要

iris2svは、IRIS言語で記述されたソースコードをSystemVerilogコードに変換するトランスパイラです。

## 特徴

- IRISのRustライクな構文からSystemVerilogへの変換
- 型安全な変換処理
- 詳細なエラーメッセージ
- 変換できない構文は黙って捨てず、診断として報告する

## 変換できる範囲

`example/async_fifo`（非同期FIFO、2クロックドメイン）を変換し、
Verilatorで実行してIRISのシミュレータと同じ結果になることを確認している。

| 構文 | 状態 |
|------|------|
| モジュール定義、ポート | 変換できる |
| ジェネリックパラメータ（既定値、`$clog2`による導出を含む） | 変換できる |
| `where`句 | 受理する。SystemVerilogに対応物がないため出力には現れない |
| 信号宣言（`let`、`var`） | 変換できる |
| `mem`宣言 | 変換できる（非パック配列になる） |
| `comb`ブロック | 変換できる（`always_comb`） |
| `sync`ブロック（同期・非同期リセット） | 変換できる（`always_ff`） |
| インスタンス | 変換できる |
| `if`文、`if`式、`match`文、`for`ループ | 変換できる |
| 連結、反復、ビット選択、範囲選択 | 変換できる |
| システム関数（`$clog2`など） | 変換できる |
| `fsm`ブロック | 変換できる（状態レジスタと`case`になる） |
| `enum`定義、`struct`定義、`union`定義 | 変換できる（`typedef`になる） |
| `interface`定義と`view` | 変換できる（`interface`と`modport`になる） |
| 関数定義（`fn`） | 変換できる（`function`になる） |
| `extern mod` | SystemVerilogは名前で解決するので何も出力しない |
| `package`宣言 | 中身をファイル階層で変換し、名前は運べないと警告する |
| `test`モジュール | 変換できる（ポートの無いモジュールになる） |
| `match`式（値を返す形） | 変換できる（三項演算子の連鎖になる） |

### 変換できない構文

無い。

リポジトリにある設計と、文法の各構文を`tools/conformance/run.sh`が通している。

```bash
tools/conformance/run.sh
```

変換できない構文が現れた場合は、黙って捨てず診断として報告する。

### テストベンチについて

`test`モジュールは変換できる。
クロックは`clock(period: 10ns)`宣言から`always #5ns`の発生器を書き出す。

変換したテストベンチをVerilatorで走らせ、
`iris-sim`の報告と一致することを確かめている。

| 検証 | `iris-sim` | 変換後、Verilator |
|---|---|---|
| `test_addi` | 不一致0 | 不一致0 |
| `test_alu` | 不一致0、PASS | 不一致0、PASS |
| `test_mem` | 不一致0、PASS | 不一致0、PASS |
| `test_sys` | 不一致0、PASS | 不一致0、PASS |

`example/riscv/sv`と`example/async_fifo/sv`のテストベンチは手書きのままにしてある。
変換したコアを、変換に使っていない経路で検証するためである。

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
