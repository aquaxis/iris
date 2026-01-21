# 第1章 字句構造

[<< 概要](./00_overview.md) | [目次](./iris_spec_0.1.0.md) | [型システム >>](./02_type_system.md)

---

## 1.1 文字セット

### 1.1.1 エンコーディング

- ソースファイルはUTF-8でエンコードされなければならない
- BOM（Byte Order Mark）は許容されるが推奨されない

### 1.1.2 文字カテゴリ

| カテゴリ | 許容文字 | 用途 |
|----------|----------|------|
| 空白文字 | スペース(U+0020), タブ(U+0009), 改行(U+000A, U+000D) | トークン区切り |
| 識別子開始 | `a-z`, `A-Z`, `_` | 識別子の先頭 |
| 識別子継続 | `a-z`, `A-Z`, `0-9`, `_` | 識別子の2文字目以降 |
| 数字 | `0-9` | 数値リテラル |
| 16進数字 | `0-9`, `a-f`, `A-F` | 16進リテラル |

---

## 1.2 識別子

### 1.2.1 識別子規則

```ebnf
identifier      = identifier_start { identifier_continue } ;
identifier_start = letter | "_" ;
identifier_continue = letter | digit | "_" ;
letter          = "a"..."z" | "A"..."Z" ;
digit           = "0"..."9" ;
```

### 1.2.2 命名規約（推奨）

| 対象 | 規約 | 例 |
|------|------|-----|
| モジュール | PascalCase | `Counter`, `AxiLite` |
| 信号・変数 | snake_case | `data_valid`, `read_enable` |
| 定数 | SCREAMING_SNAKE_CASE | `MAX_WIDTH`, `DEFAULT_DEPTH` |
| 型エイリアス | PascalCase | `Byte`, `Word` |
| 列挙値 | PascalCase | `Idle`, `Running` |

### 1.2.3 予約識別子

- `_` 単独: 未使用信号の明示的破棄
- `_`で始まる識別子: 未使用警告を抑制

---

## 1.3 コメント

### 1.3.1 コメント構文

```rust
// 単一行コメント（行末まで）

/* 複数行コメント
   ネスト不可 */

/// ドキュメンテーションコメント（直後の項目に適用）

//! モジュールレベルのドキュメンテーションコメント
```

### 1.3.2 ドキュメンテーションコメント

- `///` はその直後の項目（モジュール、信号、型など）に対するドキュメント
- `//!` はそのファイル/モジュール全体に対するドキュメント
- マークダウン形式をサポート

### 1.3.3 複数行コメント内Markdown記述

`/* ... */` 複数行コメント内ではMarkdown記法が使用可能。コンパイル時にドキュメントとして抽出・出力できる。

**サポートする図表形式:**

| 形式 | 用途 | 記法 |
|------|------|------|
| WaveDrom | 波形図（タイミングダイアグラム） | ` ```wavedrom ``` ` |
| Mermaid | フロー図、シーケンス図、状態遷移図 | ` ```mermaid ``` ` |

**使用例:**

```rust
/*
# モジュール概要

このモジュールはAXI-Liteインターフェースを実装します。

## タイミング図

```wavedrom
{ signal: [
  { name: "clk",     wave: "p......." },
  { name: "awvalid", wave: "01..0..." },
  { name: "awready", wave: "0.10...." }
]}
```end

## 状態遷移図

```mermaid
stateDiagram-v2
    [*] --> Idle
    Idle --> Write : awvalid
    Write --> Response : wvalid
    Response --> Idle : bready
```end
*/
mod AxiLiteSlave(
    // ポート宣言
) {
    // ...
}
```

上記の"```end"の"end"はこのドキュメントがMarkdownであり、検出してしまうので付けているだけ、本来は必要ありません。

**コンパイラオプション:**

- `--doc`: Markdownドキュメントを生成
- `--doc-format=html|md`: 出力形式を指定
- `--doc-diagrams`: WaveDrom/Mermaid図を画像として埋め込み

---

## 1.4 予約語（55語）

IRISは55個の予約語を持ち、SystemVerilogの約220語と比較して大幅に削減されている。

### 1.4.1 モジュール構造（11語）

```
mod     extern  inst    in      out     inout
const   type    import  export  pub
```

| 予約語 | 説明 | SystemVerilog相当 | 使用例 |
|--------|------|-------------------|--------|
| `mod` | モジュール定義 | `module ... endmodule` | `mod Counter(...) { ... }` |
| `extern` | 外部モジュール/Rust関数宣言 | `(* black_box *)`, DPI | `extern mod LegacyIP;`, `extern rust "module" { ... }` |
| `inst` | モジュールインスタンス化 | モジュールインスタンス | `inst u_counter: Counter;` |
| `in` | 入力ポート宣言 | `input` | `in clk: clock` |
| `out` | 出力ポート宣言 | `output` | `out data: bit[8]` |
| `inout` | 双方向ポート宣言 | `inout` | `inout bidir: bit` |
| `const` | 定数定義 | `parameter`, `localparam` | `const WIDTH: uint = 8;` |
| `type` | 型エイリアス定義 | `typedef` | `type Byte = bit[8];` |
| `import` | 他パッケージからの取り込み | `import` | `import math::*;` |
| `export` | 外部への公開 | - | `export const PI;` |
| `pub` | 公開可視性修飾子 | - | `pub mod SubModule(...) { ... }` |

### 1.4.2 制御構造（8語）

```
if      else    match   for     while
break   continue return
```

| 予約語 | 説明 | SystemVerilog相当 | 使用例 |
|--------|------|-------------------|--------|
| `if` | 条件分岐 | `if` | `if condition { ... }` |
| `else` | 条件分岐の代替 | `else` | `if a { ... } else { ... }` |
| `match` | パターンマッチング | `case`, `casez`, `casex` | `match state { Idle => ..., }` |
| `for` | 繰り返し（展開用） | `for` | `for i in 0..8 { ... }` |
| `while` | 条件付き繰り返し（シミュレーション専用） | `while` | `while !done { ... }` |
| `break` | ループ脱出 | `break` | `break;` |
| `continue` | ループの次反復へスキップ | `continue` | `continue;` |
| `return` | 関数からの戻り | `return` | `return value;` |

### 1.4.3 型関連（13語）

```
bit     int     uint    bool    enum
struct  union   clock   reset   let
var     mut     mem
```

| 予約語 | 説明 | SystemVerilog相当 | 使用例 |
|--------|------|-------------------|--------|
| `bit` | ビットベクトル型 | `logic`, `reg`, `wire` | `let data: bit[8];` |
| `int` | 符号付き整数型基本 | `int` | パラメータ/定数用 |
| `uint` | 符号なし整数型基本 | `int unsigned` | パラメータ/定数用 |
| `bool` | 論理型 | `logic`（1ビット） | `let flag: bool = true;` |
| `enum` | 列挙型定義 | `enum` | `enum State { Idle, Run }` |
| `struct` | 構造体定義 | `struct packed` | `struct Header { ... }` |
| `union` | 共用体定義 | `union packed` | `union DataView { ... }` |
| `clock` | クロック信号型 | - | `in clk: clock` |
| `reset` | リセット信号型 | - | `in rst: reset` |
| `let` | 不変信号宣言 | `wire` + `assign` | `let sum = a + b;` |
| `var` | 可変信号宣言（**推奨**） | `reg` | `var counter: bit[8] = 0;` |
| `mut` | 可変修飾子 | - | `let mut cnt: bit[8];` |
| `mem` | メモリ宣言 | 配列 | `mem buffer: bit[8][256];` |

※ `var`は`let mut`と同義。可変信号には`var`の使用を推奨（簡潔で可読性が高い）。
※ 整数型（`i8`, `u8`, `i16`, `u16`, `i32`, `u32`等）は予約語ではなく組み込み型名。

### 1.4.4 論理ブロック（9語）

```
comb    sync    fsm     state   when
goto    initial transitions default
```

| 予約語 | 説明 | SystemVerilog相当 | 使用例 |
|--------|------|-------------------|--------|
| `comb` | 組み合わせ論理ブロック | `always_comb` | `comb { out = a & b; }` |
| `sync` | 同期論理ブロック | `always_ff` | `sync(clk.posedge) { ... }` |
| `fsm` | 有限状態機械定義 | - | `fsm controller { ... }` |
| `state` | FSM状態定義 | `enum` | `state enum { Idle, Run }` |
| `when` | FSM遷移条件 | `if` | `when ready: goto Run;` |
| `goto` | FSM状態遷移 | - | `goto NextState;` |
| `initial` | FSM初期状態指定 | - | `initial Idle;` |
| `transitions` | FSM遷移ブロック | - | `transitions { ... }` |
| `default` | match/FSMのデフォルト分岐 | `default` | `default => { ... }` |

### 1.4.5 検証（8語）

```
test    assert  expect  cover   assume
constraint await  seq
```

| 予約語 | 説明 | SystemVerilog相当 | 使用例 |
|--------|------|-------------------|--------|
| `test` | テストモジュール定義 | `module`（テストベンチ） | `test CounterTest { ... }` |
| `assert` | 即時アサーション | `assert` | `assert(valid);` |
| `expect` | 並行アサーション | `assert property` | `expect(req \|-> ack);` |
| `cover` | カバレッジポイント | `cover` | `cover(state == Idle);` |
| `assume` | 仮定（フォーマル検証用） | `assume` | `assume(input_valid);` |
| `constraint` | 制約定義 | `constraint` | `constraint c { ... }` |
| `await` | シミュレーション待機 | `@`, `wait` | `await clk.posedge;` |
| `seq` | シーケンシャル処理ブロック | `initial`（手続き的） | `seq { for i in 0..10 { ... } }` |

### 1.4.6 インターフェース（4語）

```
interface   initiator  target   view
```

| 予約語 | 説明 | SystemVerilog相当 | 使用例 |
|--------|------|-------------------|--------|
| `interface` | インターフェース定義 | `interface` | `interface AxiBus { ... }` |
| `initiator` | マスター側ビュー | `modport` | `view initiator { ... }` |
| `target` | スレーブ側ビュー | `modport` | `view target { ... }` |
| `view` | インターフェースビュー定義 | `modport` | `view monitor { ... }` |

### 1.4.7 その他（2語）

```
where   fn
```

| 予約語 | 説明 | SystemVerilog相当 | 使用例 |
|--------|------|-------------------|--------|
| `where` | ジェネリック制約 | - | `where Width >= 8` |
| `fn` | 関数定義 | `function` | `fn add(a: bit[8], b: bit[8]) -> bit[8]` |

### 1.4.8 予約語一覧表

| カテゴリ | 予約語 | 語数 |
|----------|--------|------|
| モジュール構造 | `mod`, `extern`, `inst`, `in`, `out`, `inout`, `const`, `type`, `import`, `export`, `pub` | 11 |
| 制御構造 | `if`, `else`, `match`, `for`, `while`, `break`, `continue`, `return` | 8 |
| 型関連 | `bit`, `int`, `uint`, `bool`, `enum`, `struct`, `union`, `clock`, `reset`, `let`, `var`, `mut`, `mem` | 13 |
| 論理ブロック | `comb`, `sync`, `fsm`, `state`, `when`, `goto`, `initial`, `transitions`, `default` | 9 |
| 検証 | `test`, `assert`, `expect`, `cover`, `assume`, `constraint`, `await`, `seq` | 8 |
| インターフェース | `interface`, `initiator`, `target`, `view` | 4 |
| その他 | `where`, `fn` | 2 |
| **合計** | | **55** |

### 1.4.9 コンテキストキーワード

以下の識別子は特定のコンテキストでのみキーワードとして機能する。通常の識別子としても使用可能。

| 識別子 | コンテキスト | 説明 | 使用例 |
|--------|--------------|------|--------|
| `rust` | `extern rust`, `use rust::` | 外部Rust関数との連携 | `extern rust "module" { fn name(); }`, `use rust::module::func;` |
| `async` | `seq`ブロック内 | 非同期関数の呼び出し | `let result = func().await;` |

※ コンテキストキーワードは予約語数（55語）には含まれない。

---

## 1.5 リテラル

### 1.5.1 整数リテラル構文

```ebnf
integer_literal = sized_literal | unsized_literal ;
sized_literal   = width "'" base_char value ;
unsized_literal = "'" base_char value ;
width           = decimal_digits ;
base_char       = "b" | "B" | "o" | "O" | "d" | "D" | "h" | "H" ;
value           = { digit | "_" | "x" | "X" | "z" | "Z" } ;
```

### 1.5.2 基数と許容文字

| 基数 | 接頭辞 | 許容文字 | 例 |
|------|--------|----------|-----|
| 2進数 | `'b`, `'B` | `0`, `1`, `x`, `z`, `_` | `8'b1010_1100` |
| 8進数 | `'o`, `'O` | `0-7`, `x`, `z`, `_` | `8'o254` |
| 10進数 | `'d`, `'D` | `0-9`, `_` | `32'd1234567` |
| 16進数 | `'h`, `'H` | `0-9`, `a-f`, `A-F`, `x`, `z`, `_` | `16'hABCD` |

### 1.5.3 特殊値

| 値 | 意味 | 合成可能性 |
|-----|------|-----------|
| `x`, `X` | 不定値 | 検証専用 |
| `z`, `Z` | ハイインピーダンス | 合成可能（トライステート） |

### 1.5.4 文字列リテラル

```rust
"Hello, IRIS!"           // 基本文字列
"Line1\nLine2"           // エスケープシーケンス
```

| エスケープ | 意味 |
|-----------|------|
| `\n` | 改行 |
| `\t` | タブ |
| `\\` | バックスラッシュ |
| `\"` | ダブルクォート |
| `\xHH` | 16進コードポイント |

### 1.5.5 配列リテラル

```rust
[8'h01, 8'h02, 8'h03, 8'h04]  // 要素列挙
[0; 16]                        // 繰り返し（16個の0）
```

---

## 1.6 演算子・区切り子

### 1.6.1 演算子一覧

| 優先度 | 演算子 | 結合性 | 説明 |
|--------|--------|--------|------|
| 1 (最高) | `()` `[]` `.` `::` | 左 | グループ化、添字、メンバ、スコープ |
| 2 | `~` `!` | 右 | 単項NOT、論理NOT |
| 3 | `*` `/` `%` | 左 | 乗算、除算、剰余 |
| 4 | `+` `-` | 左 | 加算、減算 |
| 5 | `<<` `>>` `>>>` | 左 | シフト |
| 6 | `<` `<=` `>` `>=` | 左 | 比較 |
| 7 | `==` `!=` | 左 | 等価 |
| 8 | `&` | 左 | ビットAND |
| 9 | `^` `~^` | 左 | ビットXOR、XNOR |
| 10 | `\|` | 左 | ビットOR |
| 11 | `&&` | 左 | 論理AND |
| 12 | `\|\|` | 左 | 論理OR |
| 13 | `?:` | 右 | 三項条件 |
| 14 (最低) | `=` | 右 | 代入（統一演算子） |

### 1.6.2 区切り子

```
{  }  [  ]  (  )  ;  :  ,  .  ..  ...  ->  =>  @  #
```

---

[<< 概要](./00_overview.md) | [目次](./iris_spec_0.1.0.md) | [型システム >>](./02_type_system.md)
