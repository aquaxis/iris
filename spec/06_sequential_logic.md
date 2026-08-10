# 第6章 順序論理

[<< 組み合わせ論理](./05_combinational_logic.md) | [目次](./iris_spec.md) | [FSM >>](./07_fsm.md)

---

## 6.1 syncブロック構文

### 6.1.1 EBNF定義

```ebnf
sync_block = "sync" "(" clock_spec [ "," reset_spec ] ")" [ domain_attr ] "{" { statement } "}" ;

clock_spec = expr "." edge ;
edge = "posedge" | "negedge" ;
reset_spec = expr "." reset_mode ;
reset_mode = "async" | "sync" ;
domain_attr = "@" identifier ;
```

この文法は`tools/iris.ebnf`および第16章と同一である。

`sync`の中身は`statement`である。
代入と`if`だけでなく、`match`、`for`、`while`、アサーションも書ける（第9章、第11章）。

クロックとリセットの前は式である。
`clk.posedge`のような単純な名前に限らず、`bus.clk.posedge`のような参照も置ける。

### 6.1.2 基本形式

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

### 6.1.3 syncブロックの評価モデル

syncブロック内の代入は**並行セマンティクス**（ノンブロッキング代入）で評価される。
全ての右辺が代入前に評価され、代入はクロックエッジで同時に反映される。

```rust
sync(clk.posedge, rst.async) {
    stage1 = din;     // dinの現在値
    stage2 = stage1;   // stage1の古い値（更新前）
    stage3 = stage2;  // stage2の古い値（更新前）
}
```

この並行セマンティクスにより、パイプラインレジスタが正しく合成される。
同一信号への複数代入は最後の代入が有効である（16.12.3節の規則4）。

---

## 6.2 順序回路用の信号宣言

順序回路を記述するには、`let`、`let mut`、または`var`で信号を宣言し、`sync`ブロック内で代入します。

**重要:** IRISでは、信号の合成結果は**使用コンテキスト**によって決定されます。
`let`で宣言した信号でも、`sync`ブロック内で代入されると順序回路（レジスタ）として合成されます。

### 6.2.1 letによる宣言

```rust
// letでも順序回路として使用可能
let counter: bit[8] = 0;  // リセット値あり
let data: bit[8];         // リセット値なし（初期値省略可）

sync(clk.posedge, rst.async) {
    counter = counter + 1;  // letで宣言した変数もsyncブロック内で代入可能
}
```

### 6.2.2 varによる宣言（順序回路専用）

**重要:** `var`はモジュールレベルで宣言し、`sync`または`fsm`ブロック内でのみ代入可能です。
`comb`ブロック内や直接代入で`var`に値を代入するとコンパイルエラーになります。

```rust
// varはモジュールレベルで宣言する
var counter: bit[8] = 0;  // リセット値あり
var data: bit[8];         // リセット値なし

sync(clk.posedge, rst.async) {
    counter = counter + 1;  // OK: sync内で代入
}

// 以下はエラー
// comb { counter = 0; }  // エラー: varはcombブロック内で代入不可
```

### 6.2.3 let mutによる宣言

```rust
// Rust互換構文（varと同義）
let mut counter: bit[8] = 0;
let mut data: bit[8];
```

### 6.2.4 宣言形式の選択

| 宣言 | 用途 | 使用可能コンテキスト | 備考 |
|------|------|---------------------|------|
| `let` | 汎用的な信号宣言 | どこでも | コンテキストにより組み合わせ/順序回路を自動判定 |
| `var` | 順序回路専用 | **sync/fsmのみ** | 明示的にレジスタであることを示す |
| `let mut` | 可変信号（初期値付き） | sync/fsm推奨 | 初期値がリセット値となる |

**推奨:** 順序回路用の信号には`var`を使用することを推奨します。
`var`は`sync`/`fsm`ブロックでのみ使用可能であるため、意図が明確になります。
`let`はどこでも使用可能ですが、使用コンテキストにより回路種別が決定されます。

---

## 6.3 リセット指定

### 6.3.1 リセットモード

| 構文 | リセット種別 | 説明 |
|------|-------------|------|
| `rst.sync` | 同期リセット | クロックエッジでリセット評価 |
| `rst.async` | 非同期リセット | クロックに非同期でリセット |

リセット値は`var`宣言時の初期値から決定されます。

### 6.3.2 同期リセット

```rust
var count: bit[8] = 0;  // リセット時は0

sync(clk.posedge, rst.sync) {
    if enable {
        count = count + 1;
    }
}
```

### 6.3.3 非同期リセット

```rust
var count: bit[8] = 0;  // リセット時は0

sync(clk.posedge, rst.async) {
    if enable {
        count = count + 1;
    }
    // リセット時は宣言時の初期値（0）
}
```

### 6.3.4 合成結果（SystemVerilog相当）

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

## 6.4 リセット極性

### 6.4.1 Active High（デフォルト）

```rust
in rst: reset,

sync(clk.posedge, rst.async) { ... }
```

### 6.4.2 Active Low

```rust
in rst_n: reset(active_low: true),

sync(clk.posedge, rst_n.async) { ... }
```

---

## 6.5 リセットなしsyncブロック

リセットを指定しないsyncブロックは、初期値が設定されている場合にのみ初期値でリセットされる。

```rust
// リセットなしsyncブロック
// 初期値なしの場合、レジスタはシミュレーション時に不定値（X）となる
var data: bit[8];
sync(clk.posedge) {
    data = din;
}

// 初期値ありの場合、初期値がパワーアップ時の値となる
var count: bit[8] = 0;
sync(clk.posedge) {
    count = count + 1;
}
```

**リセットなしの動作:**

| 宣言形式 | パワーアップ時の値 | 合成結果 |
|----------|-------------------|----------|
| `var x: bit[8];`（初期値なし） | 不定値（X） | レジスタ（リセットなし） |
| `var x: bit[8] = 0;`（初期値あり） | 初期値（0） | レジスタ（パワーアップ初期値付き） |
| `let x: bit[8] = 0;` + `sync(clk.posedge)` | 初期値（0） | レジスタ（パワーアップ初期値付き） |

初期値ありの`var`または`let`宣言は、パワーアップ時にその値でレジスタを初期化する。
ただし、この初期化はFPGAの初期値機能に依存するため、ASICでは初期値が保証されない場合がある。

---

## 6.6 クロックドメイン

### 6.6.1 ドメイン指定

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

### 6.5.2 クロックドメイン交差（CDC）チェック

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

### 6.5.3 同期化プリミティブ

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

## 6.6 条件付き代入

### 6.6.1 暗黙の保持

```rust
sync(clk.posedge, rst.async) {
    if enable {
        count = count + 1;
    }
    // enable=0の場合、countは保持される（暗黙のelse）
}
```

### 6.6.2 明示的な保持

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

## 6.7 複合的な順序回路

### 6.7.1 カウンタ

```rust
mod Counter(
    in  clk: clock,
    in  rst: reset,
    in  enable: bit,
    in  load: bit,
    in  load_value: bit[8],
    out count: bit[8],
    out overflow_pending: bit,
) {
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
        overflow_pending = (counter == 8'hFF) && enable;
    }
}
```

### 6.7.2 シフトレジスタ

```rust
mod ShiftRegister(
    in  clk: clock,
    in  rst: reset,
    in  shift: bit,
    in  din: bit,
    out dout: bit[8],
) {
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

### 6.7.3 パイプラインレジスタ

```rust
mod Pipeline(
    in  clk: clock,
    in  rst: reset,
    in  din: bit[32],
    out dout: bit[32],
) {
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

## 6.8 複数のsyncブロック

モジュール内に複数の`sync`ブロックを配置できますが、同一信号への代入は禁止されています。

```rust
mod Example(
    in  clk: clock,
    in  rst: reset,
) {
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

## 6.9 syncブロックとcombブロックの関係

```rust
mod Example(
    in  clk: clock,
    in  rst: reset,
    in  din: bit[8],
    out dout: bit[8],
) {
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

[<< 組み合わせ論理](./05_combinational_logic.md) | [目次](./iris_spec.md) | [FSM >>](./07_fsm.md)
