# 第6章 FSM（有限状態機械）

[<< 順序論理](./05_sequential_logic.md) | [目次](./iris_spec_0.1.0.md) | [インターフェース >>](./07_interface.md)

---

## 6.1 fsmブロック構文

### 6.1.1 EBNF定義

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

---

## 6.2 基本構造

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
    let counter: u8 = 0;

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

---

## 6.3 状態遷移の記述

### 6.3.1 状態内の記述要素

| 要素 | 代入演算子 | 説明 |
|------|-----------|------|
| 出力（組み合わせ） | `=` | 現在の状態に応じた出力 |
| レジスタ更新 | `=` | クロックエッジで更新 |
| 遷移条件 | `when...goto` | 次状態への遷移 |

### 6.3.2 遷移記述例

```rust
transitions {
    State1 => {
        // 組み合わせ出力
        output_a = 1;
        output_b = input_x & input_y;

        // 順序的更新（FSM内では=を使用）
        counter = counter + 1;

        // 条件付き遷移
        when condition1 {
            goto State2;
        }
        when condition2 {
            goto State3;
        }
        // 条件を満たさない場合は現在の状態を維持
    }
}
```

### 6.3.3 複数条件の優先順位

```rust
transitions {
    Idle => {
        // 優先順位: 上から下
        when error {
            goto Error;  // 最優先
        }
        when urgent_request {
            goto UrgentProcess;  // 2番目
        }
        when normal_request {
            goto NormalProcess;  // 3番目
        }
        // いずれも満たさない場合はIdleを維持
    }
}
```

---

## 6.4 状態エンコーディング

### 6.4.1 エンコーディング種別

| エンコーディング | 説明 | ビット数 | 用途 |
|------------------|------|----------|------|
| `binary` | 2進エンコーディング | ⌈log₂N⌉ | 状態数が多い場合 |
| `onehot` | ワンホットエンコーディング | N | 高速な状態デコード |
| `gray` | グレイコードエンコーディング | ⌈log₂N⌉ | CDC対応 |

### 6.4.2 エンコーディング指定

```rust
// バイナリ（デフォルト）
output encoding: binary

// ワンホット（推奨: FPGAで高速）
output encoding: onehot

// グレイコード（CDC用途）
output encoding: gray
```

---

## 6.5 タイマー付きFSMの例

```rust
fsm TrafficLight(clk.posedge, rst.async) {
    state enum {
        Red,
        Yellow,
        Green
    }

    initial: Red

    let timer: u8 = 0;

    transitions {
        Red => {
            red_light = 1;
            yellow_light = 0;
            green_light = 0;
            timer = timer + 1;

            when timer >= 100 {
                timer = 0;  // タイマーリセット
                goto Green;
            }
        }

        Green => {
            red_light = 0;
            yellow_light = 0;
            green_light = 1;
            timer = timer + 1;

            when timer >= 80 {
                timer = 0;
                goto Yellow;
            }
        }

        Yellow => {
            red_light = 0;
            yellow_light = 1;
            green_light = 0;
            timer = timer + 1;

            when timer >= 20 {
                timer = 0;
                goto Red;
            }
        }
    }

    output encoding: onehot
}
```

---

## 6.6 デフォルト遷移

いずれの`when`条件にも一致しない場合のデフォルト動作を指定できます。

```rust
transitions {
    Processing => {
        busy = 1;
        counter = counter + 1;

        when done {
            goto Complete;
        }
        when error {
            goto Error;
        }
        // default: 現在の状態を維持（暗黙）
    }

    // 明示的なデフォルト遷移
    Unknown => {
        default {
            goto Error;  // 未知の状態からはエラーへ
        }
    }
}
```

---

## 6.7 Moore型出力の簡略記法

状態に直接紐づく出力を簡潔に記述できます。

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

---

## 6.8 合成結果（SystemVerilog相当）

**IRIS:**

```rust
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

**生成されるSystemVerilog:**

```systemverilog
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

## 6.9 FSM設計のガイドライン

1. **状態数**: 状態数が多い場合（>16）はバイナリエンコーディングを検討
2. **出力遅延**: ミーリ型出力は組み合わせ遅延に注意
3. **リセット**: 非同期リセットのリカバリタイムに注意
4. **CDC**: 状態がクロックドメインを跨ぐ場合はグレイコードを使用
5. **到達不能状態**: コンパイラは到達不能な状態を警告する

---

[<< 順序論理](./05_sequential_logic.md) | [目次](./iris_spec_0.1.0.md) | [インターフェース >>](./07_interface.md)
