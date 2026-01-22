# 第15章 SystemVerilog移行ガイド

[<< エラーメッセージ](./14_error_messages.md) | [目次](./iris_spec_0.1.0.md) | [文法定義 >>](./16_grammar.md)

---

## 15.1 基本的な対応表

### 15.1.1 モジュール宣言

| SystemVerilog | IRIS |
|---------------|------|
| `module name #(parameter P=1) (input a, output b);` | `mod Name[P: uint = 1] { in a: bit, out b: bit }` |
| `input [7:0] data` | `in data: bit[8]` |
| `output reg [7:0] q` | `out q: bit[8]` (let で宣言 + syncブロック) |
| `inout bidir` | `inout bidir: bit` |

**SystemVerilog:**
```systemverilog
module Counter #(
    parameter WIDTH = 8
) (
    input  logic clk,
    input  logic rst_n,
    input  logic en,
    output logic [WIDTH-1:0] count
);
```

**IRIS:**
```rust
mod Counter[Width: uint = 8] {
    in  clk: clock,
    in  rst_n: reset,
    in  en: bit,
    out count: bit[Width],
}
```

### 15.1.2 データ型

| SystemVerilog | IRIS | 備考 |
|---------------|------|------|
| `logic [N-1:0]` | `bit[N]` | |
| `reg [N-1:0]` | `let x: bit[N] = 0` | syncブロック内で代入 |
| `wire [N-1:0]` | `let x: bit[N]` | combブロック内で代入 |
| `integer` | `i32` | |
| `int` | `i32` | 符号付き |
| `bit` | `bit` | |
| `logic signed [N-1:0]` | `iN`（例: `i32`） | |
| `logic unsigned [N-1:0]` | `uN`（例: `u32`）または `bit[N]` | |

---

## 15.2 組み合わせ論理

**SystemVerilog:**
```systemverilog
always_comb begin
    case (sel)
        2'b00: out = in0;
        2'b01: out = in1;
        2'b10: out = in2;
        default: out = in3;
    endcase
end
```

**IRIS:**
```rust
comb {
    out = match sel {
        2'b00 => in0,
        2'b01 => in1,
        2'b10 => in2,
        _ => in3,
    };
}
```

---

## 15.3 順序論理

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
let count: bit[8] = 0;  // リセット時は0

sync(clk.posedge, rst_n.async) {
    if en {
        count = count + 1;
    }
}
```

---

## 15.4 FSM

**SystemVerilog:**
```systemverilog
typedef enum logic [1:0] {IDLE, RUN, DONE} state_t;
state_t state, next_state;

always_ff @(posedge clk or negedge rst_n)
    if (!rst_n) state <= IDLE;
    else state <= next_state;

always_comb begin
    next_state = state;
    case (state)
        IDLE: if (start) next_state = RUN;
        RUN:  if (complete) next_state = DONE;
        DONE: next_state = IDLE;
    endcase
end
```

**IRIS:**
```rust
fsm Controller(clk.posedge, rst_n.async.active_low) {
    state enum { Idle, Run, Done }

    transitions {
        Idle => { when start { goto Run; } }
        Run  => { when complete { goto Done; } }
        Done => { goto Idle; }
    }
}
```

---

## 15.5 よくあるパターンの変換

### 15.5.1 パラメータ化モジュール

**SystemVerilog:**
```systemverilog
module Fifo #(
    parameter int WIDTH = 8,
    parameter int DEPTH = 16,
    parameter type T = logic [WIDTH-1:0]
) (
    input  logic clk,
    input  T     din,
    output T     dout
);
```

**IRIS:**
```rust
mod Fifo[Width: uint = 8, Depth: uint = 16, T: type = bit[Width]] {
    in  clk: clock,
    in  din: T,
    out dout: T,
}
```

### 15.5.2 generate文

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

### 15.5.3 インターフェース

**SystemVerilog:**
```systemverilog
interface axi_lite_if;
    logic [31:0] awaddr;
    logic        awvalid;
    logic        awready;
    // ...
    modport master (output awaddr, awvalid, input awready, ...);
    modport slave  (input  awaddr, awvalid, output awready, ...);
endinterface
```

**IRIS:**
```rust
interface AxiLite {
    awaddr: bit[32],
    awvalid: bit,
    awready: bit,
    // ...

    view initiator {
        out awaddr,
        out awvalid,
        in  awready,
        // ...
    }

    view target {
        in  awaddr,
        in  awvalid,
        out awready,
        // ...
    }
}
```

### 15.5.4 アサーション

**SystemVerilog:**
```systemverilog
assert property (@(posedge clk) req |-> ##[1:3] ack);
assume property (@(posedge clk) !reset |-> !req);
cover property (@(posedge clk) req ##1 ack);
```

**IRIS:**
```rust
assert @(clk.posedge) req |-> ##[1:3] ack;
assume @(clk.posedge) !reset |-> !req;
cover @(clk.posedge) req ##1 ack;
```

---

## 15.6 変換時の注意点

### 15.6.1 暗黙の型変換

SystemVerilogでは暗黙の型変換が許可されるが、IRISでは明示的な変換が必要。

**SystemVerilog（暗黙変換）:**
```systemverilog
logic [7:0] a;
logic [15:0] b;
b = a;  // 暗黙のゼロ拡張
```

**IRIS（明示的変換）:**
```rust
let a: bit[8];
let b: bit[16];
b = a.extend[16]();  // 明示的なゼロ拡張
// または
b = a as bit[16];    // キャスト
```

### 15.6.2 代入演算子の統一

IRISでは代入演算子を`=`に統一。コンテキストに応じてコンパイラが適切に解釈。

| SystemVerilog | IRIS | 説明 |
|---------------|------|------|
| always_comb + `=` | `let x = expr;` | 組み合わせ論理 |
| always_ff + `<=` | syncブロック内で`=` | 順序論理 |

### 15.6.3 default/case

SystemVerilogの`default`はIRISでは`_`（ワイルドカード）。

**SystemVerilog:**
```systemverilog
case (sel)
    2'b00: out = a;
    2'b01: out = b;
    default: out = c;
endcase
```

**IRIS:**
```rust
out = match sel {
    2'b00 => a,
    2'b01 => b,
    _ => c,
};
```

### 15.6.4 メモリアクセス

**SystemVerilog:**
```systemverilog
logic [31:0] mem [0:1023];
// 読み出し
data = mem[addr];
// 書き込み
mem[addr] = wdata;
```

**IRIS:**
```rust
mem storage: bit[32][1024];

// 読み出し（let文）
let data = storage[addr];

// 書き込み（syncブロック）
sync(clk.posedge) {
    if we { storage[addr] = wdata; }
}
```

---

## 15.7 移行チェックリスト

- [ ] モジュール宣言を`mod`形式に変換
- [ ] ポート宣言を`in`/`out`/`inout`形式に変換
- [ ] データ型を`bit[N]`/`iN`/`uN`に変換
- [ ] `always_comb`を`let`文に変換
- [ ] `always_ff`を`sync(clk.edge, rst) { }`に変換
- [ ] `case`文を`match`式に変換
- [ ] 暗黙の型変換を明示的に記述
- [ ] FSMを`fsm`ブロックに変換
- [ ] interfaceを新形式に変換
- [ ] アサーションをIRIS構文に変換
- [ ] パラメータをジェネリクス形式に変換
- [ ] generate文をfor式に変換

---

## 15.8 キーワード対応表

| SystemVerilog | IRIS | 備考 |
|---------------|------|------|
| `module` | `mod` | |
| `endmodule` | `}` | 波括弧で閉じる |
| `input` | `in` | |
| `output` | `out` | |
| `inout` | `inout` | 同じ |
| `wire` | `let` | 組み合わせ論理 |
| `reg` | `let` | syncブロック内で代入 |
| `logic` | `bit[N]` | |
| `always_comb` | `comb` | |
| `always_ff` | `sync` | |
| `parameter` | ジェネリクス `[P: uint]` | |
| `localparam` | `const` | |
| `assign` | `let x = expr;` | |
| `begin`/`end` | `{`/`}` | |
| `if`/`else` | `if`/`else` | 同じ |
| `case` | `match` | |
| `default` | `_` | |
| `for` | `for` | 同じ |
| `generate`/`endgenerate` | 不要 | forが自動的に展開 |
| `typedef enum` | `enum` | |
| `struct` | `struct` | 同じ |
| `interface` | `interface` | ビュー定義が異なる |
| `modport` | `view` | |
| `assert property` | `assert @(clk)` | |
| `$clog2` | `$clog2` | 同じ |

---

[<< エラーメッセージ](./14_error_messages.md) | [目次](./iris_spec_0.1.0.md) | [文法定義 >>](./16_grammar.md)
