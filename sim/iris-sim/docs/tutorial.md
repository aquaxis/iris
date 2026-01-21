# IRIS言語チュートリアル

IRIS（Integrated RTL Implementation Syntax）は、ハードウェア記述のための現代的な言語です。このチュートリアルでは、IRISの基本から実践的なRTL設計までを学びます。

## 目次

1. [はじめに](#1-はじめに)
2. [環境構築](#2-環境構築)
3. [最初のモジュール](#3-最初のモジュール)
4. [組み合わせ論理](#4-組み合わせ論理)
5. [順序論理](#5-順序論理)
6. [テストベンチの作成](#6-テストベンチの作成)
7. [階層設計](#7-階層設計)
8. [FSM（状態機械）](#8-fsm状態機械)
9. [メモリの使用](#9-メモリの使用)
10. [高速シミュレーション](#10-高速シミュレーション)

---

## 1. はじめに

### IRISとは

IRISは、Rustに影響を受けた文法を持つハードウェア記述言語です。以下の特徴があります：

- **型安全**: ビット幅の不一致をコンパイル時に検出
- **明確な意図**: 組み合わせ論理（comb）と順序論理（sync）を明示的に分離
- **現代的な文法**: Rust風の読みやすい構文
- **高速シミュレーション**: コンパイル型で最大3,800倍高速

### 学習の流れ

```
基本構文 → 組み合わせ論理 → 順序論理 → テストベンチ → 階層設計 → 応用
```

---

## 2. 環境構築

### 必要なもの

- Rust 1.70以降
- iris-sim（シミュレータ）
- GTKWave（波形閲覧、オプション）

### インストール

```bash
# iris-simのビルド
cd iris-sim
cargo build --release

# パスに追加（オプション）
cargo install --path .

# 確認
iris-sim --version
```

### 最初の実行

```bash
# サンプルファイルをシミュレーション
iris-sim -i tests/counter.iris -i tests/counter_tb.iris -o output.vcd -c 100 -v

# 波形を確認
gtkwave output.vcd
```

---

## 3. 最初のモジュール

### Hello, IRIS!

最もシンプルなモジュールから始めましょう。

```iris
// inverter.iris - インバータ（NOT ゲート）
mod Inverter(
    in  a: bit,
    out y: bit,
) {
    comb {
        y = !a;
    }
}
```

### モジュールの構造

```iris
mod モジュール名(
    ポート宣言,
) {
    内部信号宣言
    ロジックブロック
}
```

### ポートの種類

| キーワード | 方向 | 説明 |
|-----------|------|------|
| `in` | 入力 | モジュールへの入力 |
| `out` | 出力 | モジュールからの出力 |
| `inout` | 双方向 | 入出力（トライステート） |

### 基本的な型

| 型 | 説明 | 例 |
|---|------|-----|
| `bit` | 1ビット信号 | `in a: bit` |
| `bit[N]` | Nビットベクタ | `out data: bit[8]` |
| `clock` | クロック信号 | `in clk: clock` |
| `reset` | リセット信号 | `in rst: reset` |

---

## 4. 組み合わせ論理

### combブロック

組み合わせ論理は `comb` ブロックに記述します。

```iris
mod ALU(
    in  a: bit[8],
    in  b: bit[8],
    in  op: bit[2],
    out result: bit[8],
) {
    comb {
        if op == 2'b00 {
            result = a + b;      // 加算
        } else if op == 2'b01 {
            result = a - b;      // 減算
        } else if op == 2'b10 {
            result = a & b;      // AND
        } else {
            result = a | b;      // OR
        }
    }
}
```

### 演算子

#### 算術演算子
| 演算子 | 説明 |
|--------|------|
| `+` | 加算 |
| `-` | 減算 |
| `*` | 乗算 |
| `/` | 除算 |
| `%` | 剰余 |

#### ビット演算子
| 演算子 | 説明 |
|--------|------|
| `&` | AND |
| `\|` | OR |
| `^` | XOR |
| `~` | NOT |
| `<<` | 左シフト |
| `>>` | 右シフト |

#### 比較演算子
| 演算子 | 説明 |
|--------|------|
| `==` | 等しい |
| `!=` | 等しくない |
| `<` | 小なり |
| `<=` | 以下 |
| `>` | 大なり |
| `>=` | 以上 |

### 数値リテラル

```iris
// ビット幅'基数 値
8'b10101010    // 8ビット 2進数
8'hAB          // 8ビット 16進数
8'd170         // 8ビット 10進数
16'd1000       // 16ビット 10進数
```

### let宣言（内部信号）

```iris
mod Example(
    in  a: bit[8],
    in  b: bit[8],
    out sum: bit[8],
    out carry: bit,
) {
    // 内部の中間信号
    let result: bit[9];

    comb {
        result = {1'b0, a} + {1'b0, b};  // 9ビット加算
        sum = result[7:0];               // 下位8ビット
        carry = result[8];               // キャリー
    }
}
```

---

## 5. 順序論理

### syncブロック

順序論理（レジスタ）は `sync` ブロックに記述します。

```iris
mod Counter(
    in  clk: clock,
    in  rst: reset,
    in  enable: bit,
    out count: bit[8],
) {
    var counter: bit[8] = 0;  // レジスタ（初期値0）

    sync(clk.posedge, rst.async) {
        // リセット時: counter = 0（初期値）
        // 通常時:
        if enable {
            counter = counter + 1;
        }
    }

    comb {
        count = counter;
    }
}
```

### var宣言（レジスタ）

```iris
var 名前: 型 = 初期値;
```

- `var` はレジスタ（フリップフロップ）を生成
- `let` は組み合わせ論理の中間信号

### クロックエッジ

| 指定 | 説明 |
|------|------|
| `clk.posedge` | 立ち上がりエッジ |
| `clk.negedge` | 立ち下がりエッジ |

### リセットモード

| 指定 | 説明 |
|------|------|
| `rst.async` | 非同期リセット |
| `rst.sync` | 同期リセット |

### シフトレジスタの例

```iris
mod ShiftRegister(
    in  clk: clock,
    in  rst: reset,
    in  din: bit,
    out dout: bit,
) {
    var reg: bit[8] = 0;

    sync(clk.posedge, rst.async) {
        reg = {reg[6:0], din};  // 左シフト、dinを入力
    }

    comb {
        dout = reg[7];  // 最上位ビットを出力
    }
}
```

---

## 6. テストベンチの作成

### test宣言

テストベンチは `test` キーワードで宣言します。ポートは不要です。

```iris
test CounterTest {
    // クロック・リセットは自動生成
    let clk: clock;
    let rst: reset;

    // テスト用信号
    var enable_sig: bit = 0;
    var cycle_count: bit[16] = 0;

    // DUT（テスト対象）のインスタンス化
    inst dut = Counter {
        clk: clk,
        rst: rst,
        enable: enable_sig,
    };

    // テストシーケンス
    sync(clk.posedge, rst.async) {
        cycle_count = cycle_count + 1;

        // 5サイクル後にenableをアサート
        if cycle_count == 16'd5 {
            enable_sig = 1;
        }
    }
}
```

### シミュレーション実行

```bash
# CounterとCounterTestを一緒にシミュレーション
iris-sim -i counter.iris -i counter_test.iris -o output.vcd -c 100 -v
```

### 階層信号の参照

テストベンチからDUT内部の信号を参照できます：

```iris
comb {
    // dut内部のcounterレジスタを参照
    observed_count = dut.counter;
}
```

### アサーション

```iris
test AssertionExample {
    let clk: clock;
    let rst: reset;

    var value: bit[8] = 0;

    sync(clk.posedge, rst.async) {
        value = value + 1;
    }

    // initial ブロック - シミュレーション開始時に1回実行
    initial {
        assert value == 8'd0, "Initial value should be 0";
    }

    // seq ブロック - シーケンシャルテスト
    seq {
        await clk.cycles(10);
        assert value == 8'd10, "Value should be 10 after 10 cycles";
    }
}
```

---

## 7. 階層設計

### モジュールのインスタンス化

```iris
mod TopModule(
    in  clk: clock,
    in  rst: reset,
    in  start: bit,
    out done: bit,
    out result: bit[16],
) {
    // 内部信号
    var count_a: bit[8] = 0;
    var count_b: bit[8] = 0;

    // サブモジュールのインスタンス化
    inst counter1 = Counter {
        clk: clk,
        rst: rst,
        enable: start,
    };

    inst counter2 = Counter {
        clk: clk,
        rst: rst,
        enable: start,
    };

    comb {
        // サブモジュールの出力を結合
        result = {counter1.count, counter2.count};
        done = (counter1.count == 8'hFF) & (counter2.count == 8'hFF);
    }
}
```

### 複数ファイルでの設計

```bash
# 全てのファイルを指定
iris-sim -i counter.iris -i alu.iris -i top.iris -i testbench.iris -o output.vcd -c 1000
```

---

## 8. FSM（状態機械）

### 基本的なFSM

```iris
mod TrafficLight(
    in  clk: clock,
    in  rst: reset,
    out red: bit,
    out yellow: bit,
    out green: bit,
) {
    var timer: bit[8] = 0;

    // FSM定義
    fsm controller(clk.posedge, rst.async) {
        // 状態定義（Moore出力付き）
        state Red[red=1, yellow=0, green=0];
        state Green[red=0, yellow=0, green=1];
        state Yellow[red=0, yellow=1, green=0];

        // 状態遷移
        transitions {
            Red => {
                when timer >= 8'd30 { goto Green; timer = 0; }
            }
            Green => {
                when timer >= 8'd25 { goto Yellow; timer = 0; }
            }
            Yellow => {
                when timer >= 8'd5 { goto Red; timer = 0; }
            }
        }
    }

    // タイマーカウント
    sync(clk.posedge, rst.async) {
        timer = timer + 1;
    }
}
```

### FSMの構造

1. **state定義**: 各状態とMoore出力を定義
2. **transitions**: 状態遷移条件を定義
3. **when句**: 遷移条件
4. **goto**: 次の状態へ遷移

---

## 9. メモリの使用

### RAM宣言

```iris
mod RAMExample(
    in  clk: clock,
    in  rst: reset,
    in  addr: bit[8],
    in  din: bit[8],
    in  we: bit,
    out dout: bit[8],
) {
    // 256エントリ x 8ビットのRAM
    mem data_ram: bit[8][256] { type: ram, read_mode: async };

    sync(clk.posedge, rst.async) {
        if we {
            data_ram[addr] = din;  // 書き込み
        }
    }

    comb {
        dout = data_ram[addr];  // 読み出し
    }
}
```

### ROM宣言（初期値付き）

```iris
mod ROMExample(
    in  addr: bit[4],
    out data: bit[8],
) {
    // 16エントリのROM（初期値付き）
    mem lookup_table: bit[8][16] { type: rom } = {
        8'h00, 8'h01, 8'h04, 8'h09,
        8'h10, 8'h19, 8'h24, 8'h31,
        8'h40, 8'h51, 8'h64, 8'h79,
        8'h90, 8'hA9, 8'hC4, 8'hE1
    };

    comb {
        data = lookup_table[addr];
    }
}
```

---

## 10. 高速シミュレーション

### コンパイル型シミュレーション

大規模なシミュレーションには、コンパイル型シミュレータを使用します。

```bash
# Rustコードを生成してビルド
iris-compile -i counter.iris -o counter_sim --release -v

# 生成されたシミュレータで実行（約3,800倍高速）
./counter_sim/target/release/counter-sim 1000000 output.vcd
```

### パフォーマンス比較

| 方式 | 10,000サイクル | 用途 |
|------|---------------|------|
| インタプリタ | 約19秒 | 開発・デバッグ |
| コンパイル（release） | 約0.005秒 | 大規模シミュレーション |

---

## 次のステップ

1. [IRIS言語リファレンス](reference.md) - 詳細な構文仕様
2. [サンプル集](examples.md) - 実践的な設計パターン
3. [開発者ガイド](developer-guide.md) - iris-simの内部構造

---

## よくある質問

### Q: VerilogやVHDLとの違いは？

IRISはRust風の文法を採用し、以下の点で異なります：
- `comb`/`sync` による明示的な論理種別の分離
- 型安全なビット操作
- テストベンチ用の `test` 宣言

### Q: シミュレーション結果がおかしい

1. リセットが正しくアサートされているか確認
2. 波形ファイルで信号の変化を確認
3. `-v` オプションで詳細出力を有効化

### Q: ビルドエラーが出る

```bash
# Cコンパイラのインストール（Ubuntu/Debian）
sudo apt install build-essential

# Rustの更新
rustup update stable
```
