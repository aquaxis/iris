# 第2章 型システム

[<< 字句構造](./01_lexical_structure.md) | [目次](./iris_spec_0.1.0.md) | [モジュール定義 >>](./03_module_definition.md)

---

## 2.1 プリミティブ型

### 2.1.1 ビット型

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

- `bit[N]`: ハードウェア信号として使用。シミュレーション時にx/z値を持つ可能性がある。
- `uN`: 純粋な符号なし整数。演算やループカウンタに使用。

```rust
let signal: bit[8];    // ハードウェア信号（x/z可能）
let index: u8;         // 整数値（x/z不可）
```

### 2.1.2 整数型

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

### 2.1.3 論理型

```rust
let flag: bool;  // true または false
// bool は bit と相互変換可能だが、意味的に区別される
```

### 2.1.4 特殊信号型

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

---

## 2.2 複合型

### 2.2.1 列挙型（enum）

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

### 2.2.2 構造体（struct）

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

### 2.2.3 共用体（union）

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

### 2.2.4 配列型

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

## 2.3 型エイリアスとジェネリクス

### 2.3.1 型エイリアス

```rust
type Byte = bit[8];
type Word = bit[32];
type Address = bit[16];
type RegFile = bit[32][32];  // 32個の32ビットレジスタ
```

### 2.3.2 パラメトリック型（ジェネリクス）

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

### 2.3.3 制約（where句）

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

### 2.3.4 組み込み関数

| 関数 | 説明 | 例 |
|------|------|-----|
| `$clog2(N)` | 天井log2 | `$clog2(256) = 8` |
| `$bits(T)` | 型のビット幅 | `$bits(bit[8]) = 8` |
| `$size(arr)` | 配列サイズ | `$size(mem) = 1024` |

---

## 2.4 型推論と型変換

### 2.4.1 型推論規則

```rust
let x = 8'hFF;           // 型: bit[8]（リテラルから推論）
let y = x + 1;           // 型: bit[8]（オペランドから推論）
let z = x == y;          // 型: bool（比較結果）
```

### 2.4.2 明示的型変換

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
let c: i16 = a.sign_extend[16];      // 0xFFFF（-1）
let d: bit[4] = a.truncate[4];       // 0xF
let e: bit[4] = a.saturate[4];       // 0xF（飽和）
```

### 2.4.3 暗黙の型変換（禁止）

IRISでは暗黙の型変換を**禁止**し、すべての型変換は明示的に行う必要がある。

```rust
// エラー: 暗黙の型変換
let a: bit[16] = 8'hFF;  // コンパイルエラー

// 正しい: 明示的拡張
let a: bit[16] = (8'hFF).extend[16];
```

### 2.4.4 算術演算の結果幅

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

[<< 字句構造](./01_lexical_structure.md) | [目次](./iris_spec_0.1.0.md) | [モジュール定義 >>](./03_module_definition.md)
