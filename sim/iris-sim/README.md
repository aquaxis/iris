# IRIS-SIM

IRIS言語で記述されたRTL設計をシミュレーションし、波形ファイルを出力するツール。

## 目次

- [必要環境](#必要環境)
- [ビルド方法](#ビルド方法)
- [クイックスタート](#クイックスタート)
- [iris-sim（インタプリタ型）](#iris-simインタプリタ型シミュレータ)
- [iris-compile（コンパイル型）](#iris-compileコンパイル型シミュレータ生成)
- [iris-formal（形式検証用の基準モデル）](#iris-formal形式検証用の基準モデル)
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

**counter_test.iris** - テストベンチ:
```iris
test CounterTB {
    // クロック・リセットの動作を明示的に設定
    let clk: clock(period: 10ns);                        // 10ns周期（100MHz）
    let rst: reset(active_low: false, assert_time: 50ns); // 50ns間リセットアサート

    var enable_sig: bit = 1;
    var cycle_count: bit[16] = 0;
    var count_out: bit[8] = 0;

    inst dut = Counter {
        clk: clk,
        rst: rst,
        enable: enable_sig,
    };

    sync(clk.posedge, rst.sync) {
        cycle_count = cycle_count + 1;
    }

    comb {
        count_out = dut.count;
    }
}
```

### ステップ2: シミュレーション実行

```bash
# インタプリタ型で実行
iris-sim -i counter.iris -i counter_test.iris -o output.vcd -c 100 -v

# または cargo run で実行（ビルド前でも可）
cargo run -- -i examples/counter.iris -i examples/counter_test.iris -o output.vcd -c 100 -v
```

### ステップ3: 波形の確認

```bash
gtkwave output.vcd
```

### ステップ4: 高速シミュレーション（コンパイル型）

```bash
# 設計をRustプログラムに変換してビルドする
iris-compile -i counter.iris -o counter_sim --release -v

# 生成された実行ファイルで実行する
./counter_sim -c 10000 -o output.vcd
```

生成された実行ファイルは`iris-sim`と同じ波形を出力する。

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
iris-sim -i counter.iris -i counter_test.iris -o out.vcd -c 100 -W
```

---

## iris-compile（コンパイル型シミュレータ生成）

IRISソースからスタンドアロンのRust実行ファイルを生成するツール。

インタプリタが毎ステップ名前で解決していること（信号がどのモジュールに属するか、
どのクロックが`sync`ブロックを駆動するか、ある名前がメモリかレジスタか）を
生成時に決めてしまい、直線的なRustコードとして出力する。
演算そのものは書き直さず、インタプリタと同じ`iris-runtime`の関数を呼ぶ。

`iris-sim`が実行できる設計はすべてコンパイルできる。
複数クロック、メモリ、FSM、入れ子インスタンス、`assert`、`$display`のいずれも扱う。
`test`宣言は必須ではなく、外から駆動する設計もコンパイルできる。

### 基本的な使い方

```bash
# 実行ファイルまで生成する
iris-compile -i counter.iris -o counter_sim --release

# Rustソースコードだけ生成する（拡張子が .rs のとき）
iris-compile -i counter.iris -o counter_sim.rs

# テストベンチとDUTをまとめてコンパイルする
iris-compile -i async_fifo.iris -i async_fifo_tb.iris -o fifo_sim --release
```

### コマンドラインオプション

| オプション | 短縮形 | 説明 | デフォルト |
|-----------|--------|------|-----------|
| `--input <FILE>` | `-i` | 入力IRISファイル（複数指定可） | 必須 |
| `--output <FILE>` | `-o` | 出力パス（`.rs`ならソース、それ以外は実行ファイル） | 必須 |
| `--build` | - | `.rs`を指定した場合もビルドする | 無効 |
| `--release` | - | リリースビルド（`--build`を含む） | 無効 |
| `--runtime-path <PATH>` | - | iris-runtimeクレートのパス | 自動検出 |
| `--top <MODULE>` | `-t` | トップモジュール名 | 自動検出 |
| `--verbose` | `-v` | 詳細出力 | 無効 |
| `--help` | `-h` | ヘルプ表示 | - |

仕様第14章が定める静的検査は`iris-sim`と同じく実行する。
エラーがあればコード生成を始めない。

### 生成されるファイル構成

出力ファイルと同じディレクトリに、cargoプロジェクトを一つ作る。
`-o`で指定した場所には、そこでビルドした実行ファイルを複製する。

```
counter_sim              # -o で指定した実行ファイル
counter_sim_build/       # 生成されたcargoプロジェクト
├── Cargo.toml
├── src/
│   └── main.rs          # 生成されたシミュレーションコード
└── target/
```

cargoプロジェクトの名前は`-o`で指定した名前から作る。
モジュール名から作ると、`-o counter_sim`と`Counter`モジュールの組で
実行ファイルとディレクトリが衝突するためである。

### 生成されたシミュレータの使い方

オプションは`iris-sim`と同じ綴りである。

```bash
# 100サイクル実行し、VCDを書き出す
./counter_sim -c 100 -o counter.vcd

# 最終値まで表示する
./counter_sim -c 100 -o counter.vcd -v

# サイクル数だけなら位置引数でも渡せる
./counter_sim 100
```

| オプション | 短縮形 | 説明 | デフォルト |
|-----------|--------|------|-----------|
| `--cycles <N>` | `-c` | シミュレーションサイクル数 | 100 |
| `--output <FILE>` | `-o` | 出力波形ファイル（.vcd） | 出力しない |
| `--verbose` | `-v` | 実行後に全信号の最終値を表示 | 無効 |
| `--source <FILE>` | `-s` | assert失敗時に表示するソース名 | 生成時の入力ファイル |

### パフォーマンス比較

`example/counter/src/counter.iris`を100,000サイクル実行した場合。

| 実行方式 | 100,000サイクル | 速度比 |
|---------|----------------|--------|
| インタプリタ（iris-sim、release） | 約0.23秒 | 1x（基準） |
| コンパイル（debug） | 約0.34秒 | 約0.7倍 |
| コンパイル（release） | 約0.05秒 | 約4.5倍 |

デバッグビルドはインタプリタより遅い。速度を目的とする場合は`--release`を使う。

### インタプリタとの一致

同じ設計を両方で実行し、波形と全信号の最終値が一致することを回帰テストで確認している
（`tests/compiled.rs`）。
対象はカウンタ、メモリとブロックローカル、`match`とパート選択、符号付き演算、
インスタンス内のFSM、入れ子インスタンス、失敗するassert、
そして`example/async_fifo`そのものである。

```bash
# 例: async_fifoを両方で実行して波形を比べる
cd example/async_fifo/sim
./run.sh            # インタプリタ
./run_compiled.sh   # コンパイル型（末尾で波形の一致を確認する）
```

クイックスタートの2ファイルをコンパイルして100サイクル実行すると、
`iris-sim`と同じ最終値になる。

```bash
iris-compile -i counter.iris -i counter_test.iris -o counter_sim --release
./counter_sim -c 100 -o counter.vcd -v
```

```
Simulation completed successfully.

Final signal values:
  clk: 1'h0
  rst: 1'h0
  enable_sig: 1'h1
  cycle_count: 16'h005f
  count_out: 8'h5f
  dut.clk: 1'h1
  dut.rst: 1'h0
  dut.enable: 1'h1
  dut.count: 8'h5f
  dut.counter: 8'h5f
```

`test`宣言は自動検出され、`inst`でインスタンス化したDUTも一緒にコンパイルされる。
DUT内部への階層参照（`dut.count`）も、テスト側の信号もそのまま波形に出る。

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
        state enum {
            Red[red=1, yellow=0, green=0],
            Green[red=0, yellow=0, green=1],
            Yellow[red=0, yellow=1, green=0]
        }

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
        assert dut.count == 8'd0, "Count starts at 0";
    }

    // await は seq ブロックを中断する。その間も設計は動く。
    seq {
        await clk.cycles(50);
        assert dut.count == 8'd45, "Count should be 45 after 50 cycles";
    }
}
```

---

## iris-formal（形式検証用の基準モデル）

IRISソースから、構造的なSystemVerilogのモデルを出すツール。

`iris2sv`が出したSystemVerilogを**証明する相手**である。
`tools/formal/run.sh`がこれを使う。

```bash
iris-formal -i counter.iris -o out/
iris-formal -i regfile.iris -i alu.iris -i decoder.iris -i riscv_core.iris -o out/
```

### なぜ`iris2sv`と別に要るのか

等価性を証明するには両側の形式モデルが要る。
`iris2sv`のIRから基準モデルを作ると、下ろし方の不具合が両側に同じように現れ、
突き合わせは充足され、証明は実行時間の長い同語反復になる。

`iris2sv`はTypeScriptの手書き構文解析器でIRISを読み、
このツールは`src/parser/iris.pest`を通してRustで読む。
字句解析器も構文解析器もASTも型検査も下ろし方も共有しない。
共有するのはIRISの言語定義そのものだけであり、
**それについての食い違いは表に出るべきものである。**

### 出すものの形

意図的に鈍い。

- レジスタ1つに`always_ff`1つ、リセットの枝を明示する
- `always_comb`は素の`if`／`else`と`case`。三項演算子の連鎖にしない
- リテラルはすべて幅を持つ
- 宣言の初期値をそのまま再現する
- `alu.y`のようなインスタンス出力の読みは、線とポート接続になる
- 幅の意味論を写す。`bit[5]`どうしの加算は`5'(...)`で切り詰める
- ジェネリックな幅と深さは既定値で解決する。パラメータは出さない

`iris2sv`はこの逆に、入れ子の三項演算子とキャストと畳み込んだ論理を出す。
2つが同じ向きに壊れることは、片方の不具合では起こりにくい。

**表せない構文は誤りとして返す。**
黙って落とせば、誰も書いていない回路について証明することになる。

### 使い方

| オプション | 短縮形 | 説明 |
|-----------|--------|------|
| `--input` | `-i` | 入力IRISファイル（複数指定可） |
| `--output` | `-o` | 出力先。ディレクトリなら`reference.sv`、`.sv`ならそのファイル |
| `--verbose` | `-v` | 詳細出力 |

`test`モジュールは出さない。
比べるポートが無く、自分でクロックを駆動するため、等価性が何も言えない。

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
└── examples/               # サンプルファイル
    ├── counter.iris        # カウンタモジュール
    ├── counter_test.iris     # カウンタテストベンチ
    ├── fsm_test.iris       # FSMテスト
    ├── mem_test.iris       # メモリテスト
    ├── loop_test.iris      # ループテスト
    └── ...
```

---

## 対応機能

### 型

- `bit` / `bit[N]`
- `int[N]` / `uint[N]` と、その別名`iN` / `uN`（`u8`は`uint[8]`）
- `bool`
- `clock` / `reset`（`period`、`active_low`、`assert_cycles`、`assert_time`）
- 配列サフィックス（`bit[8][4]`は32ビット）

`int[N]`と`iN`は2の補数として扱う。
比較、除算、剰余、算術右シフト`>>>`が符号付きで評価される。
`bit[N]`は既定で符号なしであり、`.signed()`で読み替えられる。

### 文と式

- `comb` / `sync`ブロック、`seq` / `initial`ブロック
- `if` / `else`、`match`（文形式と式形式）、`for` / `while`
- ブロックローカルの`let`宣言
- ビットスライス`v[高:低]`（境界は定数式）とパート選択`v[添字 +: 幅]`
- 連結`{a, b}`
- システム関数`$clog2`、`$bits`（合成可能）
- 検証用のシステム関数`$display`、`$finish`、`$isunknown`、`$onehot`、`$size`
- `assert 条件, "メッセージ";` と `assert 条件 else error("...")`
  （`error` / `warning` / `fatal`の重大度を指定できる）

### モジュールと階層

- `inst`によるインスタンス化（入れ子の深さに制限はない）
- ジェネリックパラメータと`where`句による制約
  パラメータの組み合わせごとにモジュールが特殊化される
- メモリ宣言（`mem`）とインデックスによる読み書き。インスタンス内のメモリも扱える
- FSM（状態機械）。`initial:`による初期状態指定と、FSM本体でのローカル信号宣言に対応する

### シミュレーション機能

- 組み合わせ論理／順序論理
- 複数モジュールの階層シミュレーション
- 複数クロック。周期の異なるクロックをイベント駆動でそれぞれの周期で駆動する
- クロックドメインの分離。`sync`ブロックとFSMは、自分が指定したクロックのエッジでのみ動く
- リセットは`sync`ブロック単位。あるブロックが駆動する信号だけが初期値に戻る
- メタステーブル検出警告
- アサーション（失敗時はソース位置、両辺の値、メッセージ、時刻を表示し、終了コード1を返す）
- 評価できなかった式（未定義の名前など）は診断を出し、**終了コード1を返す**。
  値が計算されないまま0として読まれるため、成功として報告しない
- 階層越しの参照。`dut.count`も`core.rf.rdata1`のように2段以上のものも解決する
- 静的検査（下記）

### 静的検査

シミュレーション開始前に、仕様が定める規則を検査する。
エラーがあればシミュレーションを開始せず、警告では止めない。

| コード | 内容 | 仕様 |
|--------|------|------|
| O1005 | ジェネリックパラメータが`where`句の制約に違反している | 3.3.3 |
| O2006 | `match`が網羅的でない（幅4以上で`_`がない場合は警告） | 5.6.2 |
| O2007 | スライスの上限・下限が定数式でない | 9.6.2 |
| O7009 | 検証専用のシステム関数を合成可能な論理で使っている | 3.3.4 |

### クロック・リセット構文

テストベンチでクロックとリセットの動作を明示的に設定できます。

#### クロック宣言

```iris
let clk: clock;                    // デフォルト: 10ns周期
let clk: clock(period: 10ns);      // 明示的に10ns周期を指定
let clk: clock(period: 100ns);     // 100ns周期（10MHz）
```

#### リセット宣言

```iris
// サイクル数で指定
let rst: reset(active_low: false, assert_cycles: 5);  // 5サイクル間アサート

// 時間で指定
let rst: reset(active_low: false, assert_time: 50ns); // 50ns間アサート

// リセットなしモード
let rst: reset(active_low: false, assert_cycles: 0);  // リセットシーケンスをスキップ
```

| パラメータ | 説明 | デフォルト |
|-----------|------|-----------|
| `active_low` | true: Low-activeリセット, false: High-activeリセット | false |
| `assert_cycles` | リセットアサートサイクル数 | 5 |
| `assert_time` | リセットアサート時間（ns, us等） | - |

#### リセットなしsyncブロック

リセットを使用しないsyncブロックも記述できます：

```iris
// リセットなし（クロックのみ）
sync(clk.posedge) {
    counter = counter + 1;
}

// リセットあり
sync(clk.posedge, rst.sync) {
    counter = counter + 1;
}
```

---

## 制限事項

以下はいずれも、その構文を使う設計を実行して確認した内容である。

### 言語

- スライスの上限・下限は定数式でなければならない（O2007で検査する）。
  実行時に変わる位置を選ぶにはパート選択`v[添字 +: 幅]`を使う。
  両端が動くスライスは幅が定まらず合成できないため、これは設計上の判断である。
- `match`の網羅性は、対象の幅が静的に決まる場合に検査する。
  ポート、信号、式、インスタンスへの階層参照（`dut.count`）まで判定できる。
- タグ付きユニオンのペイロードは`match`の文形式でのみ取り出せる。
  式形式ではO2008で拒否する。
- 仕様第2.4節の予約語58語はすべて意味を持つ。
- 関数（`fn`）の本体は`let`と`return`1つで書く。呼び出しはエラボレーションで展開される。
- `$randomize`は決まった種から乱数を作る。同じ設計は何度実行しても同じ値を引き、
  インタプリタとコンパイル型でも一致する。
- `extern mod`は宣言できるがシミュレータは実行できない。
  インスタンス化するとO1007で警告し、出力は初期値のままになる。

### インターフェース

`interface`と`view`は、メンバごとの信号に展開してシミュレーションする。
インターフェース型のポートはビューの向きに従って入出力に分かれ、
同じバスを複数のインスタンスに渡せる。
`extends`による単一継承にも対応する。
波形にはメンバごとの名前（`link.valid`）で現れる。

### コンパイル型シミュレータ（iris-compile）

`iris-compile`は`iris-sim`が実行できる設計をすべて扱う。
値の意味（演算、幅、符号）と波形の記録は`iris-runtime`にあり、
インタプリタと生成コードの双方がそれを呼ぶ。
このため同じ設計は両者で同じ結果になる。

次の点だけが異なる。

- 波形は生成された実行ファイルに`-o`を渡したときだけ書き出す
- スライスの境界のような定数式は、コード生成の時点で畳み込む。
  畳み込めない場合はその時点でエラーになる（インタプリタは実行時に評価する）
- 宣言のない名前に代入した場合、最初に代入した値の幅を採用する。
  これはインタプリタと同じ挙動だが、波形には出力しない

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
iris-sim -i counter.iris -i counter_test.iris -o output.vcd -c 100
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
