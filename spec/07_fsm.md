# 第7章 FSM（有限状態機械）

[<< 順序論理](./06_sequential_logic.md) | [目次](./iris_spec.md) | [インターフェース >>](./08_interface.md)

---

## 7.1 fsmブロック構文

### 7.1.1 EBNF定義

```ebnf
fsm_block = "fsm" identifier "(" clock_spec [ "," reset_spec ] ")" "{"
            state_enum [ "initial" ":" identifier ] { signal_decl }
            transitions_block { output_block } [ output_encoding ] "}" ;

state_enum = "state" "enum" "{" state_item { "," state_item } [ "," ] "}" ;
state_item = identifier [ moore_outputs ] ;
moore_outputs = "[" output_assign { "," output_assign } "]" ;
output_assign = identifier "=" const_expr ;

transitions_block = "transitions" "{" { transition_item } "}" ;
transition_item = ( identifier | "_" ) "=>" "{" { when_clause } "}" ;
when_clause = "when" expr "{" { transition_action } "}" ;

transition_action = "goto" identifier ";" | fsm_if_stmt | assign_stmt ;
fsm_if_stmt = "if" expr "{" { transition_action } "}"
              [ "else" ( fsm_if_stmt | "{" { transition_action } "}" ) ] ;

output_block = "output" identifier "{" { output_case } "}" ;
output_case = identifier "=>" expr "," ;

output_encoding = "output" "encoding" ":" encoding_type ;
encoding_type = "binary" | "onehot" | "gray" ;
```

この文法は`tools/iris.ebnf`および第16章と同一である。

**`when`節に書けるもの:**

`goto`、代入、そして`if`である。
`goto`は文ではないため、ふつうの`if`の中には書けない。
そのため`when`節専用の`if`を定めている。
分岐の中身も遷移アクションである。

```rust
Yellow => {
    when timer >= 8'd10 {
        if ped_request {
            goto Walk;
        } else {
            goto Red;
        }
        timer = 0;
    }
}
```

同じことは、条件を分けた複数の`when`でも書ける。
最初に成立した節が採られる。

**`_`（ワイルドカード）:**

`_ =>`はどの状態にも当てはまる。
中身は他の遷移と同じく`when`節である。

**ローカル信号:**

FSM本体で宣言した信号は、そのFSMに属する。
モジュールに同じ名前の信号があっても混ざらない。
波形には`{fsm名}.{信号名}`という名前で現れる。

**状態信号:**

現在の状態は`{fsm名}_state`という信号として波形に出る。
インスタンス内のFSMは階層名になる（`c.ctrl_state`）。

---

## 7.2 基本構造

```rust
fsm StateMachineName(clk.posedge, rst.async) {
    // 1. 状態定義。出力は状態に付ける（Moore出力）
    state enum {
        Idle    [busy = 0, done = 0],
        Running [busy = 1, done = 0],
        Done    [busy = 0, done = 1],
    }

    // 2. 初期状態
    initial: Idle

    // 3. ローカル変数（オプション）
    var counter: bit[8] = 0;

    // 4. 状態遷移。腕の中身は when 節だけである
    transitions {
        Idle => {
            when start {
                goto Running;
            }
        }

        Running => {
            when counter >= 8'd100 {
                counter = 0;
                goto Done;
            }
            when 1 {
                counter = counter + 1;
            }
        }

        Done => {
            when ack {
                goto Idle;
            }
        }
    }

    // 5. エンコーディング（オプション）
    output encoding: onehot
}
```

遷移の腕に置けるのは`when`節だけである。
状態ごとの出力は状態定義の`[ ]`に書くか、`output`ブロックに書く。

`when`節は上から順に判定し、**最初に一致した1つだけ**が実行される。
上の`Running`で、`counter`が100に達したサイクルに`counter`が増えないのはこのためである。

---

## 7.3 状態遷移の記述

### 7.3.1 どこに何を書くか

| 要素 | 書く場所 | 説明 |
|------|---------|------|
| 出力（状態だけで決まる） | `state enum`の`[ ]` | Moore出力 |
| 出力（状態ごとに式で決める） | `output`ブロック | 7.4節 |
| レジスタ更新 | `when`節の中 | クロックエッジで更新 |
| 遷移条件 | `when ... goto` | 次状態への遷移 |

遷移の腕（`State => { ... }`）に直接置けるのは`when`節だけである。
代入を腕に直接書くことはできない。

### 7.3.2 遷移記述例

```rust
transitions {
    State1 => {
        // 条件付き遷移
        when condition1 {
            goto State2;
        }
        when condition2 {
            counter = counter + 1;   // 遷移せず更新だけを行ってもよい
            goto State3;
        }
        // どの条件も満たさない場合は現在の状態を維持する
    }
}
```

### 7.3.3 複数条件の優先順位

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

## 7.4 状態エンコーディング

### 7.4.1 エンコーディング種別

| エンコーディング | 説明 | ビット数 | 用途 |
|------------------|------|----------|------|
| `binary` | 2進エンコーディング | ⌈log₂N⌉ | 状態数が多い場合 |
| `onehot` | ワンホットエンコーディング | N | 高速な状態デコード |
| `gray` | グレイコードエンコーディング | ⌈log₂N⌉ | CDC対応 |

### 7.4.2 エンコーディング指定

```rust
// バイナリ（デフォルト）
output encoding: binary

// ワンホット（推奨: FPGAで高速）
output encoding: onehot

// グレイコード（CDC用途）
output encoding: gray
```

---

## 7.5 タイマー付きFSMの例

```rust
fsm TrafficLight(clk.posedge, rst.async) {
    // 灯りは状態だけで決まるので、状態定義に付ける
    state enum {
        Red    [red_light = 1, yellow_light = 0, green_light = 0],
        Green  [red_light = 0, yellow_light = 0, green_light = 1],
        Yellow [red_light = 0, yellow_light = 1, green_light = 0],
    }

    initial: Red

    var timer: bit[8] = 0;

    transitions {
        Red => {
            when timer >= 8'd100 {
                timer = 0;
                goto Green;
            }
            when 1 {
                timer = timer + 1;
            }
        }

        Green => {
            when timer >= 8'd80 {
                timer = 0;
                goto Yellow;
            }
            when 1 {
                timer = timer + 1;
            }
        }

        Yellow => {
            when timer >= 8'd20 {
                timer = 0;
                goto Red;
            }
            when 1 {
                timer = timer + 1;
            }
        }
    }

    output encoding: onehot
}
```

---

## 7.6 デフォルト遷移

いずれの`when`条件にも一致しなければ、状態はそのまま保たれる。
これは既定の動作であり、書く必要はない。

```rust
transitions {
    Processing => {
        when done {
            goto Complete;
        }
        when error {
            goto Error;
        }
        // どちらでもなければ Processing のまま
    }
}
```

自分の腕を持たない状態すべてに当てる場合は、ワイルドカード`_`を使う。

```rust
transitions {
    Idle => {
        when start {
            goto Processing;
        }
    }

    // Idle 以外のすべての状態から
    _ => {
        when error {
            goto Error;
        }
    }
}
```

---

## 7.7 Moore型出力の簡略記法

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

## 7.8 合成結果（SystemVerilog相当）

**IRIS:**

```rust
fsm Controller(clk.posedge, rst.async) {
    state enum {
        Idle [busy = 0],
        Run  [busy = 1],
        Done [busy = 0],
    }
    initial: Idle
    transitions {
        Idle => { when start { goto Run; } }
        Run  => { when complete { goto Done; } }
        Done => { when ack { goto Idle; } }
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

## 7.9 FSMブロックとモジュールレベル信号の関係

FSMブロックはモジュール内の`mod_item`として定義される。
FSMブロック内からは、以下の信号に直接アクセスできる。

- モジュールの入力ポート（読み取り専用）
- モジュールの`out`ポート（代入可能）
- モジュールレベルで宣言された`var`、`let`信号（読み取りと代入ができる）
- FSM内のローカル変数（`let`で宣言されたFSMスコープ変数）

FSMブロック内での代入は、`sync`ブロック内での代入と同じセマンティクスを持つ。
代入された信号はレジスタとして合成される。

---

## 7.10 FSM設計のガイドライン

1. **状態数**: 状態数が多い場合（>16）はバイナリエンコーディングを検討
2. **出力遅延**: ミーリ型出力は組み合わせ遅延に注意
3. **リセット**: 非同期リセットのリカバリタイムに注意
4. **CDC**: 状態がクロックドメインを跨ぐ場合はグレイコードを使用
5. **到達不能状態**: コンパイラは到達不能な状態を警告する

---

[<< 順序論理](./06_sequential_logic.md) | [目次](./iris_spec.md) | [インターフェース >>](./08_interface.md)
