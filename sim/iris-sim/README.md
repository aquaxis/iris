# IRIS-SIM

IRIS言語で記述されたRTL設計をシミュレーションし、波形ファイルを出力するツール。

## 目次

- [必要環境](#必要環境)
- [ビルド方法](#ビルド方法)
- [クイックスタート](#クイックスタート)
- [iris-sim（インタプリタ型）](#iris-simインタプリタ型シミュレータ)
- [iris-compile（コンパイル型）](#iris-compileコンパイル型シミュレータ生成)
- [IRIS言語サンプル](#iris言語サンプル)
- [トラブルシューティング](#トラブルシューティング)

---

## 必要環境

### 必須

| ソフトウェア | バージョン | 確認コマンド |
|-------------|-----------|-------------|
| Rust | 1.70以降 | `rustc --version` |
| Cargo | 1.70以降 | `cargo --version` |

### オプション

| ソフトウェア | 用途 |
|-------------|------|
| GTKWave | 波形ファイルの閲覧 |

---

## ビルド方法

### 1. リポジトリのクローン

```bash
git clone <repository-url>
cd iris/sim
```

### 2. ビルド

```bash
cd iris-sim

# デバッグビルド（開発用）
cargo build

# リリースビルド（本番用、最適化有効）
cargo build --release
```

### 3. ビルド成果物の確認

```bash
# デバッグビルドの場合
ls -la target/debug/iris-sim
ls -la target/debug/iris-compile

# リリースビルドの場合
ls -la target/release/iris-sim
ls -la target/release/iris-compile
```

### 4. インストール（オプション）

#### ローカルインストール（推奨）

```bash
cargo install --path .
```

インストール先: `~/.cargo/bin/iris-sim`, `~/.cargo/bin/iris-compile`

PATHに `~/.cargo/bin` が含まれていることを確認:
```bash
echo $PATH | grep -q ".cargo/bin" && echo "OK" || echo "PATHに追加してください"
```

#### システムワイドインストール

```bash
cargo build --release
sudo cp target/release/iris-sim /usr/local/bin/
sudo cp target/release/iris-compile /usr/local/bin/
```

### 5. インストール確認

```bash
iris-sim --version
iris-compile --version
```

---

## クイックスタート

### ステップ1: IRISファイルの作成

**counter.iris** - 8ビットカウンタモジュール:
```iris
mod Counter(
    in  clk: clock,
    in  rst: reset,
    in  enable: bit,
    out count: bit[8],
) {
    var counter: bit[8] = 0;

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

**counter_tb.iris** - テストベンチ:
```iris
test CounterTB {
    let clk: clock;
    let rst: reset;

    var enable_sig: bit = 0;
    var cycle_count: bit[16] = 0;
    var count_out: bit[8] = 0;

    inst dut = Counter {
        clk: clk,
        rst: rst,
        enable: enable_sig,
    };

    sync(clk.posedge, rst.async) {
        cycle_count = cycle_count + 1;

        if cycle_count == 16'd5 {
            enable_sig = 1;
        }
    }

    comb {
        count_out = dut.count;
    }
}
```

### ステップ2: シミュレーション実行

```bash
# インタプリタ型で実行
iris-sim -i counter.iris -i counter_tb.iris -o output.vcd -c 100 -v

# または cargo run で実行（ビルド前でも可）
cargo run -- -i tests/counter.iris -i tests/counter_tb.iris -o output.vcd -c 100 -v
```

### ステップ3: 波形の確認

```bash
gtkwave output.vcd
```

### ステップ4: 高速シミュレーション（コンパイル型）

```bash
# コンパイル型シミュレータを生成
iris-compile -i counter.iris -o counter_sim --release -v

# 生成されたシミュレータで実行（約3,800倍高速）
./counter_sim/target/release/counter-sim 10000 output.vcd
```

---

## iris-sim（インタプリタ型シミュレータ）

### 基本的な使い方

```bash
# 単一ファイルのシミュレーション
iris-sim -i input.iris -o output.vcd -c 100

# 複数ファイルのシミュレーション
iris-sim -i module.iris -i testbench.iris -o output.vcd -c 100
```

### コマンドラインオプション

| オプション | 短縮形 | 説明 | デフォルト |
|-----------|--------|------|-----------|
| `--input <FILE>` | `-i` | 入力IRISファイル（複数指定可） | 必須 |
| `--output <FILE>` | `-o` | 出力波形ファイル（.vcd） | 必須 |
| `--cycles <N>` | `-c` | シミュレーションサイクル数 | 100 |
| `--top <MODULE>` | `-t` | トップモジュール名 | 自動検出 |
| `--warn-metastability` | `-W` | メタステーブル警告を有効化 | 無効 |
| `--verbose` | `-v` | 詳細出力 | 無効 |
| `--help` | `-h` | ヘルプ表示 | - |
| `--version` | `-V` | バージョン表示 | - |

### 実行例

```bash
# VCD形式で出力（詳細表示）
iris-sim -i counter.iris -o counter.vcd -c 100 -v

# トップモジュールを指定
iris-sim -i design.iris -i tb.iris -o sim.vcd -c 500 --top TestBench

# メタステーブル警告を有効化
iris-sim -i counter.iris -i counter_tb.iris -o out.vcd -c 100 -W
```

---

## iris-compile（コンパイル型シミュレータ生成）

IRISソースからスタンドアロンのRust実行ファイルを生成するツール。インタプリタ型と比較して最大約3,800倍の高速化が可能。

**注意**: `test`宣言を含むテストベンチファイルが必須です。

### 基本的な使い方

```bash
# テストベンチとDUTをコンパイル（必須構成）
iris-compile -i counter.iris -i counter_tb.iris -o counter_sim --release

# Rustソースコードのみ生成
iris-compile -i counter.iris -i counter_tb.iris -o counter_sim.rs

# ビルドまで実行（デバッグ）
iris-compile -i counter.iris -i counter_tb.iris -o counter_sim --build
```

### コマンドラインオプション

| オプション | 短縮形 | 説明 | デフォルト |
|-----------|--------|------|-----------|
| `--input <FILE>` | `-i` | 入力IRISファイル（複数指定可） | 必須 |
| `--output <FILE>` | `-o` | 出力ファイルパス | 必須 |
| `--build` | - | 生成後にcargo buildを実行 | 無効 |
| `--release` | - | リリースビルド（--buildを含む） | 無効 |
| `--runtime-path <PATH>` | - | iris-runtimeクレートのパス | 自動検出 |
| `--top <MODULE>` | `-t` | トップモジュール名 | 自動検出 |
| `--verbose` | `-v` | 詳細出力 | 無効 |
| `--help` | `-h` | ヘルプ表示 | - |

### 生成されるファイル構成

```
counter_sim/
├── Cargo.toml          # 生成されたプロジェクト設定
├── src/
│   └── main.rs         # 生成されたシミュレーションコード
└── target/
    └── release/
        └── counter-sim # 実行ファイル
```

### 生成されたシミュレータの使い方

```bash
# コマンドライン引数
./counter_sim/target/release/counter-sim [CYCLES] [OUTPUT_FILE]

# 例: 10000サイクル実行、VCD出力
./counter_sim/target/release/counter-sim 10000 output.vcd

# 引数省略時はデフォルト値を使用
./counter_sim/target/release/counter-sim
```

### パフォーマンス比較

| 実行方式 | 10,000サイクル | 速度比 |
|---------|---------------|--------|
| インタプリタ（iris-sim） | 約19秒 | 1x（基準） |
| コンパイル（debug） | 約0.2秒 | 約96倍 |
| コンパイル（release） | 約0.005秒 | **約3,800倍** |

### テスト宣言のコンパイル

`test` 宣言を使用したテストベンチは、DUTモジュールと一緒にコンパイルできます。

```bash
# テストベンチとDUTをまとめてコンパイル
iris-compile -i counter.iris -i counter_tb.iris -o counter_tb_sim --release --runtime-path ./iris-runtime

# 生成されたテストシミュレータを実行
./counter_tb_sim 100 output.vcd
```

**出力例:**
```
Simulation completed: 100 cycles
Final values:
  dut.counter: 100
  test_result: 1
  test_pass: 1
```

テスト宣言のコンパイル時の特徴:
- `test` キーワードを持つモジュールが自動検出される
- `inst` 構文でインスタンス化されたDUTも自動的にコンパイルされる
- DUT内部の信号への階層参照（例: `dut.count`）がサポートされる
- テスト変数とDUT信号の両方が波形出力に含まれる

**テストベンチ例（counter_tb.iris）:**
```iris
test CounterTB {
    let clk: clock;
    let rst: reset;

    var enable_sig: bit = 1;
    var cycle_count: bit[16] = 0;
    var test_result: bit = 0;
    var count_out: bit[8] = 0;
    var test_pass: bit = 0;

    inst dut = Counter {
        clk: clk,
        rst: rst,
        enable: enable_sig,
    };

    sync(clk.posedge, rst.async) {
        cycle_count = cycle_count + 1;
        if cycle_count == 16'd50 {
            test_result = 1;
        }
    }

    comb {
        count_out = dut.count;
        test_pass = test_result;
    }
}
```

---

## IRIS言語サンプル

### カウンタモジュール

```iris
mod Counter(
    in  clk: clock,
    in  rst: reset,
    in  enable: bit,
    out count: bit[8],
) {
    var counter: bit[8] = 0;

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

### FSM（状態機械）

```iris
mod TrafficLight(
    in  clk: clock,
    in  rst: reset,
    out red: bit,
    out yellow: bit,
    out green: bit,
) {
    var timer: bit[8] = 0;

    fsm controller(clk.posedge, rst.async) {
        state Red[red=1, yellow=0, green=0];
        state Green[red=0, yellow=0, green=1];
        state Yellow[red=0, yellow=1, green=0];

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

    sync(clk.posedge, rst.async) {
        timer = timer + 1;
    }
}
```

### テストベンチ

```iris
test CounterTB {
    let clk: clock;
    let rst: reset;

    var enable_sig: bit = 0;
    var cycle_count: bit[16] = 0;

    inst dut = Counter {
        clk: clk,
        rst: rst,
        enable: enable_sig,
    };

    sync(clk.posedge, rst.async) {
        cycle_count = cycle_count + 1;

        if cycle_count == 16'd5 {
            enable_sig = 1;
        }
    }

    initial {
        assert dut.count == 8'd0, "Initial count should be 0";
    }

    seq {
        await clk.cycles(50);
        assert dut.count == 8'd45, "Count should be 45 after 50 cycles";
    }
}
```

---

## 出力形式

| 形式 | 拡張子 | 説明 |
|------|--------|------|
| VCD | `.vcd` | IEEE 1364標準テキスト形式 |

### 波形の閲覧

```bash
# GTKWaveで波形を開く
gtkwave output.vcd
```

---

## ディレクトリ構成

```
iris-sim/
├── Cargo.toml              # プロジェクト設定
├── Cargo.lock              # 依存関係ロック
├── README.md               # このファイル
├── src/
│   ├── main.rs             # iris-sim エントリーポイント
│   ├── lib.rs              # ライブラリルート
│   ├── project.rs          # プロジェクト管理
│   ├── bin/
│   │   └── iris-compile.rs # iris-compile エントリーポイント
│   ├── parser/             # IRISパーサー
│   │   ├── mod.rs
│   │   ├── ast.rs          # AST定義
│   │   ├── grammar.rs      # 構文解析
│   │   └── iris.pest       # PEG文法定義
│   ├── sim/                # シミュレーションエンジン
│   │   ├── mod.rs
│   │   ├── engine.rs       # シミュレータ
│   │   ├── eval.rs         # 式評価器
│   │   ├── hierarchy.rs    # 階層シミュレータ
│   │   └── trace.rs        # 信号トレース
│   ├── fst/                # 波形出力
│   │   ├── mod.rs
│   │   └── writer.rs       # VCD出力
│   ├── compile/            # コード生成
│   │   ├── mod.rs
│   │   └── codegen.rs      # Rustコード生成
│   └── types/              # 共通型
│       ├── mod.rs
│       ├── signal.rs       # SignalValue
│       └── time.rs         # SimTime
└── tests/                  # テストファイル
    ├── counter.iris
    ├── counter_tb.iris
    ├── fsm_test.iris
    └── ...
```

---

## 対応機能

### パーサー機能
- mod/test宣言
- comb/syncブロック
- seq_block/initial_block
- FSM（状態機械）構文
- メモリ宣言（RAM/ROM）
- インターフェース定義
- for/while ループ
- inst（モジュールインスタンス化）

### シミュレーション機能
- 組み合わせ論理/順序論理
- 複数モジュール階層シミュレーション
- メタステーブル検出警告
- アサーション（assert文）

---

## トラブルシューティング

### ビルドエラー

**エラー: Rustのバージョンが古い**
```
error: package requires rustc 1.70 or newer
```
→ Rustを更新:
```bash
rustup update stable
```

### 実行時エラー

**エラー: モジュールが見つからない**
```
Error: Module 'Counter' not found
```
→ `-i` オプションで全てのソースファイルを指定:
```bash
iris-sim -i counter.iris -i counter_tb.iris -o output.vcd -c 100
```

**エラー: トップモジュールが特定できない**
```
Error: Multiple test modules found
```
→ `--top` オプションでトップモジュールを明示:
```bash
iris-sim -i file1.iris -i file2.iris -o output.vcd -c 100 --top MyTestBench
```

### 波形が表示されない

**GTKWaveでファイルが開けない**
→ 出力ファイルの拡張子が `.vcd` であることを確認。

---

## 関連プロジェクト

- **iris-runtime** - コンパイル型シミュレータ用ランタイムライブラリ
- **IRIS言語仕様** - ../spec/ ディレクトリ

## ライセンス

MIT License
