# IRIS

**(アイリス: Immutable RTL Implementation Standard)**

IRISは、組み合わせ回路と順序回路を記述することを前提としたハードウェア記述言語です。人間とAIが読み書きできる、高級っぽく見える低レベルな言語を目指しています。

SystemVerilogの複雑さを解消し、Rustの設計思想を取り入れた次世代ハードウェア記述言語として、約220の予約語を持つSystemVerilogに対し、IRISは54語のキーワードでRTL設計に必要な表現力を提供します。

## 設計思想

| 原則 | 説明 |
|------|------|
| **Safety First** | 暗黙の型変換を廃止、ビット幅不一致はコンパイルエラー |
| **明示性 > 暗黙性** | 意図を明確にコードで表現 |
| **簡潔性** | `{}`記法、統一されたデータ型、統一された代入演算子 |
| **構成可能性** | モジュール間の疎結合設計 |
| **合成と検証の分離** | 合成可能コードと検証専用コードの明確な区別 |

## 主な特徴

- **統一代入演算子**: ブロッキング(`=`)とノンブロッキング(`<=`)の混乱を排除し、`=` に統一（`sync`ブロック内では自動的に順序回路セマンティクスで処理）
- **イミュータブル信号**: `let`による不変信号宣言を基本とし、可変信号は`var`で明示的に宣言
- **Rust風構文**: `match`式、ジェネリクス、パターンマッチングなどモダンな言語機能を採用
- **型安全性**: 暗黙の型変換を禁止、コンパイル時ビット幅チェック、明示的な型変換
- **マルチドライブ防止**: 同一信号への複数箇所からの駆動をコンパイル時に検出
- **コンテキストベース合成**: `comb`ブロックで組み合わせ回路、`sync`ブロックで順序回路を明確に分離
- **FSM専用構文**: `fsm`ブロックによる状態機械の直感的な記述
- **言語組み込み検証**: UVM不要の検証機能（テスト構文、アサーション、カバレッジ）

## SystemVerilogとの比較

| 機能 | SystemVerilog | IRIS |
|------|---------------|------|
| 括弧 | `begin ... end` | `{ ... }` |
| 型宣言（組み合わせ） | `wire [7:0] data` | `let data: bit[8];` |
| 型宣言（順序） | `reg [7:0] data` | `var data: bit[8];` |
| 分岐 | `case ... endcase` | `match { ... }` |
| 組み合わせ論理 | `assign` / `always_comb` | `let` 宣言 / `comb { }` |
| 順序論理 | `always_ff @(posedge clk)` | `sync(clk.posedge) { }` |
| モジュール | `module ... endmodule` | `mod ... { }` |
| 代入演算子 | `=`（ブロッキング）/ `<=`（ノンブロッキング） | `=`（統一） |
| 予約語数 | ~220 | 54 |

## コード例

### カウンタモジュール

```rust
/// 8ビットカウンタ
mod Counter(
    in  clk: clock,
    in  rst: reset,
    in  enable: bit,
    out count: bit[8],
) {
    // 可変信号（レジスタ）
    var counter: bit[8] = 0;

    // 順序論理
    sync(clk.posedge, rst.async) {
        if enable {
            counter = counter + 1;
        }
    }

    // 組み合わせ論理（出力接続）
    comb {
        count = counter;
    }
}
```

### FSM（信号機）

```rust
fsm TrafficLight(clk.posedge, rst.async) {
    state enum { Red, Yellow, Green }
    initial: Red

    let timer: u8 = 0;

    transitions {
        Red => {
            red_light = 1; yellow_light = 0; green_light = 0;
            timer = timer + 1;
            when timer >= 100 { timer = 0; goto Green; }
        }
        Green => {
            red_light = 0; yellow_light = 0; green_light = 1;
            timer = timer + 1;
            when timer >= 80 { timer = 0; goto Yellow; }
        }
        Yellow => {
            red_light = 0; yellow_light = 1; green_light = 0;
            timer = timer + 1;
            when timer >= 20 { timer = 0; goto Red; }
        }
    }

    output encoding: onehot
}
```

## プロジェクト構成

```
iris/
├── spec/                  # 言語仕様書（21章構成）
├── sim/
│   ├── iris-sim/          # シミュレータ（インタプリタ + コンパイラ）
│   └── iris-runtime/      # コンパイル済みシミュレーション用ランタイム
├── tools/
│   ├── irisfmt/           # フォーマッタ / リンタ
│   ├── iris2sv/           # IRIS → SystemVerilog トランスパイラ
│   └── sv2iris/           # SystemVerilog → IRIS トランスパイラ
└── LICENSE                # MIT License
```

## ツール

### シミュレーション（Rust製）

**iris-sim** — IRISシミュレータ

インタプリタモードとコンパイラモードの2つの実行方式を提供します。

```bash
# インタプリタモード（直接実行）
cargo run --bin iris-sim -- input.iris

# コンパイラモード（Rust実行ファイルを生成、約3,800倍高速）
cargo run --bin iris-compile -- input.iris -o output
```

**iris-runtime** — ランタイムライブラリ

コンパイラモードで生成された実行ファイルが使用するサポートライブラリです。Clock, Reset, BitVec, WaveTracer等の型を提供します。

### ユーティリティ（TypeScript製）

**irisfmt** — フォーマッタ / リンタ

IRISソースコードの自動整形とコーディング規約チェックを行います。

**iris2sv** — IRIS → SystemVerilog トランスパイラ

IRISソースをSystemVerilogに変換し、既存のEDAツール（Vivado, Quartus, Synopsys等）で使用可能にします。

**sv2iris** — SystemVerilog → IRIS トランスパイラ

既存のSystemVerilogコードをIRISに変換し、レガシーコードベースからの移行を支援します。

## クイックスタート

### 前提条件

- **Rust** (rustc / cargo) — シミュレータのビルドに必要
- **Node.js** (>= 18.0.0) + **pnpm** — TypeScript製ツールのビルドに必要

### シミュレータのビルドと実行

```bash
# iris-simのビルド
cd sim/iris-sim
cargo build --release

# シミュレーションの実行
cargo run --bin iris-sim -- path/to/your_design.iris
```

### TypeScript製ツールのビルド

```bash
# iris2svの例
cd tools/iris2sv
pnpm install
pnpm build
```

## 言語仕様

完全な言語仕様書は [spec/iris_spec.md](./spec/iris_spec.md) にあります。21章構成で、以下のトピックを網羅しています。

| 章 | タイトル | 内容 |
|----|----------|------|
| 1 | 概要 | 設計思想、SystemVerilogとの比較 |
| 2 | 字句構造 | 予約語、リテラル、演算子 |
| 3 | 型システム | プリミティブ型、複合型、ジェネリクス |
| 4 | モジュール定義 | ポート、信号、インスタンス化 |
| 5 | 組み合わせ論理 | `let`宣言、`comb`ブロック |
| 6 | 順序論理 | `sync`ブロック、クロック/リセット |
| 7 | FSM | 状態機械の記述 |
| 8 | インターフェース | ビュー、接続規則 |
| 9 | 演算子 | 算術、ビット、比較、論理 |
| 10 | メモリ | RAM/ROM宣言 |
| 11 | 検証機能 | テスト、アサーション、カバレッジ |
| 12 | パッケージシステム | インポート、公開制御 |
| 13 | アトリビュート | 合成指示、階層制御 |
| 14 | エラーメッセージ | エラーコード体系 |
| 15 | 移行ガイド | SystemVerilog → IRIS変換 |
| 16 | 文法定義 | EBNF形式の完全文法 |
| 17 | サンプルコード集 | カウンタ、FIFO、AXI、SPI等 |
| 18 | 用語集 | 技術用語の定義 |
| 19 | FAQ | よくある質問と回答 |
| 20 | チュートリアル | 初心者向けガイド |
| 21 | IDE連携ガイド | VS Code、Neovim等の設定 |

## ファイル拡張子

| 拡張子 | 説明 |
|--------|------|
| `.iris` | **推奨**。プロジェクトでの使用を推奨する正式拡張子 |
| `.irs` | 便宜のための短縮形。正式拡張子と同等に扱う |

すべてのIRISツール（iris-sim, irisfmt, iris2sv等）は両方の拡張子を同等に認識します。

## 現在のステータス

- **バージョン**: 0.1.0（開発中）
- **仕様書日付**: 2026-01-05
- **対応SystemVerilog**: IEEE 1800-2017準拠を目標

## ライセンス

[MIT License](./LICENSE)
