# 第20章 チュートリアル

[<< FAQ](./19_faq.md) | [目次](./iris_spec_0.1.0.md) | [IDE連携ガイド >>](./21_ide_guide.md)

---

このチュートリアルでは、IRIS言語の基本を段階的に学びます。SystemVerilogやVerilogの経験がなくても、ハードウェア記述の基礎から学ぶことができます。

---

## 20.1 はじめに：最初のモジュール

### ステップ1：LEDを点灯させる

最も簡単なモジュールから始めましょう。LED出力を常にONにするモジュールです。

```rust
/// 最初のIRISモジュール
mod LedOn(
    out led: bit,    // 1ビット出力
) {
    comb {
        led = 1'b1;  // 常にHIGH
    }
}
```

**ポイント：**
- `mod`でモジュールを宣言
- `out`は出力ポート
- `bit`は1ビット型
- `comb`ブロックで組み合わせ論理を記述
- `1'b1`は1ビットの値1

### ステップ2：スイッチでLEDを制御

入力スイッチでLEDを制御するモジュールです。

```rust
/// スイッチでLED制御
mod LedSwitch(
    in  sw: bit,     // 入力スイッチ
    out led: bit,    // 出力LED
) {
    comb {
        led = sw;    // スイッチの状態をそのまま出力
    }
}
```

**ポイント：**
- `in`は入力ポート
- 入力をそのまま出力に接続

### ステップ3：NOTゲート

入力を反転して出力します。

```rust
/// NOTゲート
mod NotGate(
    in  a: bit,
    out y: bit,
) {
    comb {
        y = !a;      // 論理NOT
    }
}
```

---

## 20.2 複数ビットの信号

### ステップ4：8ビット加算器

複数ビットの信号を扱ってみましょう。

```rust
/// 8ビット加算器
mod Adder8(
    in  a: bit[8],       // 8ビット入力A
    in  b: bit[8],       // 8ビット入力B
    out sum: bit[8],     // 8ビット出力（和）
    out carry: bit,      // キャリー出力
) {
    // 内部信号
    let result: bit[9];  // 9ビット（オーバーフロー対応）

    comb {
        result = a.extend[9] + b.extend[9];  // 9ビットに拡張して加算
        sum = result[7:0];                    // 下位8ビット
        carry = result[8];                    // 最上位ビット
    }
}
```

**ポイント：**
- `bit[8]`は8ビット型
- `let`で内部信号を宣言
- `.extend[9]`でビット幅を拡張
- `[7:0]`でビットスライス（部分抽出）

### ステップ5：マルチプレクサ（MUX）

選択信号に応じて入力を切り替えます。

```rust
/// 2入力マルチプレクサ
mod Mux2(
    in  sel: bit,        // 選択信号
    in  d0: bit[8],      // 入力0
    in  d1: bit[8],      // 入力1
    out y: bit[8],       // 出力
) {
    comb {
        y = if sel { d1 } else { d0 };
    }
}
```

**ポイント：**
- `if-else`式で条件分岐
- 組み合わせ論理では必ず`else`が必要

### ステップ6：4入力マルチプレクサ（match式）

`match`式を使ってより多くの入力を切り替えます。

```rust
/// 4入力マルチプレクサ
mod Mux4(
    in  sel: bit[2],     // 2ビット選択信号
    in  d0: bit[8],
    in  d1: bit[8],
    in  d2: bit[8],
    in  d3: bit[8],
    out y: bit[8],
) {
    comb {
        y = match sel {
            2'b00 => d0,
            2'b01 => d1,
            2'b10 => d2,
            2'b11 => d3,
        };
    }
}
```

**ポイント：**
- `match`式ですべてのケースを網羅
- `2'b00`は2ビットの2進数値

---

## 20.3 順序回路（レジスタ）

### ステップ7：Dフリップフロップ

クロックに同期してデータを保持します。

```rust
/// Dフリップフロップ
mod DFlipFlop(
    in  clk: clock,      // クロック入力
    in  d: bit,          // データ入力
    out q: bit,          // データ出力
) {
    var reg: bit = 0;    // レジスタ（初期値0）

    sync(clk.posedge) {  // クロック立ち上がりで動作
        reg = d;
    }

    comb {
        q = reg;
    }
}
```

**ポイント：**
- `clock`型はクロック専用
- `var`は順序回路用の信号宣言（sync/fsm内でのみ使用可能）
- `sync(clk.posedge)`で立ち上がりエッジ同期
- 初期値`= 0`はリセット時の値

### ステップ8：リセット付きレジスタ

リセット機能を追加します。

```rust
/// リセット付きレジスタ
mod RegWithReset(
    in  clk: clock,
    in  rst: reset,      // リセット入力
    in  d: bit[8],
    out q: bit[8],
) {
    var reg: bit[8] = 0; // リセット時は0

    sync(clk.posedge, rst.async) {  // 非同期リセット
        reg = d;
    }

    comb {
        q = reg;
    }
}
```

**ポイント：**
- `reset`型はリセット専用
- `rst.async`は非同期リセット
- `rst.sync`は同期リセット

---

## 20.4 カウンタを作る

### ステップ9：基本カウンタ

クロックごとにカウントアップします。

```rust
/// 基本カウンタ
mod Counter(
    in  clk: clock,
    in  rst: reset,
    in  enable: bit,     // カウント有効
    out count: bit[8],
) {
    var counter: bit[8] = 0;

    sync(clk.posedge, rst.async) {
        if enable {
            counter = counter + 1;
        }
        // enableが0の場合、counterは保持される（暗黙のelse）
    }

    comb {
        count = counter;
    }
}
```

**ポイント：**
- `if`のみでも可（else省略時は値が保持される）
- 順序回路では暗黙の保持がある

### ステップ10：ロード機能付きカウンタ

外部から値をロードできるカウンタです。

```rust
/// ロード機能付きカウンタ
mod LoadableCounter(
    in  clk: clock,
    in  rst: reset,
    in  enable: bit,
    in  load: bit,           // ロード信号
    in  load_value: bit[8],  // ロード値
    out count: bit[8],
    out overflow: bit,       // オーバーフロー
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
        overflow = enable && (counter == 8'hFF);
    }
}
```

---

## 20.5 パラメータ化

### ステップ11：パラメータ化カウンタ

ビット幅をパラメータ化します。

```rust
/// パラメータ化カウンタ
mod Counter[Width: uint = 8]  // デフォルト8ビット
where
    Width >= 1,               // 制約条件
    Width <= 32
(
    in  clk: clock,
    in  rst: reset,
    in  enable: bit,
    out count: bit[Width],    // Widthビット幅
) {
    var counter: bit[Width] = 0;

    sync(clk.posedge, rst.async) {
        if enable {
            counter = counter + 1;
        }
    }

    comb {
        count = counter;
    }
}
```

**ポイント：**
- `[Width: uint = 8]`でパラメータを定義
- `where`で制約条件を指定
- 使用時は`Counter[Width: 16]`のように指定

---

## 20.6 モジュールのインスタンス化

### ステップ12：モジュールを組み合わせる

作成したモジュールを組み合わせます。

```rust
/// トップモジュール
mod Top(
    in  clk: clock,
    in  rst: reset,
    in  btn: bit,
    out led: bit[8],
) {
    // カウンタをインスタンス化
    inst counter = Counter[Width: 8] {
        clk: clk,
        rst: rst,
        enable: btn,
        count: led
    };
}
```

**ポイント：**
- `inst`でモジュールをインスタンス化
- ポートを名前で接続

---

## 20.7 FSM（有限状態機械）

### ステップ13：簡単なFSM

3状態のLED制御FSMです。

```rust
/// LED制御FSM
mod LedController(
    in  clk: clock,
    in  rst: reset,
    in  btn: bit,
    out led: bit[3],
) {
    fsm Controller(clk.posedge, rst.async) {
        state enum {
            Idle    [led = 3'b001],  // Moore出力
            Active  [led = 3'b010],
            Done    [led = 3'b100]
        }

        transitions {
            Idle => {
                when btn { goto Active; }
            }
            Active => {
                when !btn { goto Done; }
            }
            Done => {
                when btn { goto Idle; }
            }
        }
    }
}
```

**ポイント：**
- `fsm`ブロックでFSMを定義
- `state enum`で状態を宣言（[]内はMoore出力）
- `transitions`で遷移を記述
- `when`で条件、`goto`で遷移先

---

## 20.8 次のステップ

このチュートリアルでは基本を学びました。さらに学ぶには：

1. **第16章 サンプルコード集** - より実践的なサンプル
2. **第4章 組み合わせ論理** - combブロックの詳細
3. **第5章 順序論理** - syncブロックの詳細
4. **第6章 FSM** - 状態機械の詳細
5. **第18章 FAQ** - よくある質問

---

## 20.9 クイックリファレンス

### 信号宣言

```rust
let signal = expr;           // 組み合わせ回路（直接代入）
let signal: bit[8];          // 信号宣言（使用場所で決定）
var signal: bit[8] = 0;      // 順序回路専用（sync/fsmのみ）
const VALUE: uint = 42;      // 定数
```

### ブロック

```rust
comb { ... }                 // 組み合わせ論理
sync(clk.posedge) { ... }    // 順序論理
sync(clk.posedge, rst.async) { ... }  // リセット付き
fsm Name(clk.posedge, rst.async) { ... }  // FSM
```

### 型

```rust
bit                          // 1ビット
bit[8]                       // 8ビット
bit[8][4]                    // 8ビット×4要素の配列
clock                        // クロック
reset                        // リセット
```

### リテラル

```rust
1'b0, 1'b1                   // 1ビット2進数
8'hFF                        // 8ビット16進数
8'd255                       // 8ビット10進数
4'b1010                      // 4ビット2進数
```

---

[<< FAQ](./19_faq.md) | [目次](./iris_spec_0.1.0.md) | [IDE連携ガイド >>](./21_ide_guide.md)
