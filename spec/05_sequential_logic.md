# 第5章 順序論理

[<< 組み合わせ論理](./04_combinational_logic.md) | [目次](./iris_spec_0.1.0.md) | [FSM >>](./06_fsm.md)

---

## 5.1 syncブロック構文

### 5.1.1 EBNF定義

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

### 5.1.2 基本形式

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

---

## 5.2 可変信号の宣言

順序回路を記述するには、`var`（または`let mut`）で可変信号を宣言します。

### 5.2.1 varによる宣言（推奨）

```rust
// リセット値あり
var counter: bit[8] = 0;

// リセット値なし
var data: bit[8];
```

### 5.2.2 let mutによる宣言

```rust
// Rust互換構文（varと同義）
let mut counter: bit[8] = 0;
let mut data: bit[8];
```

---

## 5.3 リセット指定

### 5.3.1 リセットモード

| 構文 | リセット種別 | 説明 |
|------|-------------|------|
| `rst.sync` | 同期リセット | クロックエッジでリセット評価 |
| `rst.async` | 非同期リセット | クロックに非同期でリセット |

リセット値は`var`宣言時の初期値から決定されます。

### 5.3.2 同期リセット

```rust
var count: bit[8] = 0;  // リセット時は0

sync(clk.posedge, rst.sync) {
    if enable {
        count = count + 1;
    }
}
```

### 5.3.3 非同期リセット

```rust
var count: bit[8] = 0;  // リセット時は0

sync(clk.posedge, rst.async) {
    if enable {
        count = count + 1;
    }
    // リセット時は宣言時の初期値（0）
}
```

### 5.3.4 合成結果（SystemVerilog相当）

**IRIS:**

```rust
var q: bit[8] = 0;

sync(clk.posedge, rst.async) {
    q = d;
}
```

**生成されるSystemVerilog:**

```systemverilog
always_ff @(posedge clk or posedge rst) begin
    if (rst)
        q <= 8'h00;
    else
        q <= d;
end
```

---

## 5.4 リセット極性

### 5.4.1 Active High（デフォルト）

```rust
in rst: reset,

sync(clk.posedge, rst.async) { ... }
```

### 5.4.2 Active Low

```rust
in rst_n: reset(active_low),

sync(clk.posedge, rst_n.async) { ... }
```

---

## 5.5 クロックドメイン

### 5.5.1 ドメイン指定

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

### 5.5.2 クロックドメイン交差（CDC）チェック

IRISコンパイラは、異なるクロックドメイン間の直接参照を警告します。

```rust
// 警告: 異なるドメイン間の直接参照
sync(clk_b.posedge) @domain_b {
    reg_b = reg_a;  // 警告: reg_aはdomain_a
}
```

**警告メッセージ:**

```
warning[O0020]: clock domain crossing detected
  --> src/example.iris:15:14
   |
15 |     reg_b = reg_a;
   |             ^^^^^ 'reg_a' is in clock domain 'domain_a'
   |
   = note: this assignment is in clock domain 'domain_b'
   = help: use synchronizer: 'sync_ff(reg_a, stages: 2)'
```

### 5.5.3 同期化プリミティブ

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

---

## 5.6 条件付き代入

### 5.6.1 暗黙の保持

```rust
sync(clk.posedge, rst.async) {
    if enable {
        count = count + 1;
    }
    // enable=0の場合、countは保持される（暗黙のelse）
}
```

### 5.6.2 明示的な保持

```rust
sync(clk.posedge, rst.async) {
    if enable {
        count = count + 1;
    } else {
        count = count;  // 明示的保持（冗長だが明確）
    }
}
```

---

## 5.7 複合的な順序回路

### 5.7.1 カウンタ

```rust
mod Counter {
    in  clk: clock,
    in  rst: reset,
    in  enable: bit,
    in  load: bit,
    in  load_value: bit[8],
    out count: bit[8],
    out overflow: bit,

    var counter: bit[8] = 0;

    sync(clk.posedge, rst.async) {
        if load {
            counter = load_value;
        } else if enable {
            counter = counter + 1;
        }
    }

    comb {
        count = counter;
        overflow = (counter == 8'hFF) && enable;
    }
}
```

### 5.7.2 シフトレジスタ

```rust
mod ShiftRegister {
    in  clk: clock,
    in  rst: reset,
    in  shift: bit,
    in  din: bit,
    out dout: bit[8],

    var reg: bit[8] = 0;

    sync(clk.posedge, rst.async) {
        if shift {
            reg = {reg[6:0], din};  // 左シフト
        }
    }

    comb {
        dout = reg;
    }
}
```

### 5.7.3 パイプラインレジスタ

```rust
mod Pipeline {
    in  clk: clock,
    in  rst: reset,
    in  din: bit[32],
    out dout: bit[32],

    var stage1: bit[32] = 0;
    var stage2: bit[32] = 0;
    var stage3: bit[32] = 0;

    sync(clk.posedge, rst.async) {
        stage1 = din;
        stage2 = stage1;
        stage3 = stage2;
    }

    comb {
        dout = stage3;
    }
}
```

---

## 5.8 複数のsyncブロック

モジュール内に複数の`sync`ブロックを配置できますが、同一信号への代入は禁止されています。

```rust
mod Example {
    in  clk: clock,
    in  rst: reset,

    var reg_a: bit[8] = 0;
    var reg_b: bit[8] = 0;

    // OK: 異なる信号への代入
    sync(clk.posedge, rst.async) {
        reg_a = data_a;
    }

    sync(clk.posedge, rst.async) {
        reg_b = data_b;
    }
}
```

---

## 5.9 syncブロックとcombブロックの関係

```rust
mod Example {
    in  clk: clock,
    in  rst: reset,
    in  din: bit[8],
    out dout: bit[8],

    var reg: bit[8] = 0;
    let next_val: bit[8];

    // 組み合わせ論理で次の値を計算
    comb {
        next_val = din + 1;
    }

    // 順序論理でレジスタを更新
    sync(clk.posedge, rst.async) {
        reg = next_val;
    }

    // 出力接続
    comb {
        dout = reg;
    }
}
```

---

[<< 組み合わせ論理](./04_combinational_logic.md) | [目次](./iris_spec_0.1.0.md) | [FSM >>](./06_fsm.md)
