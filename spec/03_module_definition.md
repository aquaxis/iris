# 第3章 モジュール定義

[<< 型システム](./02_type_system.md) | [目次](./iris_spec_0.1.0.md) | [組み合わせ論理 >>](./04_combinational_logic.md)

---

## 3.1 モジュール構文

### 3.1.1 基本構文（EBNF）

```ebnf
module_decl = "mod" identifier [ generic_params ] [ where_clause ]
              "{" module_body "}" ;
generic_params = "[" generic_param { "," generic_param } "]" ;
generic_param = identifier ":" type [ "=" default_value ] ;
where_clause = "where" constraint { "," constraint } ;
module_body = { port_decl | signal_decl | logic_block | instance } ;
```

### 3.1.2 完全な例

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
    var count_reg: bit[Width] = 0;  // 初期値（リセット値）
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

---

## 3.2 ポート宣言

### 3.2.1 ポート方向

| キーワード | 説明 | 合成結果 |
|------------|------|----------|
| `in` | 入力ポート | input |
| `out` | 出力ポート | output |
| `inout` | 双方向ポート | inout（トライステート） |

### 3.2.2 ポート宣言構文

```ebnf
port_decl = port_direction identifier ":" type [ "," ] ;
port_direction = "in" | "out" | "inout" ;
```

### 3.2.3 ポート例

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

---

## 3.3 信号宣言

### 3.3.1 信号の種類

| 宣言 | 用途 | 合成結果 | スコープ |
|------|------|----------|----------|
| `let 名前: 型;` | 不変信号（型のみ） | wire | モジュール |
| `let 名前 = 初期値;` | 不変信号（型推論） | wire | モジュール |
| `let 名前: 型 = 初期値;` | 不変信号（型と初期値指定） | wire | モジュール |
| `var 名前: 型;` | 可変信号（型のみ） | register | モジュール |
| `var 名前 = 初期値;` | 可変信号（型推論） | register | モジュール |
| `var 名前: 型 = 初期値;` | 可変信号（型と初期値指定） | register | モジュール |
| `let mut 名前: 型;` | 可変信号（`var`と同義） | register | モジュール |
| `const` | モジュール定数 | parameter相当 | モジュール/パッケージ |
| `mem` | メモリ | RAM/ROM | モジュール |

※ `var`は`let mut`のシンタックスシュガー（同義）。

**`let` vs `var` vs `const` の違い:**

- `let`: 不変信号宣言。組み合わせ回路として合成（Verilogの`wire`に相当）
- `var`: 可変信号宣言。順序回路として合成（Verilogの`reg`に相当）
- `let mut`: `var`と同義。Rust互換の代替構文
- `const`: モジュールレベルまたはパッケージレベルの定数

### 3.3.2 信号の合成セマンティクス

**合成セマンティクス:**

- `let`（不変信号）: 組み合わせ回路として合成（Verilogの`wire`に相当）
- `var`/`let mut`（可変信号）: 順序回路として合成（Verilogの`reg`に相当）

| 記述方法 | 合成結果 |
|----------|----------|
| `let 名前 = 式;` | 組み合わせ回路（wire） |
| `var 名前 = 初期値;` + `sync`ブロック内で代入 | 順序回路（リセット値あり） |
| `var 名前: 型;` + `sync`ブロック内で代入 | 順序回路（リセット値なし） |
| `comb`ブロック内で出力ポートに代入 | 組み合わせ回路（wire） |

### 3.3.3 Multi Drive禁止

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

### 3.3.4 初期値（オプション）

**宣言形式のバリエーション:**

```rust
// 不変信号（let）
let value1: bit[8];              // 型のみ指定
let value2 = 8'hFF;              // 初期値から型推論（bit[8]）
let value3: bit[8] = 8'hFF;      // 型と初期値の両方を指定

// 可変信号（var）
var counter1: bit[8];            // 型のみ指定（リセット値なし）
var counter2 = 0;                // 初期値から型推論
var counter3: bit[8] = 0;        // 型と初期値の両方を指定（リセット時に0）

// 定数
const MAX_VAL: uint = 255;       // コンパイル時定数
```

**初期値の動作:**

- 初期値が設定されている場合、リセット処理で初期値がセットされる
- 初期値がない場合、リセット値は未定義となる

---

## 3.4 モジュールインスタンス化

### 3.4.1 インスタンス構文

```ebnf
instance = "inst" identifier [ "[" size "]" ] "=" module_type
           [ generic_args ] "{" port_connections "}" ";" ;
generic_args = "[" generic_arg { "," generic_arg } "]" ;
generic_arg = identifier ":" value ;
port_connections = port_connection { "," port_connection } ;
port_connection = identifier ":" expression ;
```

### 3.4.2 基本インスタンス

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

### 3.4.3 配列インスタンス

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

### 3.4.4 階層アクセス

```rust
// 子モジュールの信号へのアクセス（デバッグ用）
#[debug_only]
let debug_count = counter1.count_reg;
```

---

## 3.5 外部モジュール（Verilog連携）

### 3.5.1 外部モジュール宣言

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

### 3.5.2 外部モジュールの使用

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

---

## 3.6 モジュール属性

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

[<< 型システム](./02_type_system.md) | [目次](./iris_spec_0.1.0.md) | [組み合わせ論理 >>](./04_combinational_logic.md)
