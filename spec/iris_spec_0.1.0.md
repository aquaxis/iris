# IRIS 言語仕様書 v0.1.0

## 概要

**IRIS** (アイリス:Immutable RTL Implementation Standard) は、SystemVerilogの複雑さを解消し、Rustの設計思想を取り入れたハードウェア記述言語です。

### 設計哲学

| 原則 | 説明 |
|------|------|
| **Safety First** | 暗黙の型変換を廃止、ビット幅不一致はコンパイルエラー |
| **明示性 > 暗黙性** | 意図を明確にコードで表現 |
| **簡潔性** | `{}`記法、統一されたデータ型、統一された代入演算子 |
| **構成可能性** | モジュール間の疎結合設計 |
| **合成と検証の分離** | 合成可能/検証専用コードの明確な区別 |

### 主要な特徴

1. **代入演算子の統一**: ブロッキング/ノンブロッキングの概念を廃止し、`=` に統一
2. **組み合わせ回路の明示的記述**: `comb` ブロックで組み合わせ論理を記述
3. **順序回路の明示的記述**: `sync` ブロックで順序回路を記述
4. **型安全性**: 暗黙の型変換を禁止

---

## 1. 字句構造

### 1.1 文字セット

#### 1.1.1 エンコーディング

- ソースファイルはUTF-8でエンコードされなければならない
- BOM（Byte Order Mark）は許容されるが推奨されない

#### 1.1.2 文字カテゴリ

| カテゴリ | 許容文字 | 用途 |
|----------|----------|------|
| 空白文字 | スペース(U+0020), タブ(U+0009), 改行(U+000A, U+000D) | トークン区切り |
| 識別子開始 | `a-z`, `A-Z`, `_` | 識別子の先頭 |
| 識別子継続 | `a-z`, `A-Z`, `0-9`, `_` | 識別子の2文字目以降 |
| 数字 | `0-9` | 数値リテラル |
| 16進数字 | `0-9`, `a-f`, `A-F` | 16進リテラル |

### 1.2 識別子

#### 1.2.1 識別子規則

```ebnf
identifier      = identifier_start { identifier_continue } ;
identifier_start = letter | "_" ;
identifier_continue = letter | digit | "_" ;
letter          = "a"..."z" | "A"..."Z" ;
digit           = "0"..."9" ;
```

#### 1.2.2 命名規約（推奨）

| 対象 | 規約 | 例 |
|------|------|-----|
| モジュール | PascalCase | `Counter`, `AxiLite` |
| 信号・変数 | snake_case | `data_valid`, `read_enable` |
| 定数 | SCREAMING_SNAKE_CASE | `MAX_WIDTH`, `DEFAULT_DEPTH` |
| 型エイリアス | PascalCase | `Byte`, `Word` |
| 列挙値 | PascalCase | `Idle`, `Running` |

#### 1.2.3 予約識別子

- `_` 単独: 未使用信号の明示的破棄
- `_`で始まる識別子: 未使用警告を抑制

### 1.3 コメント

#### 1.3.1 コメント構文

```rust
// 単一行コメント（行末まで）

/* 複数行コメント
   ネスト不可 */

/// ドキュメンテーションコメント（直後の項目に適用）

//! モジュールレベルのドキュメンテーションコメント
```

#### 1.3.2 ドキュメンテーションコメント

- `///` はその直後の項目（モジュール、信号、型など）に対するドキュメント
- `//!` はそのファイル/モジュール全体に対するドキュメント
- マークダウン形式をサポート

#### 1.3.3 複数行コメント内Markdown記述

`/* ... */` 複数行コメント内ではMarkdown記法が使用可能。コンパイル時にドキュメントとして抽出・出力できる。

**サポートする図表形式:**

| 形式 | 用途 | 記法 |
|------|------|------|
| WaveDrom | 波形図（タイミングダイアグラム） | ` ```wavedrom ``` ` |
| Mermaid | フロー図、シーケンス図、状態遷移図 | ` ```mermaid ``` ` |

**使用例:**


**コンパイラオプション:**
- `--doc`: Markdownドキュメントを生成
- `--doc-format=html|md`: 出力形式を指定
- `--doc-diagrams`: WaveDrom/Mermaid図を画像として埋め込み

### 1.4 予約語（52語）

#### 1.4.1 モジュール構造（11語）

```
mod     extern  inst    in      out     inout
const   type    import  export  pub
```

#### 1.4.2 制御構造（8語）

```
if      else    match   for     while
break   continue return
```

#### 1.4.3 型関連（12語）

```
bit     int     uint    bool    enum
struct  union   clock   reset   let
var     mut     mem
```
※ `var`は`let mut`と同義（可変宣言のシンタックスシュガー）

#### 1.4.4 論理ブロック（9語）

```
comb    sync    fsm     state   when
goto    initial transitions default
```

#### 1.4.5 検証（7語）

```
test    assert  expect  cover   assume
constraint await
```

#### 1.4.6 インターフェース（4語）

```
interface   initiator  target   view
```

#### 1.4.7 その他（2語）

```
where   fn
```

### 1.5 リテラル

#### 1.5.1 整数リテラル構文

```ebnf
integer_literal = sized_literal | unsized_literal ;
sized_literal   = width "'" base_char value ;
unsized_literal = "'" base_char value ;
width           = decimal_digits ;
base_char       = "b" | "B" | "o" | "O" | "d" | "D" | "h" | "H" ;
value           = { digit | "_" | "x" | "X" | "z" | "Z" } ;
```

#### 1.5.2 基数と許容文字

| 基数 | 接頭辞 | 許容文字 | 例 |
|------|--------|----------|-----|
| 2進数 | `'b`, `'B` | `0`, `1`, `x`, `z`, `_` | `8'b1010_1100` |
| 8進数 | `'o`, `'O` | `0-7`, `x`, `z`, `_` | `8'o254` |
| 10進数 | `'d`, `'D` | `0-9`, `_` | `32'd1234567` |
| 16進数 | `'h`, `'H` | `0-9`, `a-f`, `A-F`, `x`, `z`, `_` | `16'hABCD` |

#### 1.5.3 特殊値

| 値 | 意味 | 合成可能性 |
|-----|------|-----------|
| `x`, `X` | 不定値 | 検証専用 |
| `z`, `Z` | ハイインピーダンス | 合成可能（トライステート） |

#### 1.5.4 文字列リテラル

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

#### 1.5.5 配列リテラル

```rust
[8'h01, 8'h02, 8'h03, 8'h04]  // 要素列挙
[0; 16]                        // 繰り返し（16個の0）
```

### 1.6 演算子・区切り子

#### 1.6.1 演算子一覧

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

#### 1.6.2 区切り子

```
{  }  [  ]  (  )  ;  :  ,  .  ..  ...  ->  =>  @  #
```

---

## 2. 型システム

### 2.1 プリミティブ型

#### 2.1.1 ビット型

| 型 | ビット幅 | 説明 | 合成可能 |
|----|----------|------|----------|
| `bit` | 1 | 単一ビット（0または1） | Yes |
| `bit[N]` | N | Nビットベクトル（N > 0） | Yes |
| `bit[H:L]` | H-L+1 | 範囲指定ビットベクトル | Yes |

```rust
let single: bit;           // 1ビット
let byte_val: bit[8];      // 8ビット
let word_val: bit[31:0];   // 32ビット（範囲指定）
```

**`bit[N]` と `uint[N]` の違い:**

| 型 | 値の範囲 | 4値論理 | 用途 |
|----|----------|---------|------|
| `bit[N]` | 0または1のN個の値 | サポート（x, z） | 合成可能な信号 |
| `uint[N]` | 0 ～ 2^N - 1 の整数 | 非サポート | 演算、インデックス |

- `bit[N]`: ハードウェア信号として使用。シミュレーション時にx/z値を持つ可能性がある。
- `uint[N]`: 純粋な符号なし整数。演算やループカウンタに使用。

```rust
let signal: bit[8];    // ハードウェア信号（x/z可能）
let index: uint[8];    // 整数値（x/z不可）
```

#### 2.1.2 整数型

| 型 | ビット幅 | 符号 | 用途 |
|----|----------|------|------|
| `int` | 32 | 符号付き | 汎用整数 |
| `uint` | 32 | 符号なし | 汎用符号なし整数 |
| `int[N]` | N | 符号付き | Nビット符号付き整数 |
| `uint[N]` | N | 符号なし | Nビット符号なし整数 |

```rust
let count: uint[8] = 0;      // 8ビット符号なし
let offset: int[16] = -100;  // 16ビット符号付き
```

#### 2.1.3 論理型

```rust
let flag: bool;  // true または false
// bool は bit と相互変換可能だが、意味的に区別される
```

#### 2.1.4 特殊信号型

| 型 | 説明 | 属性 |
|----|------|------|
| `clock` | クロック信号 | `.posedge`, `.negedge` |
| `reset` | リセット信号 | `.sync`, `.async`, 極性指定 |

```rust
in clk: clock,
in rst: reset,              // デフォルト: active high
in rst_n: reset(active_low), // active low

// クロックエッジアクセス
sync(clk.posedge) { ... }
sync(clk.negedge) { ... }

// リセットモード
sync(clk.posedge, rst.sync) { ... }   // 同期リセット
sync(clk.posedge, rst.async) { ... }  // 非同期リセット
```

### 2.2 複合型

#### 2.2.1 列挙型（enum）

**基本構文:**
```ebnf
enum_decl = "enum" identifier [ ":" underlying_type ] "{" enum_variants "}" ;
enum_variants = enum_variant { "," enum_variant } [ "," ] ;
enum_variant = identifier [ "=" constant_expr ] [ "(" type ")" ] ;
```

**基本列挙型:**
```rust
enum State: bit[2] {
    Idle   = 2'b00,
    Run    = 2'b01,
    Pause  = 2'b10,
    Stop   = 2'b11
}

// 基底型省略時は自動計算
enum Color {
    Red,    // = 0
    Green,  // = 1
    Blue    // = 2
}  // 自動的に bit[2] が割り当てられる
```

**ペイロード付き列挙型（タグ付きユニオン）:**
```rust
enum Packet {
    Header,
    Payload(bit[8]),   // 8ビットのペイロードを持つ
    Footer
}

// 使用例
let pkt: Packet = Packet::Payload(8'hAB);

// パターンマッチで取り出し
match pkt {
    Packet::Header => { ... },
    Packet::Payload(data) => { process(data); },
    Packet::Footer => { ... }
}
```

#### 2.2.2 構造体（struct）

**構文:**
```ebnf
struct_decl = "struct" identifier "{" struct_fields "}" ;
struct_fields = struct_field { "," struct_field } [ "," ] ;
struct_field = identifier ":" type ;
```

**パックされた構造体:**
```rust
struct EthernetHeader {
    dst_mac: bit[48],
    src_mac: bit[48],
    ether_type: bit[16]
}  // 合計 112ビット、パック保証

// フィールドアクセス
let hdr: EthernetHeader;
hdr.dst_mac = 48'hFFFFFFFFFFFF;
hdr.ether_type = 16'h0800;

// ビットキャスト
let raw: bit[112] = hdr as bit[112];
```

#### 2.2.3 共用体（union）

```rust
union DataView {
    as_bytes: bit[8][4],
    as_halfwords: bit[16][2],
    as_word: bit[32]
}

// 全フィールドは同じビット幅でなければならない
let view: DataView;
view.as_word = 32'hDEADBEEF;
let byte0 = view.as_bytes[0];  // 0xEF（リトルエンディアン想定）
```

**注意: 共用体の合成上の制約**
- 共用体は本質的にビットキャスト（型変換）である
- 異なるフィールドへの同時アクセスは未定義動作
- 安全なビットキャストには `as` 演算子の使用を推奨

```rust
// 推奨: 明示的ビットキャスト
let word: bit[32] = 32'hDEADBEEF;
let bytes: bit[8][4] = word as bit[8][4];
```

#### 2.2.4 配列型

```rust
// 固定長配列
let memory: bit[8][256];       // 256要素の8ビット配列
let matrix: bit[4][8][8];      // 8x8の4ビット行列

// 配列アクセス
memory[0] = 8'hFF;
let val = matrix[row][col];

// 配列スライス（固定範囲）
let slice = memory[0..8];      // 最初の8要素（定数範囲）
```

**配列アクセスの合成制約:**

| パターン | 例 | 合成結果 |
|----------|-----|----------|
| 定数インデックス | `arr[3]` | 直接配線 |
| 変数インデックス | `arr[idx]` | マルチプレクサ |
| 定数スライス | `arr[0..4]` | 直接配線 |
| 変数スライス（固定幅） | `arr[idx +: 4]` | バレルシフタ |
| 変数スライス（可変幅） | `arr[a..b]` | **非サポート** |

```rust
// OK: 固定幅の動的スライス
let byte = data[idx +: 8];  // idxから8ビット取得

// エラー: 可変幅スライスは合成不可
let slice = data[a..b];  // コンパイルエラー
```

### 2.3 型エイリアスとジェネリクス

#### 2.3.1 型エイリアス

```rust
type Byte = bit[8];
type Word = bit[32];
type Address = bit[16];
type RegFile = bit[32][32];  // 32個の32ビットレジスタ
```

#### 2.3.2 パラメトリック型（ジェネリクス）

**型パラメータ:**
```rust
type Vec[T, N: uint] = [T; N];

// 使用
let bytes: Vec[bit[8], 16];  // 16要素の8ビット配列
```

**モジュールジェネリクス:**
```rust
mod Fifo[T, Depth: uint = 16]
where
    Depth > 0,
    Depth.is_power_of_two()
{
    in  clk: clock,
    in  rst: reset,
    in  push: bit,
    in  pop: bit,
    in  din: T,
    out dout: T,
    out full: bit,
    out empty: bit,

    mem buffer: T[Depth];
    let wptr: bit[$clog2(Depth)] = 0;
    let rptr: bit[$clog2(Depth)] = 0;
    // ...
}
```

#### 2.3.3 制約（where句）

```rust
mod Memory[DataWidth: uint, Depth: uint]
where
    DataWidth >= 8,
    DataWidth <= 256,
    Depth > 0,
    Depth <= 65536
{
    // ...
}
```

#### 2.3.4 組み込み関数

| 関数 | 説明 | 例 |
|------|------|-----|
| `$clog2(N)` | 天井log2 | `$clog2(256) = 8` |
| `$bits(T)` | 型のビット幅 | `$bits(bit[8]) = 8` |
| `$size(arr)` | 配列サイズ | `$size(mem) = 1024` |

### 2.4 型推論と型変換

#### 2.4.1 型推論規則

```rust
let x = 8'hFF;           // 型: bit[8]（リテラルから推論）
let y = x + 1;           // 型: bit[8]（オペランドから推論）
let z = x == y;          // 型: bool（比較結果）
```

#### 2.4.2 明示的型変換

| メソッド | 説明 | 例 |
|----------|------|-----|
| `.extend[N]` | ゼロ拡張 | `x.extend[16]` |
| `.sign_extend[N]` | 符号拡張 | `x.sign_extend[16]` |
| `.truncate[N]` | 切り詰め | `x.truncate[8]` |
| `.saturate[N]` | 飽和演算 | `x.saturate[8]` |
| `.signed()` | 符号付き解釈 | `x.signed()` |
| `.unsigned()` | 符号なし解釈 | `x.unsigned()` |
| `as T` | 型キャスト | `x as bit[16]` |

```rust
let a: bit[8] = 8'hFF;
let b: bit[16] = a.extend[16];       // 0x00FF
let c: int[16] = a.sign_extend[16];  // 0xFFFF（-1）
let d: bit[4] = a.truncate[4];       // 0xF
let e: bit[4] = a.saturate[4];       // 0xF（飽和）
```

#### 2.4.3 暗黙の型変換（禁止）

IRISでは暗黙の型変換を**禁止**し、すべての型変換は明示的に行う必要がある。

```rust
// エラー: 暗黙の型変換
let a: bit[16] = 8'hFF;  // コンパイルエラー

// 正しい: 明示的拡張
let a: bit[16] = (8'hFF).extend[16];
```

#### 2.4.4 算術演算の結果幅

| 演算 | 結果幅 | 例 |
|------|--------|-----|
| `a + b` | max(a.width, b.width) | bit[8] + bit[8] → bit[8] |
| `a * b` | a.width + b.width | bit[8] * bit[8] → bit[16] |
| `a << n` | a.width | bit[8] << 2 → bit[8] |

オーバーフローを防ぐには明示的な拡張が必要:
```rust
let sum: bit[9] = a.extend[9] + b.extend[9];
```

---

## 3. モジュール定義

### 3.1 モジュール構文

#### 3.1.1 基本構文（EBNF）
```ebnf
module_decl = "mod" identifier [ generic_params ] [ where_clause ]
              "{" module_body "}" ;
generic_params = "[" generic_param { "," generic_param } "]" ;
generic_param = identifier ":" type [ "=" default_value ] ;
where_clause = "where" constraint { "," constraint } ;
module_body = { port_decl | signal_decl | logic_block | instance } ;
```

#### 3.1.2 完全な例
```rust
/// 8ビットカウンタ
///
/// # パラメータ
/// - Width: カウンタのビット幅（デフォルト: 8）
mod Counter[Width: uint = 8]
where
    Width >= 1,
    Width <= 32
{
    // ===== ポート宣言 =====
    in  clk: clock,
    in  rst: reset,
    in  enable: bit,
    in  load: bit,
    in  load_value: bit[Width],
    out count: bit[Width],
    out overflow: bit,

    // ===== 内部信号 =====
    let mut count_reg: bit[Width] = 0;  // 初期値（リセット値）
    let next_count: bit[Width + 1];

    // ===== 組み合わせ論理 =====
    comb {
        next_count = if load {
            load_value.extend[Width + 1]
        } else if enable {
            count_reg.extend[Width + 1] + 1
        } else {
            count_reg.extend[Width + 1]
        };
        count = count_reg;
        overflow = next_count[Width];
    }

    // ===== 順序論理 =====
    sync(clk.posedge, rst.async) {
        count_reg = next_count[Width-1:0];
    }
}
```

### 3.2 ポート宣言

#### 3.2.1 ポート方向
| キーワード | 説明 | 合成結果 |
|------------|------|----------|
| `in` | 入力ポート | input |
| `out` | 出力ポート | output |
| `inout` | 双方向ポート | inout（トライステート） |

#### 3.2.2 ポート宣言構文
```ebnf
port_decl = port_direction identifier ":" type [ "," ] ;
port_direction = "in" | "out" | "inout" ;
```

#### 3.2.3 ポート例
```rust
mod Example {
    // 基本ポート
    in  clk: clock,
    in  rst: reset,
    in  data: bit[8],
    out result: bit[16],
    inout bus: bit[8],

    // 配列ポート
    in  inputs: bit[8][4],    // 4つの8ビット入力
    out outputs: bit[8][4],   // 4つの8ビット出力

    // 構造体ポート
    in  config: ConfigStruct,
    out status: StatusStruct,

    // インターフェースポート
    initiator axi_m: AxiLite,
    target axi_s: AxiLite,
}
```

### 3.3 信号宣言

#### 3.3.1 信号の種類
| 宣言 | 用途 | 合成結果 | スコープ |
|------|------|----------|----------|
| `let 名前: 型;` | 不変信号（型のみ） | wire | モジュール |
| `let 名前 = 式;` | 不変信号（型推論） | wire | モジュール |
| `let 名前: 型 = 式;` | 不変信号（型と式指定） | wire | モジュール |
| `let mut 名前: 型;` | 可変信号（型のみ） | register | モジュール |
| `let mut 名前 = 初期値;` | 可変信号（型推論） | register | モジュール |
| `let mut 名前: 型 = 初期値;` | 可変信号（型と初期値指定） | register | モジュール |
| `var 名前: 型;` | 可変信号（`let mut`と同義） | register | モジュール |
| `var 名前 = 初期値;` | 可変信号（`let mut`と同義） | register | モジュール |
| `var 名前: 型 = 初期値;` | 可変信号（`let mut`と同義） | register | モジュール |
| `const` | モジュール定数（外部から参照可能） | parameter相当 | モジュール/パッケージ |
| `mem` | メモリ | RAM/ROM | モジュール |

※ `var`は`let mut`のシンタックスシュガー（同義）。

**`let` vs `let mut` vs `var` vs `const` の違い:**
- `let`: 不変信号宣言。組み合わせ回路として合成（Verilogの`wire`に相当）。型のみ、式のみ、または両方を指定可能。
- `let mut`: 可変信号宣言。順序回路として合成（Verilogの`reg`に相当）。syncブロック内で更新可能。型のみ、初期値のみ、または両方を指定可能（初期値設定時はリセット値として使用）。
- `var`: `let mut`と同義。可変信号の短縮形。
- `const`: モジュールレベルまたはパッケージレベルの定数。外部から参照可能。

**組み合わせ回路の記述:**
- `let`宣言による組み合わせ回路記述（Verilogの`wire`に相当）
- `comb`ブロック内で出力ポートに直接代入

```rust
mod Example {
    in  a: bit[8],
    in  b: bit[8],
    out sum: bit[8],
    out diff: bit[8],

    const MAX_COUNT: uint = 255;  // モジュール定数（外部参照可能）

    // 組み合わせ論理（let宣言）
    let sum = a + b;      // wire として合成
    let diff = a - b;     // wire として合成

    // 複雑な組み合わせ論理（combブロック）
    // comb {
    //     result = match op {
    //         2'b00 => a + b,
    //         2'b01 => a - b,
    //         _ => a,
    //     };
    // }
}
```

#### 3.3.2 信号の合成セマンティクス

**合成セマンティクス:**
- `let`（不変信号）: 組み合わせ回路として合成（Verilogの`wire`に相当）
- `let mut`/`var`（可変信号）: 順序回路として合成（Verilogの`reg`に相当）

| 記述方法 | 合成結果 |
|----------|----------|
| `let 名前 = 式;` | 組み合わせ回路（wire） |
| `let 名前: 型 = 式;` | 組み合わせ回路（wire） |
| `let mut 名前 = 初期値;` + `sync`ブロック内で代入 | 順序回路（リセット値あり） |
| `var 名前 = 初期値;` + `sync`ブロック内で代入 | 順序回路（リセット値あり） |
| `let mut 名前: 型;` + `sync`ブロック内で代入 | 順序回路（リセット値なし） |
| `var 名前: 型;` + `sync`ブロック内で代入 | 順序回路（リセット値なし） |
| `comb`ブロック内で出力ポートに代入 | 組み合わせ回路（wire） |

#### 3.3.2.1 Multi Drive禁止

IRISでは、同一信号への複数箇所からの駆動（multi drive）をコンパイル時にエラーとして検出する。

**規則:**
- 1つの信号は1つのドライバからのみ駆動可能
- 複数の`comb`ブロックや`sync`ブロックから同一信号への代入は禁止
- 条件分岐内での排他的な代入は許可（同一ブロック内の場合）

**エラー例:**
```rust
mod MultiDriveError {
    in  sel: bit,
    in  a: bit[8],
    in  b: bit[8],
    out result: bit[8],

    // エラー: resultへの複数ドライバ
    comb {
        if sel {
            result = a;  // ドライバ1
        }
    }

    comb {
        if !sel {
            result = b;  // ドライバ2 → コンパイルエラー
        }
    }
}
```

**正しい記述:**
```rust
mod SingleDriver {
    in  sel: bit,
    in  a: bit[8],
    in  b: bit[8],
    out result: bit[8],

    // 正しい: 単一のcombブロック内で完結
    comb {
        result = if sel { a } else { b };
    }
}
```

**意図的な多重駆動:**
トライステートバスなど、意図的に複数ドライバが必要な場合は`tristate`型を使用する。

```rust
mod Counter {
    in  clk: clock,
    in  rst: reset,
    in  enable: bit,
    out count: bit[8],

    // 順序論理（let mut または var 宣言 + syncブロック）
    let mut counter: bit[8] = 0;  // 初期値あり → リセット時に0
    // または: var counter: bit[8] = 0;  // let mutと同義

    sync(clk.posedge, rst.async) {
        if enable {
            counter = counter + 1;
        }
    }

    // 組み合わせ論理（combブロックで出力に代入）
    comb {
        count = counter;
    }
}
```

#### 3.3.3 初期値（オプション）

**宣言形式のバリエーション:**
```rust
// 不変信号（let）
let value1: bit[8];              // 型のみ指定
let value2 = 8'hFF;              // 初期値から型推論（bit[8]）
let value3: bit[8] = 8'hFF;      // 型と初期値の両方を指定

// 可変信号（let mut）
let mut counter1: bit[8];        // 型のみ指定（リセット値なし）
let mut counter2 = 0;            // 初期値から型推論
let mut counter3: bit[8] = 0;    // 型と初期値の両方を指定（リセット時に0）

// 可変信号（var - let mutと同義）
var flag1: bool;                 // 型のみ指定
var flag2 = false;               // 初期値から型推論
var flag3: bool = false;         // 型と初期値の両方を指定（リセット時にfalse）

// 定数
const MAX_VAL: uint = 255;       // コンパイル時定数
```

**初期値の動作:**
- 初期値が設定されている場合、リセット処理で初期値がセットされる
- 初期値がない場合、リセット値は未定義となる

### 3.4 モジュールインスタンス化

#### 3.4.1 インスタンス構文
```ebnf
instance = "inst" identifier [ "[" size "]" ] "=" module_type
           [ generic_args ] "{" port_connections "}" ";" ;
generic_args = "[" generic_arg { "," generic_arg } "]" ;
generic_arg = identifier ":" value ;
port_connections = port_connection { "," port_connection } ;
port_connection = identifier ":" expression ;
```

#### 3.4.2 基本インスタンス
```rust
mod Top {
    in  sys_clk: clock,
    in  sys_rst: reset,
    out led: bit[8],

    // 基本インスタンス化
    inst counter1 = Counter[Width: 8] {
        clk: sys_clk,
        rst: sys_rst,
        enable: 1'b1,
        load: 1'b0,
        load_value: 8'h00,
        count: led,
        overflow: _   // '_' で未使用を明示
    };

    // デフォルトパラメータ使用
    inst counter2 = Counter {
        clk: sys_clk,
        rst: sys_rst,
        enable: enable_sig,
        load: 1'b0,
        load_value: 8'h00,
        count: count_out,
        overflow: overflow_out
    };
}
```

#### 3.4.3 配列インスタンス
```rust
mod Top {
    in  clk: clock,
    in  rst: reset,
    in  enables: bit[4],
    out counts: bit[4][4],

    // 4つのカウンタをインスタンス化
    inst counters[4] = Counter[Width: 4] {
        clk: clk,
        rst: rst,
        enable: enables[..],      // 配列展開
        load: 1'b0,
        load_value: 4'h0,
        count: counts[..],        // 配列展開
        overflow: _
    };
}
```

#### 3.4.4 階層アクセス
```rust
// 子モジュールの信号へのアクセス（デバッグ用）
#[debug_only]
let debug_count = counter1.count_reg;
```

### 3.5 外部モジュール（Verilog連携）

#### 3.5.1 外部モジュール宣言
```rust
// 既存のVerilogモジュールを宣言
extern mod legacy_uart {
    in  clk: clock,
    in  rst_n: reset(active_low),
    in  tx_data: bit[8],
    in  tx_valid: bit,
    out tx_ready: bit,
    out tx: bit
}

// パラメータ付き外部モジュール
extern mod legacy_fifo[DEPTH: uint, WIDTH: uint] {
    in  clk: clock,
    in  rst: reset,
    in  wr_en: bit,
    in  rd_en: bit,
    in  din: bit[WIDTH],
    out dout: bit[WIDTH],
    out full: bit,
    out empty: bit
}
```

#### 3.5.2 外部モジュールの使用
```rust
mod Top {
    in clk: clock,
    in rst: reset,

    // 外部Verilogモジュールをインスタンス化
    inst uart0 = legacy_uart {
        clk: clk,
        rst_n: ~rst,  // 極性変換
        tx_data: data,
        tx_valid: valid,
        tx_ready: ready,
        tx: tx_out
    };

    inst fifo0 = legacy_fifo[DEPTH: 1024, WIDTH: 32] {
        clk: clk,
        rst: rst,
        wr_en: wr_enable,
        rd_en: rd_enable,
        din: write_data,
        dout: read_data,
        full: full_flag,
        empty: empty_flag
    };
}
```

### 3.6 モジュール属性

```rust
// トップモジュール指定
#[top]
mod TopLevel {
    // ...
}

// クロックドメイン指定
#[clock_domain("fast_clk")]
mod HighSpeedProcessor {
    // ...
}

// 合成オプション
#[synthesis(flatten)]
mod SmallModule {
    // 合成時に親モジュールに展開
}

#[synthesis(keep_hierarchy)]
mod ImportantModule {
    // 階層を維持
}
```

---

## 4. インターフェース

### 4.1 インターフェース構文

#### 4.1.1 EBNF定義

```ebnf
interface_decl = "interface" identifier [ generic_params ] [ where_clause ]
                 "{" interface_body "}" ;
interface_body = { signal_decl } { view_decl } ;
signal_decl = identifier ":" type [ "," ] ;
view_decl = "view" view_name "{" view_body "}" ;
view_name = "initiator" | "target" | identifier ;
view_body = { direction_list } ;
direction_list = direction ":" signal_list ;
direction = "in" | "out" | "inout" ;
signal_list = identifier { "," identifier } [ "," ] ;
```

#### 4.1.2 基本定義

```rust
interface AxiLite[AddrWidth: uint = 32, DataWidth: uint = 32] {
    // 書き込みアドレスチャネル
    awaddr:  bit[AddrWidth],
    awvalid: bit,
    awready: bit,

    // 書き込みデータチャネル
    wdata:   bit[DataWidth],
    wstrb:   bit[DataWidth / 8],
    wvalid:  bit,
    wready:  bit,

    // 書き込み応答チャネル
    bresp:   bit[2],
    bvalid:  bit,
    bready:  bit,

    // 読み出しアドレスチャネル
    araddr:  bit[AddrWidth],
    arvalid: bit,
    arready: bit,

    // 読み出しデータチャネル
    rdata:   bit[DataWidth],
    rresp:   bit[2],
    rvalid:  bit,
    rready:  bit,

    // ビュー定義（initiator/targetを使用）
    view initiator {
        out: awaddr, awvalid, wdata, wstrb, wvalid, bready,
             araddr, arvalid, rready,
        in:  awready, wready, bresp, bvalid,
             arready, rdata, rresp, rvalid
    }

    view target {
        in:  awaddr, awvalid, wdata, wstrb, wvalid, bready,
             araddr, arvalid, rready,
        out: awready, wready, bresp, bvalid,
             arready, rdata, rresp, rvalid
    }
}
```

### 4.2 ビュー定義

#### 4.2.1 標準ビュー名

| ビュー名 | 説明 | 用途 |
|----------|------|------|
| `initiator` | トランザクション開始側 | マスターデバイス |
| `target` | トランザクション応答側 | スレーブデバイス |
| `monitor` | 観測専用（全信号入力） | 検証用 |
| カスタム名 | ユーザー定義ビュー | 特殊接続 |

#### 4.2.2 ビュー方向規則

```rust
interface Handshake {
    valid: bit,
    ready: bit,
    data:  bit[8],

    // initiatorはvalidとdataを駆動
    view initiator {
        out: valid, data,
        in:  ready
    }

    // targetはreadyを駆動
    view target {
        in:  valid, data,
        out: ready
    }

    // monitorは全信号を観測
    view monitor {
        in: valid, ready, data
    }
}
```

#### 4.2.3 双方向信号

```rust
interface I2C {
    scl: bit,
    sda: bit,

    view controller {
        out:   scl,
        inout: sda
    }

    view peripheral {
        in:    scl,
        inout: sda
    }
}
```

### 4.3 インターフェースの使用

#### 4.3.1 ポート宣言

```rust
mod AxiMaster {
    in  clk: clock,
    in  rst: reset,
    initiator axi: AxiLite,  // initiatorビューで接続
}

mod AxiSlave {
    in  clk: clock,
    in  rst: reset,
    target axi: AxiLite,  // targetビューで接続
    out reg_out: bit[32][16],
}
```

#### 4.3.2 インターフェース接続

```rust
mod Top {
    in clk: clock,
    in rst: reset,

    // インターフェースインスタンス
    let axi_bus: AxiLite[AddrWidth: 16, DataWidth: 32];

    // モジュールインスタンス化と接続
    inst master = AxiMaster {
        clk: clk,
        rst: rst,
        axi: axi_bus  // 自動的にビューが適用される
    };

    inst slave = AxiSlave {
        clk: clk,
        rst: rst,
        axi: axi_bus,  // 同じバスに接続
        reg_out: registers
    };
}
```

### 4.4 インターフェースの合成

#### 4.4.1 信号展開規則

インターフェースは合成時に個別信号に展開される。

```rust
// IRIS
interface Simple {
    valid: bit,
    data:  bit[8],
    view initiator { out: valid, data }
}

mod Producer {
    initiator out_if: Simple,
}
```
↓
```systemverilog
// 生成されるSystemVerilog
module Producer (
    output logic       out_if_valid,
    output logic [7:0] out_if_data
);
```

#### 4.4.2 命名規則

| パターン | 生成される信号名 |
|----------|------------------|
| `interface_name.signal` | `interface_name_signal` |
| `ports[n].signal` | `ports_n_signal` |
| ネストされた場合 | `outer_inner_signal` |

### 4.5 インターフェース継承とコンポジション

#### 4.5.1 インターフェース継承

```rust
// 基本インターフェース
interface StreamBase {
    valid: bit,
    ready: bit,

    view initiator { out: valid, in: ready }
    view target { in: valid, out: ready }
}

// 拡張インターフェース
interface AxiStream extends StreamBase {
    data:  bit[32],
    last:  bit,
    keep:  bit[4],

    view initiator {
        out: valid, data, last, keep,
        in:  ready
    }
    view target {
        in:  valid, data, last, keep,
        out: ready
    }
}
```

**継承の合成規則:**
- 合成時、継承階層は**フラットな信号集合**として展開される
- 継承元と継承先で同名の信号がある場合はコンパイルエラー
- 多重継承は禁止（単一継承のみ）
- 継承の深さは3レベルまでを推奨

#### 4.5.2 インターフェースのコンポジション

```rust
interface AxiFull {
    // 書き込みチャネル（インターフェースを含む）
    write: AxiWriteChannel,
    // 読み出しチャネル
    read:  AxiReadChannel,

    view initiator {
        // 子インターフェースのビューを参照
        write: initiator,
        read:  initiator
    }
    view target {
        write: target,
        read:  target
    }
}
```

### 4.6 モジュラー接続規則

#### 4.6.1 接続の妥当性チェック

| 接続パターン | 有効性 | 備考 |
|--------------|--------|------|
| initiator ↔ target | 有効 | 標準接続 |
| initiator ↔ initiator | エラー | 駆動競合 |
| target ↔ target | エラー | 駆動なし |
| monitor ↔ any | 有効 | 観測のみ |

---

## 5. 論理記述ブロック

### 5.1 組み合わせ論理

#### 5.1.1 基本構文

IRISでは、組み合わせ論理は`let`宣言または`comb`ブロックで記述します。

**`let`宣言による組み合わせ回路:**
- `let`宣言は組み合わせ回路として合成（Verilogの`wire`に相当）
- 単純な組み合わせ論理に適している

**`comb`ブロックによる組み合わせ回路:**
- 複雑な組み合わせ論理（match式、条件分岐など）を記述する場合に使用
- 完全割り当てチェックが有効

```ebnf
comb_block = "comb" [ default_spec ] "{" { statement } "}" ;
default_spec = "default" "(" identifier_list ")" ;
```

#### 5.1.2 基本形式

**let宣言による組み合わせ回路:**
```rust
mod Adder {
    in  a: bit[8],
    in  b: bit[8],
    out sum: bit[8],
    out carry: bit,

    // let宣言による組み合わせ論理（wireとして合成）
    let sum = a + b;
    let carry = (a.extend[9] + b.extend[9])[8];
}
```

**combブロックによる組み合わせ回路:**
```rust
mod Alu {
    in  a: bit[8],
    in  b: bit[8],
    in  op: bit[2],
    out result: bit[8],

    // 複雑な組み合わせ論理（combブロックで記述）
    comb {
        result = match op {
            2'b00 => a + b,
            2'b01 => a - b,
            2'b10 => a & b,
            _ => a | b,
        };
    }
}
```

**重要: 組み合わせ論理の特徴**
- `let`宣言: 単純な信号の組み合わせに使用（wire）
- `comb`ブロック: 複雑な条件分岐を含む組み合わせ論理に使用
- `comb`ブロック内で代入された信号は組み合わせ回路（wire）として合成
- モジュールスコープで定義され、他の`comb`ブロックや`sync`ブロックから参照可能

#### 5.1.3 完全割り当てチェック

IRISコンパイラは、`comb`ブロック内の信号がすべての実行パスで値を持つことを検証する。

```rust
// エラー: else節がない
comb {
    out = if sel {
        in0
    };  // コンパイルエラー
}
```

```
error[O0001]: incomplete assignment in comb block
  --> src/example.iris:10:11
   |
10 | out = if sel {
11 |     in0
12 | };
   |   ^ 'out' does not have a value when 'sel' is false
   |
   = help: add an else clause
   = note: incomplete assignments cause latches
```

#### 5.1.4 条件付き割り当て

```rust
comb {
    // if-else式（完全なelse必須）
    out = if sel == 2'b00 {
        in0
    } else if sel == 2'b01 {
        in1
    } else if sel == 2'b10 {
        in2
    } else {
        in3  // else必須
    };

    // 三項演算子
    out2 = sel ? in1 : in0;
}
```

#### 5.1.5 match式（パターンマッチング）

```rust
comb {
    out = match sel {
        2'b00 => in0,
        2'b01 => in1,
        2'b10 => in2,
        2'b11 => in3,
        // 網羅性チェック: すべてのパターンをカバー必須
    };
}
```

**網羅性チェック規則:**

| ケース | 要件 |
|--------|------|
| `bit[N]` のmatch | 2^N パターンすべて、または `_`（ワイルドカード） |
| `enum` のmatch | すべてのバリアント、または `_` |
| `bool` のmatch | `true` と `false`、または `_` |

#### 5.1.6 組み合わせ回路ループの検出

```rust
// エラー: 組み合わせ回路ループ
comb {
    a = b + 1;
    b = a + 1;  // エラー: aに依存するbがaに代入される
}
```

### 5.2 順序論理（sync）

#### 5.2.1 syncブロック構文

```ebnf
sync_block = "sync" "(" clock_spec [ "," reset_spec ] ")"
             [ domain_attr ] "{" sync_statements "}" ;
clock_spec = clock_signal "." edge ;
edge = "posedge" | "negedge" ;
reset_spec = reset_signal "." reset_mode ;
reset_mode = "sync" | "async" ;
domain_attr = "@" identifier ;
sync_statements = { sync_statement } ;
sync_statement = assignment | if_statement ;
assignment = identifier "=" expression ";" ;
```

#### 5.2.2 基本形式

```rust
// 基本フリップフロップ
sync(clk.posedge) {
    q = d;
}

// 立下りエッジ
sync(clk.negedge) {
    q = d;
}
```

**重要: syncブロック内の代入規則**
- 代入演算子 `=` を使用（ブロッキング/ノンブロッキングの区別なし）
- syncブロック内の代入はすべてレジスタ更新として合成
- コンパイラが自動的にフリップフロップを推論

#### 5.2.3 リセット指定

| 構文 | リセット種別 | 説明 |
|------|-------------|------|
| `rst.sync` | 同期リセット | クロックエッジでリセット評価 |
| `rst.async` | 非同期リセット | クロックに非同期でリセット |

リセット値は`let`宣言時の初期値から決定される。

```rust
let mut count: bit[8] = 0;  // リセット時は0

// 同期リセット
sync(clk.posedge, rst.sync) {
    count = count + 1;
}

// 非同期リセット
sync(clk.posedge, rst.async) {
    count = count + 1;
    // リセット時は宣言時の初期値（0）
}
```

**合成結果（SystemVerilog相当）:**

```rust
// IRIS
let mut q: bit[8] = 0;

sync(clk.posedge, rst.async) {
    q = d;
}
```
↓
```systemverilog
// 生成されるSystemVerilog
always_ff @(posedge clk or posedge rst) begin
    if (rst)
        q <= 8'h00;
    else
        q <= d;
end
```

#### 5.2.4 リセット極性

```rust
// Active High（デフォルト）
in rst: reset,
sync(clk.posedge, rst.async) { ... }

// Active Low
in rst_n: reset(active_low),
sync(clk.posedge, rst_n.async) { ... }
```

#### 5.2.5 クロックドメイン指定

```rust
// ドメインAのレジスタ
sync(clk_a.posedge) @domain_a {
    reg_a = data_a;
}

// ドメインBのレジスタ
sync(clk_b.posedge) @domain_b {
    reg_b = data_b;
}
```

**クロックドメイン交差（CDC）チェック:**
```rust
// 警告: 異なるドメイン間の直接参照
sync(clk_b.posedge) @domain_b {
    reg_b = reg_a;  // 警告: reg_aはdomain_a
}
```

#### 5.2.6 同期化プリミティブ

```rust
// 2段FFシンクロナイザ
sync(clk_b.posedge) @domain_b {
    reg_b = sync_ff(async_signal, stages: 2);
}

// パルス同期
sync(clk_b.posedge) @domain_b {
    pulse_b = pulse_sync(pulse_a, from: @domain_a);
}
```

### 5.3 FSM（ステートマシン）

#### 5.3.1 fsmブロック構文

```ebnf
fsm_block = "fsm" identifier "(" clock_spec "," reset_spec ")"
            "{" fsm_body "}" ;
fsm_body = state_enum initial_state [ fsm_locals ] transitions_block
           [ output_encoding ] ;
state_enum = "state" "enum" "{" state_list "}" ;
state_list = identifier { "," identifier } [ "," ] ;
initial_state = "initial" ":" identifier ;
fsm_locals = { signal_decl } ;
transitions_block = "transitions" "{" { state_transition } "}" ;
state_transition = identifier "=>" "{" transition_body "}" ;
transition_body = { output_assignment | seq_assignment | when_clause } ;
when_clause = "when" expression "{" "goto" identifier ";" "}" ;
output_encoding = "output" "encoding" ":" encoding_type ;
encoding_type = "binary" | "onehot" | "gray" ;
```

#### 5.3.2 基本構造

```rust
fsm StateMachineName(clk.posedge, rst.async) {
    // 1. 状態定義
    state enum {
        Idle,
        Running,
        Done
    }

    // 2. 初期状態
    initial: Idle

    // 3. ローカル変数（オプション）
    var counter: uint[8] = 0;

    // 4. 状態遷移
    transitions {
        Idle => {
            // 出力（組み合わせ）
            busy = 0;
            done = 0;

            // 遷移条件
            when start {
                goto Running;
            }
        }

        Running => {
            busy = 1;
            done = 0;
            counter = counter + 1;

            when counter >= 100 {
                goto Done;
            }
        }

        Done => {
            busy = 0;
            done = 1;
            counter = 0;

            when ack {
                goto Idle;
            }
        }
    }

    // 5. エンコーディング（オプション）
    output encoding: onehot
}
```

#### 5.3.3 状態エンコーディング

| エンコーディング | 説明 | ビット数 | 用途 |
|------------------|------|----------|------|
| `binary` | 2進エンコーディング | ⌈log₂N⌉ | 状態数が多い場合 |
| `onehot` | ワンホットエンコーディング | N | 高速な状態デコード |
| `gray` | グレイコードエンコーディング | ⌈log₂N⌉ | CDC対応 |

#### 5.3.4 Moore型出力の簡略記法

```rust
fsm Controller(clk.posedge, rst.async) {
    state enum {
        Idle   [busy = 0, done = 0],  // Moore出力
        Run    [busy = 1, done = 0],
        Done   [busy = 0, done = 1]
    }

    initial: Idle

    transitions {
        Idle => { when start { goto Run; } }
        Run  => { when complete { goto Done; } }
        Done => { when ack { goto Idle; } }
    }
}
```

#### 5.3.5 合成結果（SystemVerilog相当）

```rust
// IRIS
fsm Controller(clk.posedge, rst.async) {
    state enum { Idle, Run, Done }
    initial: Idle
    transitions {
        Idle => { busy = 0; when start { goto Run; } }
        Run  => { busy = 1; when complete { goto Done; } }
        Done => { busy = 0; when ack { goto Idle; } }
    }
    output encoding: onehot
}
```
↓
```systemverilog
// 生成されるSystemVerilog
typedef enum logic [2:0] {
    STATE_IDLE = 3'b001,
    STATE_RUN  = 3'b010,
    STATE_DONE = 3'b100
} state_t;

state_t state, next_state;

// 状態レジスタ
always_ff @(posedge clk or posedge rst) begin
    if (rst)
        state <= STATE_IDLE;
    else
        state <= next_state;
end

// 次状態ロジック
always_comb begin
    next_state = state;
    case (state)
        STATE_IDLE: if (start) next_state = STATE_RUN;
        STATE_RUN:  if (complete) next_state = STATE_DONE;
        STATE_DONE: if (ack) next_state = STATE_IDLE;
    endcase
end

// 出力ロジック
always_comb begin
    case (state)
        STATE_IDLE: busy = 0;
        STATE_RUN:  busy = 1;
        STATE_DONE: busy = 0;
    endcase
end
```

---

## 6. 演算子

### 6.1 算術演算子

| 演算子 | 説明 | 結果幅 | 合成可能 |
|--------|------|--------|----------|
| `a + b` | 加算 | max(width(a), width(b)) | Yes |
| `a - b` | 減算 | max(width(a), width(b)) | Yes |
| `a * b` | 乗算 | width(a) + width(b) | Yes |
| `a / b` | 除算 | width(a) | 条件付き |
| `a % b` | 剰余 | width(b) | 条件付き |
| `a ** n` | べき乗 | 可変 | 定数nのみ |

**オーバーフロー制御メソッド:**

```rust
// キャリー付き加算
let extended_sum = a.extend[9] + b.extend[9];  // bit[9]
let result = extended_sum[7:0];
let carry = extended_sum[8];

// 飽和演算
let sat_sum = (a.extend[9] + b.extend[9]).saturate[8];

// 明示的切り詰め
let trunc_prod = (a * b).truncate[8];  // bit[8]
```

### 6.2 ビット演算子

#### 6.2.1 論理演算

| 演算子 | 説明 | 例 | 結果 |
|--------|------|-----|------|
| `~a` | ビット反転 | `~4'b1010` | `4'b0101` |
| `a & b` | ビットAND | `4'b1100 & 4'b1010` | `4'b1000` |
| `a \| b` | ビットOR | `4'b1100 \| 4'b1010` | `4'b1110` |
| `a ^ b` | ビットXOR | `4'b1100 ^ 4'b1010` | `4'b0110` |
| `a ~^ b` | ビットXNOR | `4'b1100 ~^ 4'b1010` | `4'b1001` |

#### 6.2.2 シフト演算

| 演算子 | 説明 | 符号ビット |
|--------|------|-----------|
| `a << n` | 論理左シフト | 0埋め |
| `a >> n` | 論理右シフト | 0埋め |
| `a >>> n` | 算術右シフト | 符号拡張 |

#### 6.2.3 リダクション演算

| メソッド | 説明 | 例 |
|----------|------|-----|
| `.and_reduce()` | 全ビットAND | `4'b1111.and_reduce()` = `1` |
| `.or_reduce()` | 全ビットOR | `4'b0001.or_reduce()` = `1` |
| `.xor_reduce()` | パリティ | `4'b1101.xor_reduce()` = `1` |
| `.nand_reduce()` | 全ビットNAND | `4'b1111.nand_reduce()` = `0` |
| `.nor_reduce()` | 全ビットNOR | `4'b0000.nor_reduce()` = `1` |
| `.xnor_reduce()` | 偶パリティ | `4'b1100.xnor_reduce()` = `1` |

### 6.3 比較演算子

| 演算子 | 説明 | デフォルト解釈 |
|--------|------|---------------|
| `==` | 等価 | - |
| `!=` | 不等価 | - |
| `<` | 未満 | 符号なし |
| `<=` | 以下 | 符号なし |
| `>` | より大きい | 符号なし |
| `>=` | 以上 | 符号なし |
| `===` | 厳密等価（検証用） | X/Zも比較 |
| `!==` | 厳密不等価（検証用） | X/Zも比較 |

### 6.4 ビット選択とスライス

```rust
let data: bit[32] = 32'hDEADBEEF;

// 単一ビット選択
let bit0 = data[0];    // LSB
let bit31 = data[31];  // MSB

// 固定スライス
let byte0 = data[7:0];     // 下位8ビット
let byte3 = data[31:24];   // 上位8ビット

// 動的スライス（パート選択）
let byte_n = data[byte_idx * 8 +: 8];
```

### 6.5 連結とレプリケーション

```rust
// 基本連結
let combined: bit[16] = {high_byte, low_byte};

// 複数要素
let word: bit[32] = {byte3, byte2, byte1, byte0};

// レプリケーション
let zeros: bit[32] = {32{1'b0}};     // 全ビット0
let pattern: bit[32] = {4{8'hAB}};   // 32'hABABABAB

// 連結代入
let high: bit[8];
let low: bit[8];
{high, low} = 16'hABCD;  // high=0xAB, low=0xCD
```

### 6.6 演算子優先順位

| 優先度 | 演算子 | 結合性 | 説明 |
|--------|--------|--------|------|
| 1 (最高) | `()` `[]` `.` `::` | 左 | グループ化、添字、メンバ、スコープ |
| 2 | `!` `~` `-` (単項) | 右 | 論理NOT、ビットNOT、符号反転 |
| 3 | `**` | 右 | べき乗 |
| 4 | `*` `/` `%` | 左 | 乗除算 |
| 5 | `+` `-` | 左 | 加減算 |
| 6 | `<<` `>>` `>>>` | 左 | シフト |
| 7 | `<` `<=` `>` `>=` | 左 | 比較 |
| 8 | `==` `!=` `===` `!==` | 左 | 等価 |
| 9 | `&` | 左 | ビットAND |
| 10 | `^` `~^` | 左 | ビットXOR/XNOR |
| 11 | `\|` | 左 | ビットOR |
| 12 | `&&` | 左 | 論理AND |
| 13 | `\|\|` | 左 | 論理OR |
| 14 | `?:` | 右 | 三項条件 |
| 15 (最低) | `=` | 右 | 代入 |

---

## 7. 検証機能

### 7.1 テスト構文

#### 7.1.1 基本テストブロック

```rust
#[test]
test check_counter() {
    // DUTのインスタンス化
    let dut = Counter[Width: 8].create();

    // クロック生成
    let clk = Clock.new(period: 10.ns);
    dut.clk = clk;

    // リセットシーケンス
    dut.rst.assert();
    await clk.cycles(5);
    dut.rst.deassert();
    await clk.cycles(1);

    // テスト刺激
    dut.enable = 1;
    await clk.cycles(10);

    // 検証
    assert dut.count == 8'h0A;
}
```

#### 7.1.2 テストアトリビュート

| アトリビュート | 説明 | 例 |
|----------------|------|-----|
| `#[test]` | テストブロック宣言 | 必須 |
| `#[timeout(1.ms)]` | タイムアウト指定 | デッドロック防止 |
| `#[should_fail]` | 失敗を期待 | ネガティブテスト |
| `#[ignore]` | テストをスキップ | 一時的に無効化 |
| `#[parametric]` | パラメトリックテスト | 複数条件テスト |

#### 7.1.3 パラメトリックテスト

```rust
#[test]
#[parametric]
test counter_various_widths[Width in [4, 8, 16, 32]]() {
    let dut = Counter[Width].create();
    let clk = Clock.new(period: 10.ns);

    dut.clk = clk;
    dut.rst.assert();
    await clk.cycles(5);
    dut.rst.deassert();

    // 最大値までカウント
    dut.enable = 1;
    let max_count = (1 << Width) - 1;
    await clk.cycles(max_count);

    assert dut.count == max_count as bit[Width];
}
```

#### 7.1.4 シミュレーション制御

```rust
// 時間単位
let period = 10.ns;      // ナノ秒
let delay = 1.us;        // マイクロ秒
let timeout = 100.ms;    // ミリ秒

// クロック生成
let clk = Clock.new(period: 10.ns);

// クロックサイクル待機
await clk.cycles(10);              // 10サイクル待機
await clk.posedge();               // 次の立ち上がりまで待機

// 条件待機
await until(dut.ready == 1);       // 条件成立まで待機
await until(dut.done == 1, timeout: 1.ms);  // タイムアウト付き

// 並列実行
fork {
    // タスク1
    await send_data(dut, data);
}
join {
    // タスク2
    await receive_response(dut);
}
```

### 7.2 アサーション

#### 7.2.1 即時アサーション

```rust
// 基本アサーション
assert data != 0;
assert count < MAX_VALUE;

// エラーメッセージ付き
assert data != 0 else error("Data must be non-zero");

// expect（ソフトアサーション、失敗してもテスト継続）
expect response == expected else {
    log("Mismatch: got {response}, expected {expected}");
    error_count += 1;
}
```

#### 7.2.2 並行アサーション

```rust
// 基本形式
@(clk.posedge) assert req |=> ack;

// 遅延指定
@(clk.posedge) assert req |=> ##1 ack;          // 1サイクル後
@(clk.posedge) assert req |=> ##[1:3] ack;      // 1〜3サイクル後

// エラーメッセージ
@(clk.posedge) assert req |=> ##[1:2] ack
    else error("Protocol violation: ack not received within 2 cycles");
```

#### 7.2.3 プロパティ

```rust
// プロパティ定義
property handshake_protocol {
    valid |=> ##[0:$] ready |=> ##1 !valid
}

// プロパティの使用
@(clk.posedge) assert handshake_protocol;

// パラメトリックプロパティ
property response_time[MaxDelay: uint] {
    req |=> ##[1:MaxDelay] ack
}

@(clk.posedge) assert response_time[10];
```

#### 7.2.4 シーケンス

```rust
// シーケンス定義
sequence burst_transfer {
    start ##1 data[*4] ##1 end
}

// 繰り返し演算子
// [*n]    : 正確にn回
// [*n:m]  : n〜m回
// [*n:$]  : n回以上
// [+]     : 1回以上（[*1:$]と同等）
// [*]     : 0回以上
```

#### 7.2.5 assume/restrict

```rust
// 入力制約（フォーマル検証用）
@(clk.posedge) assume valid |-> !$isunknown(data);
@(clk.posedge) assume $onehot(grant);

// 環境制約
@(clk.posedge) restrict reset |=> ##[1:5] !reset;
```

### 7.3 カバレッジ

#### 7.3.1 カバーポイント

```rust
// 基本カバーポイント
@(clk.posedge) cover state == State::Error;
@(clk.posedge) cover valid && ready;

// 条件付きカバー
@(clk.posedge) cover (addr >= 16'h1000 && addr < 16'h2000)
    iff (valid == 1);
```

#### 7.3.2 カバーグループ

```rust
covergroup TransactionCoverage(clk: clock) {
    // オプション
    option.per_instance = true;
    option.goal = 100;

    // カバーポイント: 自動ビン
    coverpoint cmd: opcode;  // 全enum値を自動カバー

    // カバーポイント: カスタムビン
    coverpoint addr_range: addr {
        bins low    = [0:255];
        bins mid    = [256:65279];
        bins high   = [65280:65535];
        bins corner = {0, 255, 65535};  // コーナーケース
        illegal_bins reserved = [16'hFF00:16'hFFFF];
    }

    // カバーポイント: 遷移
    coverpoint state_trans: state {
        bins idle_to_run   = (Idle => Run);
        bins run_to_done   = (Run => Done);
        bins any_to_error  = (any => Error);
    }

    // クロスカバレッジ
    cross cmd_addr: cmd, addr_range;
}
```

### 7.4 ランダム化

```rust
// 基本ランダム値
let rand_val: bit[8] = $random();
let rand_range = $random_range(0, 100);

// 制約付きランダム
constraint valid_addr {
    addr >= 16'h0000;
    addr < 16'h8000;
    addr % 4 == 0;  // 4バイトアライン
}

let rand_addr: bit[16];
randomize(rand_addr) with valid_addr;

// 重み付きランダム
let weighted_op = $dist_weighted([
    (OpCode::Read,  70),   // 70%
    (OpCode::Write, 25),   // 25%
    (OpCode::Nop,   5)     // 5%
]);
```

---

## 8. パッケージシステム

### 8.1 パッケージ定義

```rust
// src/common/mod.iris
package common;

//! このパッケージは共通の型と定数を定義します

/// 8ビットデータ型
pub type Byte = bit[8];

/// 32ビットワード型
pub type Word = bit[32];

/// 演算コード列挙型
pub enum OpCode: bit[4] {
    Add  = 4'h0,
    Sub  = 4'h1,
    And  = 4'h2,
    Or   = 4'h3,
    Xor  = 4'h4,
    Nop  = 4'hF,
}

/// パリティ計算関数
pub fn parity(data: Byte) -> bit {
    return data.xor_reduce();
}
```

### 8.2 可視性制御

| 修飾子 | 可視範囲 | 用途 |
|--------|----------|------|
| なし | 同一パッケージ内のみ | 内部実装 |
| `pub` | どこからでもアクセス可能 | 公開API |
| `pub(crate)` | 同一クレート内のみ | クレート内共有 |
| `pub(super)` | 親パッケージまで | 限定公開 |
| `pub(in path)` | 指定パスまで | 詳細制御 |

### 8.3 インポート

```rust
// 単一アイテムのインポート
import common::Word;
import common::OpCode;

// 複数アイテムのインポート
import common::{Word, OpCode, Byte};

// ワイルドカードインポート（非推奨）
import common::*;

// エイリアス付きインポート
import common::Word as DataWord;
import vendor_ip::AXI4 as Axi;

// 完全修飾名でのアクセス
import common;
let data: common::Word = 32'h0;

// ネストされたパッケージ
import mylib::protocols::axi::AxiLite;
import mylib::protocols::axi::{AxiLite, AxiStream};
```

### 8.4 再エクスポート

```rust
// src/lib.iris
package mylib;

// 公開再エクスポート
pub import common::Word;
pub import common::OpCode;

// 内部パッケージを公開
pub mod protocols;
pub mod utils;
```

---

## 9. プロジェクト構成

### 9.1 ディレクトリ構造

```
project/
├── iris.toml               # プロジェクト設定（必須）
├── iris.lock               # 依存関係ロックファイル（自動生成）
├── src/
│   ├── lib.iris            # ライブラリルート
│   ├── main.iris           # バイナリ（合成トップ）
│   ├── common/
│   │   ├── mod.iris        # サブモジュール定義
│   │   └── types.iris
│   └── rtl/
│       ├── mod.iris
│       ├── cpu.iris
│       └── peripherals/
├── test/
│   ├── unit/               # ユニットテスト
│   ├── integration/        # 統合テスト
│   └── formal/             # フォーマル検証
├── bench/                  # ベンチマーク
├── constraints/
│   ├── timing.sdc          # タイミング制約
│   ├── pinout.xdc          # ピン配置（Xilinx）
│   └── floorplan.tcl       # フロアプラン
├── scripts/
├── doc/
├── ip/                     # 外部IP
├── sim/                    # シミュレーション出力
└── build/                  # ビルド出力
```

### 9.2 設定ファイル（iris.toml）

```toml
[package]
name = "my_soc"
version = "1.0.0"
authors = ["Developer <dev@example.com>"]
license = "MIT"
description = "Example SoC design"
edition = "2025"

# 依存関係
[dependencies]
iris_std = "1.0"
iris_axi = { version = "2.0", features = ["lite", "stream"] }
riscv_core = { git = "https://github.com/example/riscv", tag = "v1.0" }
vendor_ip = { path = "../vendor_ip" }

# 開発時のみの依存
[dev-dependencies]
iris_test = "1.0"
iris_coverage = "1.0"

# オプション機能
[features]
default = ["uart"]
uart = []
spi = []
ethernet = ["iris_eth"]
full = ["uart", "spi", "ethernet"]

# 合成設定
[synthesis]
target = "xilinx_ultrascale_plus"
device = "xczu7ev-ffvc1156-2-e"
top_module = "SocTop"
output_format = "edif"

# クロック定義
[[synthesis.clocks]]
name = "sys_clk"
period = "10.0ns"
uncertainty = "0.5ns"

# シミュレーション設定
[simulation]
default_timescale = "1ns/1ps"
default_timeout = "10ms"
waveform_format = "vcd"
coverage = ["line", "branch", "toggle", "fsm"]
```

### 9.3 依存関係管理

```toml
[dependencies]
# レジストリから（バージョン指定）
iris_std = "1.0"
iris_std = ">=1.0, <2.0"

# Gitリポジトリから
riscv_core = { git = "https://github.com/example/riscv", tag = "v1.0" }

# ローカルパスから
vendor_ip = { path = "../vendor_ip" }

# オプション依存
iris_eth = { version = "1.0", optional = true }

# フィーチャー付き
iris_axi = { version = "2.0", features = ["lite", "stream"] }
```

### 9.4 ビルドプロファイル

```toml
# デバッグビルド（デフォルト）
[profile.debug]
optimization = 0
debug_info = true
assertions = true

# リリースビルド
[profile.release]
optimization = 3
debug_info = false
assertions = false
lto = true

# 合成ビルド
[profile.synthesis]
optimization = 3
remove_unused = true
flatten = true
```

### 9.5 ワークスペース

```toml
# workspace/iris.toml
[workspace]
members = [
    "cpu",
    "peripherals",
    "soc",
]

# 共通依存関係
[workspace.dependencies]
iris_std = "1.0"
iris_axi = "2.0"
```

---

## 10. メモリ定義

### 10.1 メモリ宣言

```rust
// シンプルなメモリ
mem storage: bit[32][1024];       // 1024ワード × 32ビット

// 構造体配列
mem packet_buffer: PacketHeader[256];

// 多次元メモリ
mem cache: bit[64][4][256];       // 4ウェイ × 256エントリ × 64ビット
```

### 10.2 RAM/ROM

#### 10.2.1 RAM（読み書き可能）

```rust
mod Ram[DataWidth: uint = 32, Depth: uint = 1024] {
    in  clk: clock,
    in  we: bit,
    in  addr: bit[$clog2(Depth)],
    in  wdata: bit[DataWidth],
    out rdata: bit[DataWidth],

    mem storage: bit[DataWidth][Depth];

    sync(clk.posedge) {
        if we {
            storage[addr] = wdata;
        }
        rdata = storage[addr];
    }
}
```

#### 10.2.2 ROM（読み取り専用）

```rust
mod Rom[DataWidth: uint = 8, Depth: uint = 256] {
    in  clk: clock,
    in  addr: bit[$clog2(Depth)],
    out data: bit[DataWidth],

    // 初期化付きROM
    const lookup: bit[DataWidth][Depth] = [
        8'h00, 8'h01, 8'h03, 8'h07,  // ...
    ];

    sync(clk.posedge) {
        data = lookup[addr];
    }
}

// ファイルから初期化
mod RomFromFile {
    in clk: clock,
    in addr: bit[10],
    out data: bit[32],

    const rom_data: bit[32][1024] {
        init_file: "rom_contents.hex"
    };

    sync(clk.posedge) {
        data = rom_data[addr];
    }
}
```

### 10.3 読み出しモード

| モード | 説明 | 動作 |
|--------|------|------|
| `read_first` | 読み出し優先（デフォルト） | 書き込み前の値を読み出し |
| `write_first` | 書き込み優先 | 書き込み後の値を読み出し |
| `no_change` | 変更なし | 書き込み時は読み出し値を保持 |

```rust
mem ram_rf: bit[32][1024] {
    read_mode: read_first
};

mem ram_wf: bit[32][1024] {
    read_mode: write_first
};
```

### 10.4 ポート構成

#### 10.4.1 シングルポートRAM

```rust
mem single_port: bit[32][1024] {
    ports: 1
};
```

#### 10.4.2 シンプルデュアルポートRAM

```rust
mem storage: bit[Width][Depth] {
    ports: 2,
    type: simple_dual_port
};
```

#### 10.4.3 真デュアルポートRAM

```rust
mem storage: bit[Width][Depth] {
    ports: 2,
    type: true_dual_port,
    read_mode: read_first
};
```

### 10.5 初期化

```rust
// 配列リテラルによる初期化
const sine_table: bit[8][16] = [
    8'd128, 8'd177, 8'd218, 8'd246,
    8'd255, 8'd246, 8'd218, 8'd177,
    8'd128, 8'd79,  8'd38,  8'd10,
    8'd0,   8'd10,  8'd38,  8'd79
];

// 繰り返し初期化
mem zeros: bit[32][1024] = [0; 1024];

// ファイル初期化
const rom_hex: bit[32][1024] {
    init_file: "data.hex",
    format: hex
};
```

### 10.6 RAMスタイルアトリビュート

| スタイル | 説明 | 用途 |
|----------|------|------|
| `block` | ブロックRAM | 大容量メモリ |
| `distributed` | 分散RAM（LUT） | 小容量・高速 |
| `ultra` | UltraRAM | 超大容量（FPGA固有） |
| `registers` | レジスタ配列 | 最小遅延 |
| `auto` | 自動選択（デフォルト） | ツール判断 |

```rust
#[synthesis(ram_style = "block")]
mem large_buffer: bit[64][8192];

#[synthesis(ram_style = "distributed")]
mem small_fifo: bit[32][32];
```

---

## 11. 合成アトリビュート

### 11.1 階層制御

| アトリビュート | 説明 | 適用対象 |
|----------------|------|----------|
| `#[synthesis(keep)]` | 最適化で削除しない | 信号、モジュール |
| `#[synthesis(dont_touch)]` | 完全に最適化禁止 | 信号、モジュール |
| `#[synthesis(flatten)]` | 階層を展開 | モジュール |
| `#[synthesis(keep_hierarchy)]` | 階層を維持 | モジュール |

```rust
#[synthesis(keep)]
let mut debug_probe: bit[32];

#[synthesis(flatten)]
mod SmallHelper { ... }

#[synthesis(keep_hierarchy)]
mod ImportantBlock { ... }
```

### 11.2 リソース制御

```rust
// RAMスタイル指定
#[synthesis(ram_style = "block")]
mem large_ram: bit[32][4096];

// FSMエンコーディング
#[synthesis(fsm_encoding = "onehot")]
fsm Controller { ... }

// レジスタ複製（ファンアウト制御）
#[synthesis(max_fanout = 32)]
let high_fanout_signal: bit;

// DSP使用制御
#[synthesis(use_dsp = true)]
let product = a * b;
```

### 11.3 タイミング制御

```rust
// 非同期入力（フォールスパス）
#[timing(false_path)]
in async_reset: reset;

// マルチサイクルパス
#[timing(multicycle_path = 2)]
let mut slow_data: bit[64];

// 最大遅延指定
#[timing(max_delay = "5.0ns")]
let critical_path_signal: bit;
```

### 11.4 クロックドメイン

```rust
// クロックドメイン指定
#[clock_domain("core_clk")]
mod CpuCore {
    in clk: clock,
    // このモジュール全体がcore_clkドメイン
}

// CDC警告抑制
#[allow(cdc_crossing)]
sync(clk_b.posedge) {
    synced_data = raw_data;  // 意図的なCDC
}
```

### 11.5 I/O制約

```rust
// I/O標準
#[io(standard = "LVCMOS33")]
in gpio: bit[8];

#[io(standard = "LVDS_25", diff_term = true)]
in lvds_clk: clock;

// スルーレート・ドライブ強度
#[io(standard = "LVCMOS18", slew = "fast", drive = 12)]
out high_speed_out: bit;

// プルアップ・プルダウン
#[io(pullup)]
in button: bit;
```

### 11.6 デバッグアトリビュート

```rust
// デバッグプローブ
#[debug(probe)]
let internal_state: bit[32];

// ILAマーク
#[debug(ila, depth = 4096, trigger = "data_valid")]
let trace_data: bit[64];

// VIO（仮想I/O）
#[debug(vio)]
let virtual_input: bit[8];

// デバッグ専用（合成時に削除）
#[debug_only]
mod DebugMonitor { ... }
```

### 11.7 条件付きコンパイル

```rust
// フィーチャーフラグ
#[cfg(feature = "debug")]
mod DebugLogic { ... }

// ターゲットデバイス
#[cfg(target = "xilinx")]
#[synthesis(use_dsp48)]
let product = a * b;

// 合成/シミュレーション切り替え
#[cfg(synthesis)]
const DELAY: uint = 0;

#[cfg(simulation)]
const DELAY: uint = 10;

// 複合条件
#[cfg(all(feature = "uart", target = "xilinx"))]
mod XilinxUart { ... }
```

### 11.8 アトリビュート優先順位規則

| 優先度 | 設定ソース | 説明 |
|--------|-----------|------|
| 1（最高） | ソースコード内アトリビュート | `#[synthesis(...)]` |
| 2 | iris.toml のモジュール固有設定 | `[synthesis.modules.ModuleName]` |
| 3（最低） | iris.toml のグローバル設定 | `[synthesis]` |

---

## 12. リテラル表記

```rust
// 整数リテラル
let a: bit[8] = 8'b1010_1100;    // 2進数
let b: bit[16] = 16'hABCD;       // 16進数
let c: bit[32] = 32'd1234567;    // 10進数
let d: bit[8] = 8'o177;          // 8進数

// 幅推論
let e: bit[8] = 'hFF;            // 幅は型から推論

// X/Z値（検証専用）
let f: bit[4] = 4'bxx01;
let g: bit[4] = 4'bzzzz;

// 文字列
let s: string = "Hello, IRIS!";

// 配列
let arr: bit[8][4] = [8'h01, 8'h02, 8'h03, 8'h04];
let zeros: bit[8][16] = [0; 16];  // 繰り返し
```

---

## 13. エラーメッセージ形式

```
error[O0001]: incomplete signal assignment in combinational block
  --> src/alu.iris:42:5
   |
42 | comb {
43 |     if sel == 2'b00 {
44 |         out = in0;
45 |     } else if sel == 2'b01 {
46 |         out = in1;
47 |     }
   |     ^ 'out' is not assigned when sel == 2'b10 or 2'b11
   |
   = help: add remaining cases or use 'comb default(...)' to specify a default value
   = note: incomplete assignments create latches which are usually unintended
```

---

## 14. 言語リファレンス

### 14.1 完全文法定義（EBNF）

#### 14.1.1 トップレベル構文

```ebnf
source_file = { item } ;
item = visibility_modifier ( mod_def | type_def | const_def | fn_def
     | interface_def | package_decl | import_decl | test_def ) ;

visibility_modifier = [ "pub" [ "(" visibility_scope ")" ] ] ;
visibility_scope = "crate" | "super" | "in" path ;
```

#### 14.1.2 モジュール定義

```ebnf
mod_def = [ attribute ] "mod" identifier [ generic_params ] "{"
          { port_decl | mod_item }
          "}" ;

generic_params = "[" generic_param { "," generic_param } "]" ;
generic_param = identifier ":" generic_bound [ "=" default_value ] ;
generic_bound = "type" | "uint" | "int" | "bool" | type_expr ;

port_decl = port_direction identifier ":" type_expr [ "," ] ;
port_direction = "in" | "out" | "inout" ;

mod_item = signal_decl | const_decl | type_alias | logic_block
         | inst_decl | mem_decl | fsm_block ;
```

#### 14.1.3 信号・変数宣言

```ebnf
signal_decl = let_decl | var_decl ;
let_decl = "let" [ "mut" ] identifier [ ":" type_expr ] [ "=" expr ] ";" ;
var_decl = "var" identifier [ ":" type_expr ] [ "=" expr ] ";" ;
const_decl = "const" identifier ":" type_expr "=" expr ";" ;
type_alias = "type" identifier [ generic_params ] "=" type_expr ";" ;
```

**宣言形式:**
- `let 名前: 型;` - 不変信号（型のみ指定）
- `let 名前 = 初期値;` - 不変信号（型推論）
- `let 名前: 型 = 初期値;` - 不変信号（型と初期値）
- `let mut 名前: 型;` - 可変信号（型のみ指定）
- `let mut 名前 = 初期値;` - 可変信号（型推論）
- `let mut 名前: 型 = 初期値;` - 可変信号（型と初期値）
- `var 名前: 型;` - 可変信号（`let mut`と同義）
- `var 名前 = 初期値;` - 可変信号（`let mut`と同義）
- `var 名前: 型 = 初期値;` - 可変信号（`let mut`と同義）

※ `var`は`let mut`のシンタックスシュガー（同義）。

#### 14.1.4 論理ブロック

```ebnf
logic_block = signal_decl | comb_block | sync_block ;

comb_block = "comb" "{" { statement } "}" ;
sync_block = "sync" "(" clock_spec [ "," reset_spec ] ")" "{" { statement } "}" ;
clock_spec = expr "." ( "posedge" | "negedge" ) ;
reset_spec = expr "." ( "async" | "sync" ) ;
```

#### 14.1.5 FSM

```ebnf
fsm_block = "fsm" identifier "(" clock_spec [ "," reset_spec ] ")" "{"
            state_enum transitions_block { output_block }
            "}" ;
state_enum = "state" "enum" "{" state_item { "," state_item } "}" ;
state_item = identifier [ moore_outputs ] ;
moore_outputs = "[" output_assign { "," output_assign } "]" ;
output_assign = identifier "=" const_expr ;

transitions_block = "transitions" "{" { transition_item } "}" ;
transition_item = identifier "=>" "{" { when_clause } "}"
                | "_" "=>" "{" statement "}" ;
when_clause = "when" expr "{" { transition_action } "}" ;
transition_action = "goto" identifier ";" | statement ;
```

#### 14.1.6 文

```ebnf
statement = assign_stmt | if_stmt | match_stmt | for_stmt | while_stmt
          | return_stmt | block_stmt ;

assign_stmt = lvalue "=" expr ";" ;
lvalue = identifier | index_expr | field_expr | "{" lvalue_list "}" ;

if_stmt = "if" expr "{" { statement } "}" [ "else" ( if_stmt | block_stmt ) ] ;
match_stmt = "match" expr "{" { match_arm } "}" ;
match_arm = pattern "=>" ( expr "," | block_stmt ) ;

for_stmt = "for" identifier "in" range_expr "{" { statement } "}" ;
range_expr = expr ".." expr | expr "..=" expr ;
```

### 14.2 サンプルコード集

#### 14.2.1 基本的なカウンタ

```rust
/// 8ビットカウンタ
mod Counter8 {
    in  clk: clock,
    in  rst: reset,
    in  enable: bit,
    out count: bit[8],

    let mut counter: bit[8] = 0;

    sync(clk.posedge, rst.async) {
        if enable {
            counter = counter + 1;
        }
    }

    comb {
        count = counter;
    }
}
```

#### 14.2.2 パラメータ化FIFO

```rust
/// 同期FIFO
mod SyncFifo[Width: uint = 8, Depth: uint = 16] {
    in  clk: clock,
    in  rst: reset,
    in  push: bit,
    in  pop: bit,
    in  din: bit[Width],
    out dout: bit[Width],
    out full: bit,
    out empty: bit,

    const ADDR_WIDTH: uint = $clog2(Depth);

    mem buffer: bit[Width][Depth];
    let mut wr_ptr: bit[ADDR_WIDTH] = 0;
    let mut rd_ptr: bit[ADDR_WIDTH] = 0;
    let mut count: bit[ADDR_WIDTH + 1] = 0;

    sync(clk.posedge, rst.async) {
        if push && !full {
            buffer[wr_ptr] = din;
            wr_ptr = wr_ptr + 1;
            count = count + 1;
        }
        if pop && !empty {
            rd_ptr = rd_ptr + 1;
            count = count - 1;
        }
    }

    comb {
        dout = buffer[rd_ptr];
        full = count == Depth;
        empty = count == 0;
    }
}
```

#### 14.2.3 UARTトランスミッタ制御FSM

```rust
mod UartTxFsm {
    in  clk: clock,
    in  rst: reset,
    in  start: bit,
    in  bit_done: bit,
    in  byte_done: bit,
    out tx_en: bit,
    out shift_en: bit,
    out busy: bit,

    fsm Controller(clk.posedge, rst.async) {
        state enum {
            Idle    [tx_en = 0, shift_en = 0, busy = 0],
            Start   [tx_en = 1, shift_en = 0, busy = 1],
            Data    [tx_en = 1, shift_en = 1, busy = 1],
            Stop    [tx_en = 1, shift_en = 0, busy = 1]
        }

        initial: Idle

        transitions {
            Idle => {
                when start { goto Start; }
            }
            Start => {
                when bit_done { goto Data; }
            }
            Data => {
                when byte_done { goto Stop; }
            }
            Stop => {
                when bit_done { goto Idle; }
            }
        }
    }
}
```

---

## 15. エラーメッセージ体系

### 15.1 エラーコード体系

| 範囲 | カテゴリ | 説明 |
|------|----------|------|
| O0001-O0999 | 構文エラー | パース時のエラー |
| O1001-O1999 | 型エラー | 型チェック時のエラー |
| O2001-O2999 | 論理エラー | 組み合わせ/順序論理のエラー |
| O3001-O3999 | FSMエラー | ステートマシンのエラー |
| O4001-O4999 | インターフェースエラー | インターフェース接続エラー |
| O5001-O5999 | 合成エラー | 合成不可能な構文 |
| O6001-O6999 | リンクエラー | モジュール解決エラー |

### 15.2 主要エラー詳細

#### O0001: 組み合わせブロックでの不完全な信号割り当て

```
error[O0001]: incomplete signal assignment in combinational block
  --> src/alu.iris:42:5
   |
42 | comb {
43 |     if sel == 2'b00 {
44 |         out = in0;
45 |     }
   |     ^ 'out' is not assigned when sel != 2'b00
   |
   = help: add 'else' clause or use 'comb default(out = 0)'
   = note: incomplete assignments infer latches
```

**原因:** combブロック内で全てのパスで信号に値が割り当てられていない

**修正方法:**
1. else句を追加して全パスをカバー
2. `comb default(signal = value)`でデフォルト値を指定
3. match式を使用して全ケースを網羅

#### O1001: 型の不一致

```
error[O1001]: type mismatch
  --> src/counter.iris:15:12
   |
15 |     count = count + 1;
   |             ^^^^^^^^^ expected `bit[8]`, found `bit[9]`
   |
   = help: use explicit truncation: `(count + 1).truncate[8]()`
   = note: IRIS does not allow implicit narrowing conversions
```

**原因:** 右辺の式の型が左辺の型より広い

**修正方法:**
1. `.truncate[N]()`で明示的に切り捨て
2. `.resize[N]()`で符号拡張/ゼロ拡張付きリサイズ
3. 左辺の型を拡張

#### O2001: 組み合わせ回路ループ

```
error[O2001]: combinational loop detected
  --> src/logic.iris:10:5
   |
10 |     a = b & c;
11 |     b = a | d;
   |     ^^^^^^^^^ 'b' depends on 'a' which depends on 'b'
   |
   = help: break the loop by inserting a register
   = note: combinational loops cause simulation non-convergence
```

### 15.3 警告一覧

| コード | 説明 | デフォルト |
|--------|------|-----------|
| W0001 | 未使用信号 | 有効 |
| W0002 | 未使用パラメータ | 有効 |
| W0003 | 暗黙の型拡張 | 有効 |
| W0004 | 深いネスト（>5レベル） | 無効 |
| W0005 | 大規模なバレルシフタ生成 | 有効 |
| W0006 | クロックドメイン交差の可能性 | 有効 |
| W0007 | 高ファンアウト信号 | 有効 |

### 15.4 警告の制御

```rust
// ファイルレベルで警告を抑制
#![allow(W0001)]

// 特定の項目で抑制
#[allow(W0001)]
let _unused_debug: bit[32];

// 警告をエラーに昇格
#![deny(W0006)]
```

---

## 16. SystemVerilog移行ガイド

### 16.1 基本的な対応表

#### 16.1.1 モジュール宣言

| SystemVerilog | IRIS |
|---------------|------|
| `module name #(parameter P=1) (input a, output b);` | `mod Name[P: uint = 1] { in a: bit, out b: bit }` |
| `input [7:0] data` | `in data: bit[8]` |
| `output reg [7:0] q` | `out q: bit[8]` (let mut + sync) |
| `inout bidir` | `inout bidir: bit` |

#### 16.1.2 データ型

| SystemVerilog | IRIS | 備考 |
|---------------|------|------|
| `logic [N-1:0]` | `bit[N]` | |
| `reg [N-1:0]` | `let mut x: bit[N] = 0` | syncブロック内で代入（順序回路） |
| `wire [N-1:0]` | `let x: bit[N] = 式;` | 組み合わせ回路 |
| `integer` | `int[32]` | |
| `logic signed [N-1:0]` | `int[N]` | |

#### 16.1.3 組み合わせ論理

**SystemVerilog:**
```systemverilog
always_comb begin
    case (sel)
        2'b00: out = in0;
        2'b01: out = in1;
        default: out = in2;
    endcase
end
```

**IRIS:**
```rust
comb {
    out = match sel {
        2'b00 => in0,
        2'b01 => in1,
        _ => in2,
    };
}
```

#### 16.1.4 順序論理

**SystemVerilog:**
```systemverilog
always_ff @(posedge clk or negedge rst_n) begin
    if (!rst_n)
        count <= '0;
    else if (en)
        count <= count + 1;
end
```

**IRIS:**
```rust
let mut count: bit[8] = 0;

sync(clk.posedge, rst_n.async) {
    if en {
        count = count + 1;
    }
}
```

### 16.2 よくあるパターンの変換

#### 16.2.1 パラメータ化モジュール

**SystemVerilog:**
```systemverilog
module Fifo #(
    parameter int WIDTH = 8,
    parameter int DEPTH = 16
) (
    input  logic clk,
    input  logic [WIDTH-1:0] din,
    output logic [WIDTH-1:0] dout
);
```

**IRIS:**
```rust
mod Fifo[Width: uint = 8, Depth: uint = 16] {
    in  clk: clock,
    in  din: bit[Width],
    out dout: bit[Width],
}
```

#### 16.2.2 generate文

**SystemVerilog:**
```systemverilog
genvar i;
generate
    for (i = 0; i < N; i++) begin : gen_stage
        Stage u_stage (.in(pipe[i]), .out(pipe[i+1]));
    end
endgenerate
```

**IRIS:**
```rust
for i in 0..N {
    inst stage[i] = Stage {
        in_port: pipe[i],
        out_port: pipe[i + 1],
    };
}
```

#### 16.2.3 インターフェース

**SystemVerilog:**
```systemverilog
interface axi_lite_if;
    logic [31:0] awaddr;
    logic        awvalid;
    logic        awready;
    modport master (output awaddr, awvalid, input awready);
    modport slave  (input  awaddr, awvalid, output awready);
endinterface
```

**IRIS:**
```rust
interface AxiLite {
    awaddr: bit[32],
    awvalid: bit,
    awready: bit,

    view initiator {
        out: awaddr, awvalid,
        in:  awready,
    }

    view target {
        in:  awaddr, awvalid,
        out: awready,
    }
}
```

### 16.3 変換時の注意点

#### 16.3.1 暗黙の型変換

SystemVerilogでは暗黙の型変換が許可されるが、IRISでは明示的な変換が必要。

```rust
let a: bit[8];
let b: bit[16];
b = a.extend[16];  // 明示的なゼロ拡張
```

#### 16.3.2 代入演算子の統一

IRISでは代入演算子を`=`に統一。コンテキストに応じてコンパイラが適切に解釈。

| SystemVerilog | IRIS |
|---------------|------|
| wire + assign | `let x = 式;` |
| always_comb + `=` | `let x = 式;` または `comb`ブロック内で`=` |
| always_ff + `<=` | `sync`ブロック内で`=` |

### 16.4 移行チェックリスト

- [ ] モジュール宣言を`mod`形式に変換
- [ ] ポート宣言を`in`/`out`/`inout`形式に変換
- [ ] データ型を`bit[N]`/`int[N]`/`uint[N]`に変換
- [ ] `wire`と単純な`assign`を`let`宣言に変換
- [ ] 複雑な`always_comb`を`comb`ブロックに変換
- [ ] `always_ff`を`sync`ブロックに変換
- [ ] `case`文を`match`式に変換
- [ ] 暗黙の型変換を明示的に記述
- [ ] FSMを`fsm`ブロックに変換
- [ ] interfaceを新形式に変換
- [ ] アサーションをIRIS構文に変換
- [ ] パラメータをジェネリクス形式に変換
- [ ] generate文をfor式に変換

---

## SystemVerilogとの比較

| 機能 | SystemVerilog | IRIS |
|------|---------------|------|
| 括弧 | `begin ... end` | `{ ... }` |
| 型宣言（組み合わせ） | `wire [7:0] data` | `let data: bit[8] = 式;` |
| 型宣言（順序） | `reg [7:0] data` | `let mut data: bit[8]` |
| 分岐 | `case ... endcase` | `match { ... }` |
| 組み合わせ論理 | `wire` + `assign` / `always_comb` | `let`宣言 / `comb { }` |
| 順序論理 | `always_ff @(posedge clk)` | `sync(clk.posedge) { }` |
| 代入演算子 | `=`/`<=` | `=`（統一） |
| モジュール | `module ... endmodule` | `mod ... { }` |
| 予約語数 | ~220 | ~52 |

