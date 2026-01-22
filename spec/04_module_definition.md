# 第4章 モジュール定義

[<< 型システム](./03_type_system.md) | [目次](./iris_spec_0.1.0.md) | [組み合わせ論理 >>](./05_combinational_logic.md)

---

## 4.1 モジュール構文

### 4.1.1 基本構文（EBNF）

```ebnf
module_decl = "mod" identifier [ generic_params ] [ where_clause ]
              "(" port_list ")" "{" module_body "}" ;
generic_params = "[" generic_param { "," generic_param } "]" ;
generic_param = identifier ":" type [ "=" default_value ] ;
where_clause = "where" constraint { "," constraint } ;
port_list = { port_decl } ;
port_decl = port_direction identifier ":" type [ "," ] ;
port_direction = "in" | "out" | "inout" ;
module_body = { signal_decl | logic_block | instance } ;
```

**構文の特徴:**
- ポート宣言は`()`内に記述（Rust関数の引数リストに類似）
- モジュール本体は`{}`内に記述
- ポート宣言とモジュール本体が明確に分離される

### 4.1.2 完全な例

```rust
/// 8ビットカウンタ
///
/// # パラメータ
/// - Width: カウンタのビット幅（デフォルト: 8）
mod Counter[Width: uint = 8]
where
    Width >= 1,
    Width <= 32
(
    // ===== ポート宣言 =====
    in  clk: clock,
    in  rst: reset,
    in  enable: bit,
    in  load: bit,
    in  load_value: bit[Width],
    out count: bit[Width],
    out overflow: bit,
) {
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

## 4.2 ポート宣言

### 4.2.1 ポート方向

| キーワード | 説明 | 合成結果 |
|------------|------|----------|
| `in` | 入力ポート | input |
| `out` | 出力ポート | output |
| `inout` | 双方向ポート | inout（トライステート） |

### 4.2.2 ポート宣言構文

ポート宣言は`()`内に記述します。

```ebnf
port_list = { port_decl } ;
port_decl = port_direction identifier ":" type [ "," ] ;
port_direction = "in" | "out" | "inout" ;
```

### 4.2.3 ポート例

```rust
mod Example(
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
) {
    // モジュール本体
}
```

---

## 4.3 信号宣言

### 4.3.1 信号の種類

| 宣言 | 用途 | 使用可能コンテキスト | 回路種別 |
|------|------|---------------------|----------|
| `let 名前 = 式;` | 直接代入 | どこでも | 組み合わせ |
| `let 名前: 型;` | 型のみ宣言 | どこでも | コンテキスト依存 |
| `let mut 名前 = 初期値;` | 可変信号（初期値付き） | sync/fsm推奨 | 順序（リセット値あり） |
| `var 名前: 型;` | 順序回路専用 | **sync/fsmのみ** | 順序 |
| `var 名前 = 初期値;` | 順序回路専用（初期値付き） | **sync/fsmのみ** | 順序（リセット値あり） |
| `const` | モジュール定数 | どこでも | - |
| `mem` | メモリ | モジュール | RAM/ROM |

**重要: `var`の使用制限**

`var`宣言は`sync`または`fsm`ブロック内でのみ使用可能です。`comb`ブロックや直接代入で使用するとコンパイルエラーになります。

**`let` vs `var` vs `let mut` の違い:**

- `let`: 汎用的な信号宣言。直接代入（`let x = expr;`）は組み合わせ回路。`sync`/`fsm`内で代入すると順序回路
- `var`: **順序回路専用**。`sync`/`fsm`ブロックでのみ使用可能
- `let mut`: 可変信号。初期値を指定して`sync`/`fsm`で使用すると、初期値がリセット値となる
- `const`: モジュールレベルまたはパッケージレベルの定数

### 4.3.2 信号の合成セマンティクス

**コンテキストによる合成:**

IRISでは、信号の合成結果は**使用コンテキスト**によって決定されます。

| 使用コンテキスト | 合成結果 | 説明 |
|------------------|----------|------|
| `comb`ブロック内で代入 | 組み合わせ回路（wire） | Verilogの`always_comb`相当 |
| `sync`ブロック内で代入 | 順序回路（register） | Verilogの`always_ff`相当 |
| `fsm`ブロック内で代入 | 順序回路（register） | FSMの状態レジスタ |

**宣言形式と合成結果:**

| 記述方法 | 合成結果 |
|----------|----------|
| `let 名前 = 式;`（`comb`内で代入） | 組み合わせ回路（wire） |
| `let 名前: 型;` + `sync`ブロック内で代入 | 順序回路（リセット値なし） |
| `let 名前: 型 = 初期値;` + `sync`ブロック内で代入 | 順序回路（リセット値あり） |
| `var 名前: 型;` + `sync`ブロック内で代入 | 順序回路（リセット値なし） |
| `var 名前 = 初期値;` + `sync`ブロック内で代入 | 順序回路（リセット値あり） |
| `comb`ブロック内で出力ポートに代入 | 組み合わせ回路（wire） |

**重要:** `let`/`let mut`/`var`のいずれで宣言しても、`sync`または`fsm`ブロック内で代入された場合は順序回路（レジスタ）として合成されます。

### 4.3.3 ポート宣言と信号宣言の同等性

**概要:**

`out`および`inout`ポートは`let`宣言と**同等**として扱われます。ポート宣言自体が信号宣言として機能するため、モジュール内で追加の`let`宣言なしに直接代入や参照が可能です。

**ポートと信号宣言の対応:**

| ポート宣言 | 同等の信号宣言 | 説明 |
|-----------|---------------|------|
| `in x: T` | `let x: T;`（読み取り専用） | 外部から値が供給される |
| `out x: T` | `let x: T;` | モジュール内で値を代入して出力 |
| `inout x: T` | `let x: T;` | 双方向（トライステート） |

**セマンティクス:**

- `out`ポートは`let`と同様に、`comb`ブロックで代入すると組み合わせ回路、`sync`/`fsm`ブロックで代入すると順序回路として合成される
- `inout`ポートも同様のセマンティクスを持つ
- ポート宣言後、モジュール本体で同名の`let`を再宣言する必要はない

**使用例:**

```rust
mod Counter8(
    in  clk: clock,
    in  rst: reset,
    in  enable: bit,
    out count: bit[8],  // out宣言 = let count: bit[8]; と同等
) {
    let counter: bit[8] = 0;

    sync(clk.posedge, rst.async) {
        if enable {
            counter = counter + 1;
        }
    }

    comb {
        count = counter;  // outポートに直接代入可能
    }
}
```

**combでの出力:**

```rust
mod Adder(
    in  a: bit[8],
    in  b: bit[8],
    out sum: bit[8],    // let sum: bit[8]; と同等
    out carry: bit,     // let carry: bit; と同等
) {
    let extended = a.extend[9] + b.extend[9];

    comb {
        sum = extended[7:0];     // outポートに直接代入
        carry = extended[8];     // outポートに直接代入
    }
}
```

**syncでの出力:**

```rust
mod Register(
    in  clk: clock,
    in  rst: reset,
    in  d: bit[8],
    out q: bit[8],      // let q: bit[8]; と同等
) {
    sync(clk.posedge, rst.async) {
        q = d;  // outポートをsyncで代入 → 順序回路
    }
}
```

**設計意図:**

- ポート宣言と信号宣言のセマンティクスを統一し、言語の一貫性を向上
- 冗長な宣言を不要にし、簡潔なコード記述を可能に
- Rustの関数引数と戻り値の概念に近づけた直感的な設計

### 4.3.4 Multi Drive禁止

IRISでは、同一信号への複数箇所からの駆動（multi drive）をコンパイル時にエラーとして検出する。

**規則:**

- 1つの信号は1つのドライバからのみ駆動可能
- 複数の`comb`ブロックや`sync`ブロックから同一信号への代入は禁止
- 条件分岐内での排他的な代入は許可（同一ブロック内の場合）

**エラー例:**

```rust
mod MultiDriveError(
    in  sel: bit,
    in  a: bit[8],
    in  b: bit[8],
    out result: bit[8],
) {
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
mod SingleDriver(
    in  sel: bit,
    in  a: bit[8],
    in  b: bit[8],
    out result: bit[8],
) {
    // 正しい: 単一のcombブロック内で完結
    comb {
        result = if sel { a } else { b };
    }
}
```

### 4.3.5 初期値（オプション）

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

## 4.4 モジュールインスタンス化

### 4.4.1 インスタンス構文

```ebnf
instance = "inst" identifier [ "[" size "]" ] "=" module_type
           [ generic_args ] "{" port_connections "}" ";" ;
generic_args = "[" generic_arg { "," generic_arg } "]" ;
generic_arg = identifier ":" value ;
port_connections = port_connection { "," port_connection } ;
port_connection = identifier ":" expression ;
```

### 4.4.2 基本インスタンス

```rust
mod Top(
    in  sys_clk: clock,
    in  sys_rst: reset,
    out led: bit[8],
) {
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

### 4.4.3 配列インスタンス

```rust
mod Top(
    in  clk: clock,
    in  rst: reset,
    in  enables: bit[4],
    out counts: bit[4][4],
) {
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

### 4.4.4 階層アクセス

```rust
// 子モジュールの信号へのアクセス（デバッグ用）
#[debug_only]
let debug_count = counter1.count_reg;
```

---

## 4.5 外部モジュール（Verilog連携）

### 4.5.1 外部モジュール宣言

```rust
// 既存のVerilogモジュールを宣言
extern mod legacy_uart(
    in  clk: clock,
    in  rst_n: reset(active_low),
    in  tx_data: bit[8],
    in  tx_valid: bit,
    out tx_ready: bit,
    out tx: bit,
);

// パラメータ付き外部モジュール
extern mod legacy_fifo[DEPTH: uint, WIDTH: uint](
    in  clk: clock,
    in  rst: reset,
    in  wr_en: bit,
    in  rd_en: bit,
    in  din: bit[WIDTH],
    out dout: bit[WIDTH],
    out full: bit,
    out empty: bit,
);
```

### 4.5.2 外部モジュールの使用

```rust
mod Top(
    in clk: clock,
    in rst: reset,
) {
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

## 4.6 モジュール属性

```rust
// トップモジュール指定
#[top]
mod TopLevel(...) {
    // ...
}

// クロックドメイン指定
#[clock_domain("fast_clk")]
mod HighSpeedProcessor(...) {
    // ...
}

// 合成オプション
#[synthesis(flatten)]
mod SmallModule(...) {
    // 合成時に親モジュールに展開
}

#[synthesis(keep_hierarchy)]
mod ImportantModule(...) {
    // 階層を維持
}
```

---

[<< 型システム](./03_type_system.md) | [目次](./iris_spec_0.1.0.md) | [組み合わせ論理 >>](./05_combinational_logic.md)
