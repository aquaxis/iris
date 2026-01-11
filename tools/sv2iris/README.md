# SV2IRIS

SystemVerilogで記述されたハードウェア設計ソースコードを、IRIS言語のソースコードへ変換するトランスパイラです。

## 概要

SV2IRISは、IEEE 1800-2017準拠のSystemVerilogコードを解析し、IRIS言語（独自HDL言語）に変換します。合成可能な構文のサブセットを対象としています。

### 処理フロー

```text
SystemVerilog (.sv) → Lexer → Parser → Transformer → Generator → IRIS (.iris)
```

## インストール

### 必要条件

- Node.js 18以上
- pnpm 9.x

### インストール手順

```bash
cd sv2iris
pnpm install
pnpm build
```

### グローバルインストール（オプション）

```bash
pnpm link --global
```

インストール後は `sv2iris` コマンドとして実行できます。

## 使用方法

### 基本的な使い方

```bash
# 標準出力へ出力
sv2iris counter.sv

# ファイルへ出力
sv2iris counter.sv -o counter.iris

# 複数ファイルを変換（ディレクトリへ出力）
sv2iris src/*.sv -o dist/
```

### コマンドラインオプション

```text
sv2iris <input.sv> [options]
sv2iris <input1.sv> <input2.sv> ... -o <output_dir/> [options]

Options:
  -o, --output <file|dir>   出力ファイルまたはディレクトリ
                            省略時は標準出力へ出力
                            末尾'/'でディレクトリ指定
  -a, --auto-output-wire    出力ポートが内部で読み取られる場合、
                            自動的に内部信号を生成して接続
  --indent <n>              インデント幅（デフォルト: 4）
  --tabs                    インデントにタブを使用
  -h, --help                ヘルプ表示
  -v, --version             バージョン表示
```

### 使用例

```bash
# ヘルプ表示
sv2iris --help

# バージョン表示
sv2iris --version

# インデント幅を2に設定
sv2iris counter.sv -o counter.iris --indent 2

# タブインデントを使用
sv2iris counter.sv -o counter.iris --tabs

# 出力信号の内部読み取りに対応（自動内部信号生成）
sv2iris counter.sv -o counter.iris -a
```

### --auto-output-wire オプション

SystemVerilogでは出力ポートを内部でも読み取ることができますが、IRIS言語では出力ポートは書き込み専用です。`-a`オプションを使用すると、出力ポートが内部で読み取られている場合に自動的に内部信号を生成し、出力ポートに接続します。

#### 変換例

入力 (SystemVerilog):
```systemverilog
module counter(
    input clk,
    output reg [7:0] count
);
    always_ff @(posedge clk) begin
        count <= count + 1;  // 出力ポートcountを読み取り
    end
endmodule
```

出力 (IRIS, -aオプション使用時):
```
mod counter(
    in clk: bit,
    out count: bit[8],
) {
    let count_internal: bit[8];

    sync(posedge clk) {
        count_internal = count_internal + 1;
    }

    comb {
        count = count_internal;
    }
}
```

## 対応構文一覧

### モジュール定義

| SystemVerilog | IRIS | 対応状況 |
|---------------|------|----------|
| `module ... endmodule` | `mod ... { }` | 対応 |
| `parameter` | ジェネリックパラメータ `[T: type]` | 対応 |
| `localparam` | `const` | 対応 |
| `input` | `in` | 対応 |
| `output` | `out` | 対応 |
| `inout` | `inout` | 対応 |

### データ型

| SystemVerilog | IRIS | 対応状況 |
|---------------|------|----------|
| `logic [N-1:0]` | `bit[N]` | 対応 |
| `reg [N-1:0]` | `bit[N]` | 対応 |
| `wire [N-1:0]` | `bit[N]` | 対応 |
| `integer` | `int[32]` | 対応 |
| `logic` (1bit) | `bool` または `bit[1]` | 対応 |
| `enum` | `enum` | 対応 |
| `struct` | `struct` | 対応 |
| 配列 `[N]` | `[N]` | 対応 |

### 組み合わせ回路

| SystemVerilog | IRIS | 対応状況 |
|---------------|------|----------|
| `assign` | `let x = expr;` | 対応 |
| `always_comb` | `comb { }` | 対応 |
| `always @(*)` | `comb { }` | 対応 |

### 順序回路

| SystemVerilog | IRIS | 対応状況 |
|---------------|------|----------|
| `always_ff @(posedge clk)` | `sync(clk.posedge) { }` | 対応 |
| `always_ff @(negedge clk)` | `sync(clk.negedge) { }` | 対応 |
| `always_ff @(posedge clk or negedge rst)` | `sync(clk.posedge, rst.async) { }` | 対応 |
| `always @(posedge clk)` | `sync(clk.posedge) { }` | 対応 |

### 演算子

| SystemVerilog | IRIS | 対応状況 |
|---------------|------|----------|
| `+`, `-`, `*`, `/`, `%` | `+`, `-`, `*`, `/`, `%` | 対応 |
| `&`, `\|`, `^`, `~` | `&`, `\|`, `^`, `~` | 対応 |
| `&&`, `\|\|`, `!` | `&&`, `\|\|`, `!` | 対応 |
| `<<`, `>>`, `>>>` | `<<`, `>>`, `>>>` | 対応 |
| `==`, `!=`, `<`, `<=`, `>`, `>=` | `==`, `!=`, `<`, `<=`, `>`, `>=` | 対応 |
| `?:` (三項演算子) | `if expr { } else { }` | 対応 |
| `{a, b}` (連結) | `{a, b}` | 対応 |
| `{N{x}}` (繰り返し) | `{N{x}}` | 対応 |

### 制御構文

| SystemVerilog | IRIS | 対応状況 |
|---------------|------|----------|
| `if ... else` | `if ... { } else { }` | 対応 |
| `case` | `match` | 対応 |
| `casez`, `casex` | `match` (ワイルドカード対応) | オプション |
| `for` | `for` | 対応 |
| `generate for` | `for` (展開) | オプション |

### インスタンス化

| SystemVerilog | IRIS | 対応状況 |
|---------------|------|----------|
| モジュールインスタンス | `inst: Module(.port(signal))` | 対応 |
| パラメータ指定 `#(.P(V))` | ジェネリック引数 `Module[V]` | 対応 |

### インターフェース

| SystemVerilog | IRIS | 対応状況 |
|---------------|------|----------|
| `interface ... endinterface` | `interface ... { }` | オプション |
| `modport` | `view` | オプション |

## 変換例

### 入力 (SystemVerilog)

```systemverilog
module counter #(
    parameter WIDTH = 8
)(
    input  logic clk,
    input  logic rst_n,
    input  logic en,
    output logic [WIDTH-1:0] count
);

always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n)
        count <= '0;
    else if (en)
        count <= count + 1;
end

endmodule
```

### 出力 (IRIS)

```
mod counter[WIDTH: uint = 8](
    in  clk:   clock,
    in  rst_n: reset,
    in  en:    bool,
    out count: bit[WIDTH],
) {
    sync(clk.posedge, rst_n.async) {
        if !rst_n {
            count = 0;
        } else if en {
            count = count + 1;
        }
    }
}
```

## 制限事項

### 非対応構文

以下のSystemVerilog構文は変換対象外です：

- クラス (`class`)
- 動的配列、連想配列、キュー
- ランダム化制約 (`rand`, `constraint`)
- アサーション (`assert`, `property`, `sequence`)
- カバレッジ (`covergroup`, `coverpoint`)
- プログラムブロック (`program`)
- クロッキングブロック (`clocking`)
- システムタスク/関数 (`$display`, `$finish`等)
- `initial` ブロック（テストベンチ用のため対象外）
- プリプロセッサディレクティブ (`ifdef`, `define`等) - 事前展開が必要

### その他の制約

1. SystemVerilogの完全な言語仕様をサポートするものではありません
2. 合成可能な構文のサブセットを対象としています
3. シミュレーション専用構文は対象外です
4. 変換結果の意味的等価性は保証しません（構文変換のみ）
5. プリプロセッサは事前に展開済みである必要があります

## 開発

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

### フォーマット

```bash
pnpm format
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

## ライセンス

MIT License
