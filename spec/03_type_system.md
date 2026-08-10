# 第3章 型システム

[<< 字句構造](./02_lexical_structure.md) | [目次](./iris_spec.md) | [モジュール定義 >>](./04_module_definition.md)

---

## 3.1 プリミティブ型

### 3.1.1 ビット型

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

**`bit[N]` と `uN` の違い:**

| 型 | 値の範囲 | 4値論理 | 用途 |
|----|----------|---------|------|
| `bit[N]` | 0または1のN個の値 | サポート（x, z） | 合成可能な信号 |
| `uN` | 0 ～ 2^N - 1 の整数 | 非サポート | 演算、インデックス |

- `bit[N]`: ハードウェア信号として使用。
シミュレーション時にx/z値を持つ可能性がある。
- `uN`: 純粋な符号なし整数。
演算やループカウンタに使用。

```rust
let signal: bit[8];    // ハードウェア信号（x/z可能）
let index: u8;         // 整数値（x/z不可）
```

### 3.1.2 整数型

| 型 | ビット幅 | 符号 | 用途 |
|----|----------|------|------|
| `i32` | 32 | 符号付き | 汎用整数（デフォルト） |
| `u32` | 32 | 符号なし | 汎用符号なし整数（デフォルト） |
| `iN` | N | 符号付き | Nビット符号付き整数（例: `i8`, `i16`, `i64`） |
| `uN` | N | 符号なし | Nビット符号なし整数（例: `u8`, `u16`, `u64`） |

```rust
let count: u8 = 0;           // 8ビット符号なし
let offset: i16 = -100;      // 16ビット符号付き
```

**標準整数型:**

| 符号付き | 符号なし | ビット幅 |
|----------|----------|----------|
| `i8` | `u8` | 8 |
| `i16` | `u16` | 16 |
| `i32` | `u32` | 32 |
| `i64` | `u64` | 64 |
| `i128` | `u128` | 128 |

**`int[N]`/`uint[N]`と`iN`/`uN`の関係:**

`int[N]`と`iN`、`uint[N]`と`uN`はそれぞれ等価な型である。
`i8`は`int[8]`の組み込み型名エイリアスであり、`u32`は`uint[32]`の組み込み型名エイリアスである。
組み込み型名（`iN`/`uN`）は予約語ではなく、型コンテキストでのみ型名として解釈される。

```rust
let a: uint[8];   // uint[8]型（明示的な構文）
let b: u8;         // uint[8]型（組み込み型名エイリアス）
// aとbは同一の型
```

※ 組み込み型名（`i8`, `u8`, `i16`, `u16`等）は予約語ではなく組み込み型名である（2.4.3節を参照）。

### 3.1.3 論理型

```rust
let flag: bool;  // true または false
// bool は bit と相互変換可能だが、意味的に区別される
```

### 3.1.4 文字列型

IRISはシミュレーションと検証のコンテキストで文字列を扱うための`string`型を提供する。

```rust
let message: string = "Hello, IRIS!";
let hex_msg: string = "Value: \x41\x42";
```

**`string`型の制約:**

- 合成可能なハードウェア信号には使用不可
- テストモジュール（`test`）および`seq`ブロック内でのみ使用可能
- `$display`等のシステム関数の引数として使用
- 文字列リテラルは2.5.4節を参照

### 3.1.5 特殊信号型

| 型 | 説明 | 属性 |
|----|------|------|
| `clock` | クロック信号 | `.posedge`, `.negedge`, `period` |
| `reset` | リセット信号 | `.sync`, `.async`, `active_low`, `assert_cycles`, `assert_time` |

#### クロック型

```rust
in clk: clock,                    // デフォルト: 10ns周期
let clk: clock(period: 10ns),     // 10ns周期を明示指定
let clk: clock(period: 100ns),    // 100ns周期（10MHz）

// クロックエッジアクセス
sync(clk.posedge) { ... }
sync(clk.negedge) { ... }
```

**クロック属性:**

| 属性 | 説明 | デフォルト |
|------|------|-----------|
| `period` | クロック周期（時間単位: ps, ns, us, ms, s） | 10ns |

#### リセット型

```rust
in rst: reset,                                      // デフォルト: active high
in rst_n: reset(active_low: true),                  // active low（`reset(active_low)`は省略形として同一視）
let rst: reset(active_low: false, assert_cycles: 5), // 5サイクルアサート
let rst: reset(active_low: false, assert_time: 50ns), // 50nsアサート
let rst: reset(assert_cycles: 0),                    // リセットスキップ

// リセットモード
sync(clk.posedge, rst.sync) { ... }   // 同期リセット
sync(clk.posedge, rst.async) { ... }  // 非同期リセット

// リセットなしsyncブロック
sync(clk.posedge) { ... }             // リセットなし
```

**リセット属性:**

| 属性 | 説明 | デフォルト |
|------|------|-----------|
| `active_low` | true: Low-active, false: High-active | false |
| `assert_cycles` | リセットアサートサイクル数（0でスキップ） | 5 |
| `assert_time` | リセットアサート時間（ns, us等） | - |

**省略形:** `reset(active_low)`は`reset(active_low: true)`の省略形である。
真偽値の属性は、値が`true`の場合に限り名前付きパラメータの値を省略できる。

**時間単位:**

| 単位 | 説明 |
|------|------|
| `ps` | ピコ秒 |
| `ns` | ナノ秒 |
| `us` | マイクロ秒 |
| `ms` | ミリ秒 |
| `s` | 秒 |

---

## 3.2 複合型

### 3.2.1 列挙型（enum）

**基本構文:**

```ebnf
enum_def = "enum" identifier [ generic_params ] [ ":" underlying_type ] "{" enum_variant { "," enum_variant } [ "," ] "}" ;

underlying_type = type_expr ;

enum_variant = identifier [ "=" const_expr ] [ "(" type_expr ")" ] ;
```

この文法は`tools/iris.ebnf`および第16章と同一である。

**ジェネリックな列挙型は基準実装がまだ読めない。**

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

**ビット配置:**

タグは下位ビットに置き、ペイロードはその上に置く。
全体の幅は、タグの幅とペイロードの最大幅の和である。

```rust
enum Packet {
    Header,            // タグ 0
    Payload(bit[8]),   // タグ 1
    Footer             // タグ 2
}
// タグ2ビット＋ペイロード8ビット＝10ビット
// Packet::Payload(8'hAB) は (0xAB << 2) | 1 = 10'h2AD
```

`match`のアームでペイロードに名前を付けると、その値を取り出せる。
束縛した名前はそのアームの中でだけ見える。
文の形でも式の形でも取り出せる。

**網羅性:**

列挙型に対する`match`の網羅性は、宣言したバリアントで判定する。
表現に使うビット数ではない。
3つのバリアントを2ビットに収めた場合、3つすべてを覆えば網羅であり、
`_`は要らない。

### 3.2.2 構造体（struct）

**構文:**

```ebnf
struct_def = "struct" identifier [ generic_params ] "{" struct_field { "," struct_field } [ "," ] "}" ;

struct_field = identifier ":" type_expr ;
```

この文法は`tools/iris.ebnf`および第16章と同一である。

**ジェネリックな構造体は基準実装がまだ読めない。**

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

**構造体フィールドのミュータビリティ:**

構造体のフィールドへの代入は、構造体自体の宣言方法に依存する。

| 宣言 | フィールドへの代入 | 説明 |
|------|-------------------|------|
| `let hdr: EthernetHeader;` | `hdr.dst_mac = ...` | **可能**。`let`は参照の不変性を示すが、構造体フィールドは個別に代入可能 |
| `var hdr: EthernetHeader;` | `hdr.dst_mac = ...` | **可能**。`var`は`let`と同義だが、順序回路専用であることを明示 |
| `let pkt = Packet::Header;` | `pkt = Packet::Payload(...)` | **不可能**（再代入不可）。`let`直接代入は不変 |

IRISの構造体はハードウェア信号の集合であり、各フィールドは個別の信号として扱われる。
`var hdr: EthernetHeader;`と宣言すると、`hdr.dst_mac`のような名前の信号が
フィールドの数だけできる。
構造体そのものは信号ではない。
`let`で宣言された構造体のフィールドへの個別代入は、組み合わせ回路（`comb`ブロック内）または順序回路（`sync`/`fsm`ブロック内）として合成される。
構造体全体の再代入のみが`let`の不変性制約の対象である。

### 3.2.3 共用体（union）

```rust
union DataView {
    as_bytes: bit[8][4],
    as_halfwords: bit[16][2],
    as_word: bit[32]
}

// 全フィールドは同じビット幅でなければならない
mod ByteExtract(
    out byte0: bit[8],
) {
    var dv: DataView;

    comb {
        dv.as_word = 32'hDEADBEEF;
        byte0 = dv.as_bytes[0];  // 0xEF（リトルエンディアン想定）
    }
}
```

**ビット配置:**

共用体は、最も広いフィールドの幅を持つ信号1本である。
各フィールドはその下位ビットを指す。
フィールドの読み出しはスライス、書き込みはビットフィールドへの書き込みになる。

```rust
union DataView {
    as_byte: bit[8],
    as_word: bit[32]
}

mod LowByte(
    out low: bit[8],
) {
    var dv: DataView;

    comb {
        dv.as_word = 32'h11223344;
        low = dv.as_byte;   // 0x44。同じ記憶域の下位8ビット
    }
}
```

フィールドの幅は揃っていなくてよい。
狭いフィールドは下位ビットを見る。

**注意: 共用体の合成上の制約**

- 共用体は本質的にビットキャスト（型変換）である
- 異なるフィールドへの同時アクセスは未定義動作
- 安全なビットキャストには `as` 演算子の使用を推奨

```rust
// 推奨: 明示的ビットキャスト
let word: bit[32] = 32'hDEADBEEF;
let bytes: bit[8][4] = word as bit[8][4];
```

### 3.2.4 配列型

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

---

## 3.3 型エイリアスとジェネリクス

### 3.3.1 型エイリアス

```rust
type Byte = bit[8];
type Word = bit[32];
type Address = bit[16];
type RegFile = bit[32][32];  // 32個の32ビットレジスタ
```

### 3.3.2 パラメトリック型（ジェネリクス）

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

### 3.3.3 制約（where句）

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

### 3.3.4 組み込み関数

`$`プレフィックスを持つ関数はシステム関数である。
システム関数はコンパイル時計算可能な値を返し、型パラメータや配列次元の指定に使用できる。

| 関数 | 説明 | 例 | 合成 |
|------|------|-----|------|
| `$clog2(N)` | 天井log2（N以上の最小の2のべき乗の指数） | `$clog2(256) = 8` | Yes |
| `$bits(T)` | 型Tのビット幅 | `$bits(bit[8]) = 8` | Yes |
| `$size(arr)` | 配列の要素数 | `$size(mem) = 1024` | Yes |
| `$display(fmt, ...)` | フォーマット出力（検証用） | `$display("count = %d", count)` | No |
| `$finish` | シミュレーション終了 | `$finish;` | No |
| `$isunknown(expr)` | X/Zを含むかの判定 | `$isunknown(data)` | No |
| `$onehot(expr)` | ワンホット判定 | `$onehot(sel)` | No |

**システム関数の規則:**

- `$clog2`、`$bits`、`$size`は合成可能であり、型パラメータや定数式で使用可能
- `$display`、`$finish`、`$isunknown`、`$onehot`は検証コンテキスト（`test`モジュールおよび`seq`ブロック）でのみ使用可能
- システム関数名は`$`で始まり、予約語とは異なる名前空間に属する

---

## 3.4 型推論と型変換

### 3.4.1 型推論規則

```rust
let x = 8'hFF;           // 型: bit[8]（リテラルから推論）
let y = x + 1;           // 型: bit[8]（オペランドから推論）
let z = x == y;          // 型: bool（比較結果）
```

**デフォルトの整数リテラル型:**

サイズなしの整数リテラル（例：`1`、`42`）の型は、コンテキストに応じて以下の規則で決定される。

- 代入先の型が既知の場合：その型に暗黙に変換（ただし幅が不足する場合はコンパイルエラー）
- 演算のオペランドとして使用される場合：他方のオペランドの型に合わせる
- 型が推論できない場合：`u32`をデフォルトとする

```rust
let a = 1;              // 型推論不可の場合: u32
let b: bit[8] = 1;     // 代入先から: bit[8]
let c = x + 1;          // xがbit[8]の場合: bit[8]
```

サイズ付きリテラル（例：`8'hFF`、`32'd42`）は、指定された幅の`bit[N]`型となる。
unsizedリテラル（例：`'hFF`）は、コンテキストから幅が推論される。
推論できない場合はコンパイルエラーとなる。

### 3.4.2 明示的型変換

| メソッド | 説明 | 例 |
|----------|------|-----|
| `.extend[N]()` | ゼロ拡張 | `x.extend[16]()` |
| `.sign_extend[N]()` | 符号拡張 | `x.sign_extend[16]()` |
| `.truncate[N]()` | 切り詰め | `x.truncate[8]()` |
| `.saturate[N]()` | 飽和演算 | `x.saturate[8]()` |
| `.signed()` | 符号付き解釈 | `x.signed()` |
| `.unsigned()` | 符号なし解釈 | `x.unsigned()` |
| `as T` | 型キャスト | `x as bit[16]` |

```rust
let a: bit[8] = 8'hFF;
let b: bit[16] = a.extend[16]();       // 0x00FF
let c: i16 = a.sign_extend[16]();      // 0xFFFF（-1）
let d: bit[4] = a.truncate[4]();       // 0xF
let e: bit[4] = a.saturate[4]();       // 0xF（飽和）
```

### 3.4.3 暗黙の型変換（禁止）

IRISでは暗黙の型変換を**禁止**し、すべての型変換は明示的に行う必要がある。

```rust
// エラー: 暗黙の型変換
let a: bit[16] = 8'hFF;  // コンパイルエラー

// 正しい: 明示的拡張
let a: bit[16] = (8'hFF).extend[16]();
```

### 3.4.4 算術演算の結果幅

| 演算 | 結果幅 | 例 |
|------|--------|-----|
| `a + b` | max(a.width, b.width) | bit[8] + bit[8] → bit[8] |
| `a * b` | a.width + b.width | bit[8] * bit[8] → bit[16] |
| `a << n` | a.width | bit[8] << 2 → bit[8] |

オーバーフローを防ぐには明示的な拡張が必要:

```rust
let sum: bit[9] = a.extend[9]() + b.extend[9]();
```

---

[<< 字句構造](./02_lexical_structure.md) | [目次](./iris_spec.md) | [モジュール定義 >>](./04_module_definition.md)
