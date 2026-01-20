# IRIS-SIM

IRIS言語で記述されたRTL設計をシミュレーションし、波形ファイルを出力するツール。

## 必要環境

- Rust 1.70以降
- Cargo
- GTKWave（波形閲覧用、オプション）

## ビルド

```bash
cd iris-sim
cargo build --release
```

ビルド成果物は `target/release/iris-sim` に生成されます。

## インストール

### ローカルインストール

```bash
cargo install --path .
```

`~/.cargo/bin/iris-sim` にインストールされます。

### システムワイドインストール

```bash
cargo build --release
sudo cp target/release/iris-sim /usr/local/bin/
```

## 実行方法

### 基本的な使い方

```bash
# 単一ファイルのシミュレーション
iris-sim -i input.iris -o output.vcd -c 100

# 複数ファイルのシミュレーション
iris-sim -i module.iris -i testbench.iris -o output.fst -c 100
```

### コマンドラインオプション

| オプション | 短縮形 | 説明 |
|-----------|--------|------|
| `--input <FILE>` | `-i` | 入力IRISファイル（複数指定可） |
| `--output <FILE>` | `-o` | 出力波形ファイル |
| `--format <FORMAT>` | `-f` | 出力形式（vcd/fst、省略時は拡張子から判定） |
| `--cycles <N>` | `-c` | シミュレーションサイクル数（デフォルト: 100） |
| `--top <MODULE>` | `-t` | トップモジュール名（省略時は自動検出） |
| `--verbose` | `-v` | 詳細出力 |
| `--help` | `-h` | ヘルプ表示 |
| `--version` | `-V` | バージョン表示 |

### 出力形式

| 形式 | 拡張子 | 説明 |
|------|--------|------|
| VCD | `.vcd` | IEEE 1364標準テキスト形式 |
| FST | `.fst` | GTKWaveバイナリ形式（高圧縮） |

### 実行例

```bash
# VCD形式で出力（詳細表示）
iris-sim -i counter.iris -o counter.vcd -c 100 -v

# FST形式で出力
iris-sim -i counter.iris -i counter_tb.iris -o counter_tb.fst -c 200

# トップモジュールを指定
iris-sim -i design.iris -i tb.iris -o sim.fst -c 500 --top TestBench
```

### 波形の閲覧

```bash
# GTKWaveで波形を開く
gtkwave output.vcd
gtkwave output.fst
```

## ライセンス

MIT License
