# 第8章 演算子

[<< インターフェース](./07_interface.md) | [目次](./iris_spec_0.1.0.md) | [メモリ >>](./09_memory.md)

---

## 8.1 算術演算子

### 8.1.1 基本演算

| 演算子 | 説明 | 結果幅 | 合成可能 |
|--------|------|--------|----------|
| `a + b` | 加算 | max(width(a), width(b)) | Yes |
| `a - b` | 減算 | max(width(a), width(b)) | Yes |
| `a * b` | 乗算 | width(a) + width(b) | Yes |
| `a / b` | 除算 | width(a) | 条件付き |
| `a % b` | 剰余 | width(b) | 条件付き |
| `a ** n` | べき乗 | 可変 | 定数nのみ |

```rust
let a: bit[8] = 8'd100;
let b: bit[8] = 8'd50;

let sum = a + b;         // bit[8], オーバーフロー可能
let diff = a - b;        // bit[8]
let prod = a * b;        // bit[16]
let quot = a / b;        // bit[8] (合成時は2の累乗推奨)
let rem = a % b;         // bit[8] (合成時は2の累乗推奨)
let pow = a ** 2;        // a * a
```

### 8.1.2 オーバーフロー制御

```rust
// キャリー付き加算
let extended_sum = a.extend[9] + b.extend[9];  // bit[9]
let result = extended_sum[7:0];
let carry = extended_sum[8];

// 飽和演算
let sat_sum = (a.extend[9] + b.extend[9]).saturate[8];
// 255 + 1 = 255（飽和）

// 明示的切り詰め
let trunc_prod = (a * b).truncate[8];  // bit[8]
```

### 8.1.3 符号付き演算

```rust
let signed_a: i8 = -50;
let signed_b: i8 = 30;

// 符号付き演算（自動）
let signed_sum = signed_a + signed_b;  // -20

// bit型を符号付きとして扱う
let unsigned_val: bit[8] = 8'hF0;
let as_signed = unsigned_val.signed();  // -16として解釈
```

---

## 8.2 ビット演算子

### 8.2.1 論理演算

| 演算子 | 説明 | 例 | 結果 |
|--------|------|-----|------|
| `~a` | ビット反転 | `~4'b1010` | `4'b0101` |
| `a & b` | ビットAND | `4'b1100 & 4'b1010` | `4'b1000` |
| `a \| b` | ビットOR | `4'b1100 \| 4'b1010` | `4'b1110` |
| `a ^ b` | ビットXOR | `4'b1100 ^ 4'b1010` | `4'b0110` |
| `a ~^ b` | ビットXNOR | `4'b1100 ~^ 4'b1010` | `4'b1001` |

### 8.2.2 シフト演算

| 演算子 | 説明 | 符号ビット | 例 |
|--------|------|-----------|-----|
| `a << n` | 論理左シフト | 0埋め | `8'b1000_0001 << 2` = `8'b0000_0100` |
| `a >> n` | 論理右シフト | 0埋め | `8'b1000_0001 >> 2` = `8'b0010_0000` |
| `a >>> n` | 算術右シフト | 符号拡張 | `8'b1000_0001 >>> 2` = `8'b1110_0000` |

### 8.2.3 リダクション演算

| メソッド | 説明 | 例 |
|----------|------|-----|
| `.and_reduce()` | 全ビットAND | `4'b1111.and_reduce()` = `1` |
| `.or_reduce()` | 全ビットOR | `4'b0001.or_reduce()` = `1` |
| `.xor_reduce()` | パリティ | `4'b1101.xor_reduce()` = `1` |

```rust
let data: bit[8] = 8'hA5;

// パリティ計算
let parity = data.xor_reduce();

// 全ビット1チェック
let all_ones = data.and_reduce();

// ゼロ検出
let is_zero = !data.or_reduce();
```

### 8.2.4 ビット操作メソッド

```rust
let val: bit[8] = 8'b1010_0101;

// ビット数カウント
let ones = val.count_ones();   // 4
let zeros = val.count_zeros(); // 4

// 先行・後続ゼロ
let leading = val.leading_zeros();   // 0
let trailing = val.trailing_zeros(); // 0

// ビット反転
let reversed = val.reverse_bits();  // 8'b1010_0101
```

---

## 8.3 比較演算子

### 8.3.1 等価・不等価

| 演算子 | 説明 | X/Z扱い |
|--------|------|---------|
| `a == b` | 等価 | 任意のX/Zで偽 |
| `a != b` | 不等価 | 任意のX/Zで偽 |
| `a === b` | 厳密等価（検証用） | X/Zも比較 |
| `a !== b` | 厳密不等価（検証用） | X/Zも比較 |

### 8.3.2 大小比較

| 演算子 | 説明 | デフォルト解釈 |
|--------|------|---------------|
| `a < b` | 未満 | 符号なし |
| `a <= b` | 以下 | 符号なし |
| `a > b` | より大きい | 符号なし |
| `a >= b` | 以上 | 符号なし |

```rust
let a: bit[8] = 8'hFF;  // 符号なし: 255, 符号付き: -1
let b: bit[8] = 8'h01;  // 1

// 符号なし比較（デフォルト）
let cmp1 = (a > b);  // true (255 > 1)

// 符号付き比較
let cmp2 = (a.signed() > b.signed());  // false (-1 > 1)
```

---

## 8.4 論理演算子

| 演算子 | 説明 | 短絡評価 |
|--------|------|----------|
| `!a` | 論理NOT | - |
| `a && b` | 論理AND | Yes |
| `a \|\| b` | 論理OR | Yes |

```rust
// boolへの変換
let flag: bool = (count != 0);

// 論理演算
let proceed = valid && ready;
let alert = error || warning;
let inverted = !enable;
```

---

## 8.5 三項条件演算子

```rust
let result = condition ? value_if_true : value_if_false;

// ネスト可能
let mux4 = sel[1] ? (sel[0] ? d3 : d2) : (sel[0] ? d1 : d0);

// チェーン形式
let priority =
    cond_a ? val_a :
    cond_b ? val_b :
    cond_c ? val_c :
             default_val;
```

---

## 8.6 ビット選択とスライス

### 8.6.1 単一ビット選択

```rust
let data: bit[32] = 32'hDEADBEEF;

// 定数インデックス
let bit0 = data[0];    // LSB
let bit31 = data[31];  // MSB

// 変数インデックス
let bit_n = data[idx]; // マルチプレクサ合成
```

### 8.6.2 固定スライス

```rust
// 降順範囲（推奨）
let byte0 = data[7:0];     // 下位8ビット
let byte3 = data[31:24];   // 上位8ビット
```

### 8.6.3 動的スライス（パート選択）

| 構文 | 説明 | 例 |
|------|------|-----|
| `data[idx +: width]` | idxから上位widthビット | `data[8 +: 8]` = `data[15:8]` |
| `data[idx -: width]` | idxから下位widthビット | `data[15 -: 8]` = `data[15:8]` |

```rust
// 動的バイト選択
let byte_n = data[byte_idx * 8 +: 8];
```

---

## 8.7 連結とレプリケーション

### 8.7.1 連結演算子

```rust
// 基本連結
let combined: bit[16] = {high_byte, low_byte};

// 複数要素
let word: bit[32] = {byte3, byte2, byte1, byte0};

// 異なる幅の連結
let result: bit[12] = {4'hA, 8'hBC};  // 12'hABC
```

### 8.7.2 レプリケーション

```rust
// 繰り返し
let zeros: bit[32] = {32{1'b0}};     // 全ビット0
let ones: bit[16] = {16{1'b1}};      // 全ビット1
let pattern: bit[32] = {4{8'hAB}};   // 32'hABABABAB

// 符号拡張の実装
let sign_bit = value[7];
let sign_ext: bit[16] = {{8{sign_bit}}, value};
```

---

## 8.8 演算子優先順位

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

```rust
// 優先順位の例
let result = a + b * c;       // a + (b * c)
let masked = data & mask | flag;  // (data & mask) | flag

// 明示的な括弧を推奨
let clear = data & ~(1 << bit_pos);  // ビットクリア
let set = data | (1 << bit_pos);     // ビットセット
```

---

[<< インターフェース](./07_interface.md) | [目次](./iris_spec_0.1.0.md) | [メモリ >>](./09_memory.md)
