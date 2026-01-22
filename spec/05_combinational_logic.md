# 第5章 組み合わせ論理

[<< モジュール定義](./04_module_definition.md) | [目次](./iris_spec_0.1.0.md) | [順序論理 >>](./06_sequential_logic.md)

---

## 5.1 組み合わせ論理の記述方法

IRISでは、組み合わせ論理は2つの方法で記述できます：

1. **`let`宣言 + 直接代入**: 単純な組み合わせ論理に適している
2. **`comb`ブロック**: 複雑な組み合わせ論理を記述する場合に使用

`comb`ブロック内で代入された信号は組み合わせ回路として合成されます（Verilogの`wire` + `assign`または`always_comb`に相当）。

**注意:** `let`で宣言した信号でも、`sync`や`fsm`ブロック内で代入された場合は順序回路（レジスタ）として合成されます。詳細は[第6章 順序論理](./06_sequential_logic.md)を参照してください。

**重要:** `var`宣言は`sync`または`fsm`ブロック内でのみ使用可能です。組み合わせ論理（`let`直接代入や`comb`ブロック）で`var`を使用するとコンパイルエラーになります。

---

## 5.2 let宣言による組み合わせ回路

### 5.2.1 基本形式

```rust
// 単純な論理演算
let and_result = a & b;
let or_result = a | b;
let xor_result = a ^ b;

// 算術演算
let sum = a + b;
let diff = a - b;

// 条件式
let mux_out = if sel { a } else { b };

// 複合式
let complex = (a & b) | (c ^ d);
```

### 5.2.2 型推論

`let`宣言では、右辺の式から型が推論されます：

```rust
let x = 8'hFF;           // 型: bit[8]
let y = x + 1;           // 型: bit[8]
let z = x == y;          // 型: bool
```

型を明示的に指定することもできます：

```rust
let x: bit[8] = 8'hFF;
let sum: bit[16] = a.extend[16] + b.extend[16];
```

---

## 5.3 combブロックによる組み合わせ回路

### 5.3.1 基本構文

```ebnf
comb_block = "comb" [ default_spec ] "{" { statement } "}" ;
default_spec = "default" "(" identifier_list ")" ;
```

### 5.3.2 基本形式

```rust
mod Alu(
    in  a: bit[8],
    in  b: bit[8],
    in  op: bit[2],
    out result: bit[8],
) {
    // combブロックによる組み合わせ論理
    comb {
        result = match op {
            2'b00 => a + b,
            2'b01 => a - b,
            2'b10 => a & b,
            2'b11 => a | b,
        };
    }
}
```

### 5.3.3 combブロックの特徴

- 代入演算子 `=` を使用
- `comb`ブロック内で代入された信号は組み合わせ回路（wire）として合成
- モジュールスコープで定義され、他の`comb`ブロックや`sync`ブロックから参照可能

---

## 5.4 完全割り当てチェック

IRISコンパイラは、`comb`ブロック内の信号がすべての実行パスで値を持つことを検証します。

### 5.4.1 エラー例

```rust
// エラー: else節がない
comb {
    out = if sel {
        in0
    };  // コンパイルエラー
}
```

**エラーメッセージ:**

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

### 5.4.2 正しい記述

```rust
// 正しい: 完全なif-else
comb {
    out = if sel {
        in0
    } else {
        in1
    };
}
```

---

## 5.5 条件付き割り当て

### 5.5.1 if-else式

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
}
```

### 5.5.2 三項演算子

```rust
comb {
    // 三項演算子
    out = sel ? in1 : in0;

    // ネスト可能
    mux4 = sel[1] ? (sel[0] ? d3 : d2) : (sel[0] ? d1 : d0);
}
```

---

## 5.6 match式（パターンマッチング）

### 5.6.1 基本形式

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

### 5.6.2 網羅性チェック規則

| ケース | 要件 |
|--------|------|
| `bit[N]` のmatch | 2^N パターンすべて、または `_`（ワイルドカード） |
| `enum` のmatch | すべてのバリアント、または `_` |
| `bool` のmatch | `true` と `false`、または `_` |

### 5.6.3 ワイルドカードの使用

```rust
comb {
    // ワイルドカードを使用
    out = match opcode {
        OpCode::Add => a + b,
        OpCode::Sub => a - b,
        _ => 32'h0,  // その他すべて
    };
}
```

### 5.6.4 enum型のmatch

```rust
enum State {
    Idle,
    Running,
    Done
}

comb {
    // 列挙型のmatch
    led = match state {
        State::Idle => 3'b001,
        State::Running => 3'b010,
        State::Done => 3'b100,
    };
}
```

---

## 5.7 組み合わせ回路ループの検出

IRISコンパイラは、組み合わせ回路のループを検出しエラーとして報告します。

### 5.7.1 エラー例

```rust
// エラー: 組み合わせ回路ループ
comb {
    a = b + 1;
    b = a + 1;  // エラー: aに依存するbがaに代入される
}
```

**エラーメッセージ:**

```
error[O0015]: combinational loop detected
  --> src/example.iris:5:5
   |
 5 | a = b + 1;
 6 | b = a + 1;
   |     ^ 'b' depends on 'a' which depends on 'b'
   |
   = note: combinational loops cause simulation instability
```

### 5.7.2 回避方法

組み合わせ回路ループが必要な場合は、順序回路（`sync`ブロック）を使用してください。

---

## 5.8 出力ポートへの直接代入

`comb`ブロック内で出力ポートに直接代入することができます：

```rust
mod Adder(
    in  a: bit[8],
    in  b: bit[8],
    out sum: bit[8],
    out carry: bit,
) {
    comb {
        let extended_sum = a.extend[9] + b.extend[9];
        sum = extended_sum[7:0];
        carry = extended_sum[8];
    }
}
```

---

## 5.9 複数のcombブロック

モジュール内に複数の`comb`ブロックを配置できますが、同一信号への代入は禁止されています：

```rust
mod Example(
    in  a: bit[8],
    in  b: bit[8],
    out x: bit[8],
    out y: bit[8],
) {
    // OK: 異なる信号への代入
    comb {
        x = a + b;
    }

    comb {
        y = a - b;
    }

    // エラー: 同一信号への代入
    // comb {
    //     x = a | b;  // コンパイルエラー
    // }
}
```

---

## 5.10 合成結果

IRISの組み合わせ論理は、以下のようにSystemVerilogに変換されます：

**IRIS:**

```rust
mod Mux4(
    in  sel: bit[2],
    in  d0: bit[8],
    in  d1: bit[8],
    in  d2: bit[8],
    in  d3: bit[8],
    out out: bit[8],
) {
    comb {
        out = match sel {
            2'b00 => d0,
            2'b01 => d1,
            2'b10 => d2,
            2'b11 => d3,
        };
    }
}
```

**生成されるSystemVerilog:**

```systemverilog
module Mux4 (
    input  logic [1:0] sel,
    input  logic [7:0] d0,
    input  logic [7:0] d1,
    input  logic [7:0] d2,
    input  logic [7:0] d3,
    output logic [7:0] out
);
    always_comb begin
        case (sel)
            2'b00: out = d0;
            2'b01: out = d1;
            2'b10: out = d2;
            2'b11: out = d3;
        endcase
    end
endmodule
```

---

[<< モジュール定義](./04_module_definition.md) | [目次](./iris_spec_0.1.0.md) | [順序論理 >>](./06_sequential_logic.md)
