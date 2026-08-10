# IRIS-RUNTIME

IRISの値の意味と波形の記録を担うライブラリ。インタプリタと生成コードの双方が使う。

## 目次

- [概要](#概要)
- [ビルド方法](#ビルド方法)
- [使い方](#使い方)
- [提供する型](#提供する型)
- [API リファレンス](#api-リファレンス)
- [トラブルシューティング](#トラブルシューティング)

---

## 概要

iris-runtimeは、IRISの値（`SignalValue`）、その上の演算（`ops`）、
波形の記録とVCD出力（`trace`）、そしてコンパイル型シミュレータの実行時状態（`engine`）を提供します。

このライブラリは`iris-compile`が生成したコードだけでなく、`iris-sim`のインタプリタも使います。
演算の意味と波形の書式が1か所にしかないため、同じ設計はどちらで実行しても同じ結果になります。

### アーキテクチャ

```
                    ┌─ iris-sim（インタプリタ）──────────────┐
IRISソース ─────────┤                                        ├─→ 波形・実行結果
                    └─ iris-compile → Rustコード → 実行ファイル ─┘
                                       ↓            ↓
                                 iris-runtime（両者が同じ実装を呼ぶ）
```

`Clock`、`Reset`、`BitVec`、`WaveTracer`は以前の生成コードが使っていた型で、
現在の生成コードは使いません。互換のために残しています。

---

## ビルド方法

### 必要環境

| ソフトウェア | バージョン | 確認コマンド |
|-------------|-----------|-------------|
| Rust | 1.70以降 | `rustc --version` |
| Cargo | 1.70以降 | `cargo --version` |

### ビルド

```bash
cd iris-runtime

# デバッグビルド
cargo build

# リリースビルド
cargo build --release

# テスト実行
cargo test
```

### ビルド確認

```bash
# ライブラリが正常にビルドされたか確認
ls -la target/debug/libiris_runtime.rlib
ls -la target/release/libiris_runtime.rlib
```

---

## 使い方

### iris-compileと連携して使用（推奨）

通常、iris-runtimeは直接使用するのではなく、iris-compileによって生成されるコードから参照されます。

```bash
# 1. iris-compileでシミュレータを生成
iris-compile -i counter.iris -o counter_sim --release -v

# 2. 生成されたシミュレータを実行
./counter_sim -c 10000 -o output.vcd

# 3. 波形を確認
gtkwave output.vcd
```

### 直接使用する場合

Cargo.tomlに依存関係を追加:

```toml
[dependencies]
iris-runtime = { path = "../iris-runtime" }
```

main.rsでの使用例:

```rust
use iris_runtime::{Clock, Reset, WaveTracer};

fn main() {
    // クロック作成（10ns周期）
    let mut clk = Clock::new_ns(10);

    // リセット作成
    let mut rst = Reset::new();

    // 波形トレーサー作成
    let mut tracer = WaveTracer::new();
    tracer.register("clk", 1);
    tracer.register("rst", 1);
    tracer.register("count", 8);

    // シミュレーションループ
    let mut count: u8 = 0;

    // リセットシーケンス
    rst.assert();
    for _ in 0..5 {
        clk.tick();
        tracer.record("clk", clk.time, clk.as_u64());
        tracer.record("rst", clk.time, rst.is_active() as u64);
        tracer.record("count", clk.time, count as u64);
    }
    rst.deassert();

    // メインシミュレーション
    for _ in 0..100 {
        if clk.posedge() && !rst.is_active() {
            count = count.wrapping_add(1);
        }

        tracer.record("clk", clk.time, clk.as_u64());
        tracer.record("rst", clk.time, rst.is_active() as u64);
        tracer.record("count", clk.time, count as u64);

        clk.tick();
    }

    // 波形出力
    tracer.write_vcd("output.vcd").expect("Failed to write VCD");
    println!("Final count: {}", count);
}
```

---

## 提供する型

### Clock

クロック信号を表現する構造体。

```rust
use iris_runtime::Clock;

// ピコ秒単位で周期を指定（10,000ps = 10ns）
let mut clk = Clock::new(10_000);

// ナノ秒単位で周期を指定（便利メソッド）
let mut clk = Clock::new_ns(10);

// デフォルト（10ns周期）
let mut clk = Clock::default();

// クロックを進める（半周期）
clk.tick();

// 1サイクル進める（tick を2回呼ぶ）
clk.cycle();

// エッジ検出
if clk.posedge() {
    println!("立ち上がりエッジ");
}
if clk.negedge() {
    println!("立ち下がりエッジ");
}

// 現在時刻の取得
let time_ps = clk.get_time();      // ピコ秒
let time_ns = clk.get_time_ns();   // ナノ秒（f64）

// クロック値の取得
let value = clk.as_u64();  // 0 or 1
```

### Reset

リセット信号を表現する構造体。

```rust
use iris_runtime::Reset;

// 新規作成（デフォルトは非アクティブ）
let mut rst = Reset::new();

// アクティブハイリセット
let mut rst = Reset::new();

// アクティブローリセット
let mut rst = Reset::new_active_low();

// リセットアサート
rst.assert();
assert!(rst.is_active());

// リセットデアサート
rst.deassert();
assert!(!rst.is_active());
```

### BitVec

固定幅ビットベクタを表現する構造体。

```rust
use iris_runtime::BitVec;

// 8ビットベクタの作成
let a: BitVec<8> = BitVec::new(10);
let b: BitVec<8> = BitVec::new(5);

// 算術演算（ラップアラウンド）
let c = a.wrapping_add(b);  // 15
let d = a.wrapping_sub(b);  // 5

// 値の取得
let value: u64 = c.get();

// 値の設定
let mut e: BitVec<8> = BitVec::new(0);
e.set(255);
```

### WaveTracer

シミュレーション波形を記録し、VCD形式で出力する構造体。

```rust
use iris_runtime::WaveTracer;

// 新規作成
let mut tracer = WaveTracer::new();

// タイムスケールの設定（オプション、デフォルトは1ns）
tracer.set_timescale(1000);  // 1ns = 1000ps

// 信号の登録
tracer.register("clk", 1);      // 1ビット信号
tracer.register("count", 8);    // 8ビット信号
tracer.register("data", 32);    // 32ビット信号

// 値の記録（変化時のみ記録）
tracer.record("clk", 0, 0);
tracer.record("clk", 5000, 1);  // 5nsでHigh
tracer.record("count", 5000, 1);

// 強制記録（値が同じでも記録）
tracer.record_force("clk", 10000, 0);

// 登録済み信号名の取得
for name in tracer.signal_names() {
    println!("Signal: {}", name);
}

// 波形ファイル出力
tracer.write_vcd("output.vcd").expect("VCD write failed");
```

---

## API リファレンス

### 定数

| 定数名 | 値 | 説明 |
|--------|-----|------|
| `DEFAULT_CLOCK_PERIOD` | 10,000 | デフォルトクロック周期（ピコ秒、10ns） |
| `DEFAULT_RESET_CYCLES` | 5 | デフォルトリセットサイクル数 |

### 型エイリアス

| 型名 | 定義 | 説明 |
|------|------|------|
| `SimTime` | `u64` | シミュレーション時間（ピコ秒単位） |

### Clock メソッド一覧

| メソッド | 説明 |
|---------|------|
| `new(period_ps: SimTime) -> Self` | 指定周期でクロック作成（ピコ秒） |
| `new_ns(period_ns: u64) -> Self` | 指定周期でクロック作成（ナノ秒） |
| `default() -> Self` | デフォルト周期（10ns）でクロック作成 |
| `tick(&mut self)` | 半周期進める |
| `cycle(&mut self)` | 1周期進める |
| `posedge(&self) -> bool` | 立ち上がりエッジか判定 |
| `negedge(&self) -> bool` | 立ち下がりエッジか判定 |
| `get_time(&self) -> SimTime` | 現在時刻（ピコ秒）を取得 |
| `get_time_ns(&self) -> f64` | 現在時刻（ナノ秒）を取得 |
| `as_u64(&self) -> u64` | クロック値（0/1）を取得 |

### Reset メソッド一覧

| メソッド | 説明 |
|---------|------|
| `new() -> Self` | アクティブハイリセット作成 |
| `new_active_low() -> Self` | アクティブローリセット作成 |
| `assert(&mut self)` | リセットアサート |
| `deassert(&mut self)` | リセットデアサート |
| `is_active(&self) -> bool` | リセットがアクティブか判定 |

### WaveTracer メソッド一覧

| メソッド | 説明 |
|---------|------|
| `new() -> Self` | トレーサー作成 |
| `set_timescale(&mut self, ps: u64)` | タイムスケール設定 |
| `register(&mut self, name: &str, width: usize)` | 信号登録 |
| `record(&mut self, name: &str, time: SimTime, value: u64)` | 値記録（変化時のみ） |
| `record_force(&mut self, name: &str, time: SimTime, value: u64)` | 値記録（強制） |
| `signal_names(&self) -> impl Iterator<Item = &str>` | 信号名一覧取得 |
| `write_vcd<P: AsRef<Path>>(&self, path: P) -> Result<()>` | VCD出力 |

---

## ディレクトリ構成

```
iris-runtime/
├── Cargo.toml          # プロジェクト設定
├── Cargo.lock          # 依存関係ロック
├── README.md           # このファイル
└── src/
    ├── lib.rs          # ライブラリルート（型エクスポート）
    ├── value.rs        # SignalValue、BitValue（値そのもの）
    ├── ops.rs          # 演算、スライス、パート選択、幅の収め方
    ├── trace.rs        # SignalTraceとVCD出力
    ├── engine.rs       # Runtime（コンパイル型の実行時状態）
    ├── clock.rs        # Clock構造体（互換のため）
    ├── reset.rs        # Reset構造体（互換のため）
    ├── bitvec.rs       # BitVec構造体（互換のため）
    └── tracer.rs       # WaveTracer構造体（互換のため）
```

---

## トラブルシューティング

### ビルドエラー

**エラー: リンクエラー**
```
error: linking with `cc` failed
```
→ Rustツールチェーンが正しくインストールされているか確認:
```bash
rustup update
```

### 実行時エラー

**エラー: VCD書き込みに失敗**
```
Failed to write VCD: No such file or directory
```
→ 出力先ディレクトリが存在するか確認:
```bash
mkdir -p output_dir
```

**エラー: 信号が記録されない**
```
# write_vcdが空のファイルを生成
```
→ `register()` で信号を登録してから `record()` を呼び出しているか確認。

---

## 関連プロジェクト

- **iris-sim** - IRISシミュレータ本体（インタプリタ型 + コンパイル型）
- **iris-compile** - コンパイル型シミュレータ生成ツール

---

## ライセンス

MIT License
