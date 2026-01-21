# 第13章 エラーメッセージ

[<< アトリビュート](./12_attributes.md) | [目次](./iris_spec_0.1.0.md) | [移行ガイド >>](./14_migration_guide.md)

---

## 13.1 エラーコード体系

エラーコードは`O`で始まり、カテゴリと番号で構成される。

| 範囲 | カテゴリ | 説明 |
|------|----------|------|
| O0001-O0999 | 構文エラー | パース時のエラー |
| O1001-O1999 | 型エラー | 型チェック時のエラー |
| O2001-O2999 | 論理エラー | 組み合わせ/順序論理のエラー |
| O3001-O3999 | FSMエラー | ステートマシンのエラー |
| O4001-O4999 | インターフェースエラー | インターフェース接続エラー |
| O5001-O5999 | 合成エラー | 合成不可能な構文 |
| O6001-O6999 | リンクエラー | モジュール解決エラー |
| O7001-O7999 | テスト・シミュレーションエラー | seq/外部Rust関連エラー |

---

## 13.2 構文エラー（O0001-O0999）

### O0001: 組み合わせブロックでの不完全な信号割り当て

```
error[O0001]: incomplete signal assignment in combinational block
  --> src/alu.iris:42:5
   |
42 | comb {
43 |     if sel == 2'b00 {
44 |         out = in0;
45 |     }
   |     ^ 'out' is not assigned when sel != 2'b00
   |
   = help: add 'else' clause or use 'comb default(out = 0)'
   = note: incomplete assignments infer latches
```

**原因:** combブロック内で全てのパスで信号に値が割り当てられていない

**修正方法:**
1. else句を追加して全パスをカバー
2. `comb default(signal = value)`でデフォルト値を指定
3. match式を使用して全ケースを網羅

### O0002: var宣言のsync/fsm外での使用

```
error[O0002]: 'var' declaration used outside sync/fsm block
  --> src/counter.iris:8:5
   |
8  |     var counter: bit[8] = 0;
9  |     comb {
10 |         counter = counter + 1;
   |         ^^^^^^^ 'var' signal assigned in comb block
   |
   = help: use 'let' for combinational logic, or move to sync/fsm block
   = note: 'var' declarations are only allowed in sync or fsm blocks
```

**原因:** `var`で宣言した信号を`sync`/`fsm`ブロック外で使用している

**修正方法:**
1. 組み合わせ論理の場合は`let`を使用
2. 順序論理の場合は`sync`または`fsm`ブロック内で使用

### O0003: 予約語の識別子使用

```
error[O0003]: reserved keyword used as identifier
  --> src/module.iris:5:9
   |
5  |     let match: bit[8];
   |         ^^^^^ 'match' is a reserved keyword
   |
   = help: rename the signal, e.g., 'match_result' or 'match_val'
   = note: see language reference for list of reserved keywords
```

**原因:** 予約語を識別子として使用している

**修正方法:**
1. 別の名前に変更
2. サフィックスやプレフィックスを追加

### O0004: 括弧の不一致

```
error[O0004]: mismatched brackets
  --> src/expr.iris:12:20
   |
12 |     result = data[7:0;
   |                      ^ expected ']', found ';'
   |
   = help: add closing bracket ']'
```

**原因:** 開き括弧に対応する閉じ括弧がない

**修正方法:**
1. 対応する閉じ括弧を追加

### O0005: セミコロンの欠落

```
error[O0005]: expected ';'
  --> src/assign.iris:15:18
   |
15 |     count = count + 1
16 |     overflow = (count == 8'hFF);
   |     ^^^^^^^^ expected ';' before this
   |
   = help: add ';' at the end of line 15
```

**原因:** 文の終わりにセミコロンがない

**修正方法:**
1. 文の終わりにセミコロンを追加

---

## 13.3 型エラー（O1001-O1999）

### O1001: 型の不一致

```
error[O1001]: type mismatch
  --> src/counter.iris:15:12
   |
15 |     count = count + 1;
   |             ^^^^^^^^^ expected `bit[8]`, found `bit[9]`
   |
   = help: use explicit truncation: `(count + 1).truncate[8]()`
   = note: IRIS does not allow implicit narrowing conversions
```

**原因:** 右辺の式の型が左辺の型より広い

**修正方法:**
1. `.truncate[N]()`で明示的に切り捨て
2. `.resize[N]()`で符号拡張/ゼロ拡張付きリサイズ
3. 左辺の型を拡張

### O1002: 符号付き/符号なしの混在

```
error[O1002]: signed/unsigned mismatch in comparison
  --> src/calc.iris:23:8
   |
23 |     if signed_val > unsigned_val {
   |        ^^^^^^^^^^^^^^^^^^^^^^^^^ comparing `i8` with `u8`
   |
   = help: cast one operand: `signed_val > unsigned_val as i8`
   = note: implicit signed/unsigned comparison can produce unexpected results
```

**原因:** 符号付きと符号なしの値を直接比較している

**修正方法:**
1. 明示的なキャストを追加
2. `.signed()` または `.unsigned()` メソッドを使用

### O1003: ビット幅の不一致

```
error[O1003]: bit width mismatch
  --> src/concat.iris:10:12
   |
10 |     result = {a, b};
   |              ^^^^^^ concatenation produces `bit[24]`, expected `bit[16]`
   |
   = help: result type should be bit[24] or truncate the concatenation
   = note: {a: bit[16], b: bit[8]} produces bit[24]
```

**原因:** 連結演算の結果のビット幅が期待と異なる

**修正方法:**
1. 左辺の型を正しいビット幅に変更
2. 連結する信号を調整

### O1004: 配列インデックスの型エラー

```
error[O1004]: invalid array index type
  --> src/mem.iris:18:14
   |
18 |     data = mem[addr];
   |                ^^^^ expected unsigned integer type, found `int[8]`
   |
   = help: cast to unsigned: `mem[addr as uint[8]]`
   = note: array indices must be unsigned
```

**原因:** 配列インデックスに符号付き型を使用している

**修正方法:**
1. インデックスを符号なし型にキャスト
2. 信号の宣言時に符号なし型を使用

### O1005: ジェネリックパラメータの制約違反

```
error[O1005]: generic parameter constraint violation
  --> src/counter.iris:3:25
   |
3  |     inst cnt = Counter[Width: 64] { ... };
   |                        ^^^^^^^^^ Width=64 violates constraint: Width <= 32
   |
   = note: Counter requires: Width >= 1, Width <= 32
```

**原因:** ジェネリックパラメータの値が制約を満たしていない

**修正方法:**
1. 制約を満たす値を指定
2. モジュールの制約定義を確認

---

## 13.4 論理エラー（O2001-O2999）

### O2001: 組み合わせ回路ループ

```
error[O2001]: combinational loop detected
  --> src/logic.iris:10:5
   |
10 |     a = b & c;
11 |     b = a | d;
   |     ^^^^^^^^^ 'b' depends on 'a' which depends on 'b'
   |
   = help: break the loop by inserting a register
   = note: combinational loops cause simulation non-convergence
```

**原因:** 組み合わせ論理内で循環依存が発生している

**修正方法:**
1. レジスタを挿入してループを断つ
2. ロジックを再設計して依存関係を解消

### O2002: syncブロック・combブロック外での信号代入

```
error[O2002]: signal assigned outside logic block
  --> src/reg.iris:18:5
   |
18 | count = count + 1;
   | ^^^^^ 'count' is assigned outside sync/comb block
   |
   = help: move assignment into sync block (for registers) or comb block (for combinational logic)
   = note: all signal assignments must be within sync or comb blocks
```

**原因:** 信号への代入がsyncまたはcombブロック外で行われている

**修正方法:**
1. 代入をsyncブロック内に移動（レジスタの場合）
2. 代入をcombブロック内に移動（組み合わせ論理の場合）

### O2003: 同一信号への複数ドライバ

```
error[O2003]: multiple drivers for signal
  --> src/mux.iris:15:9
   |
12 |     comb {
13 |         if sel { result = a; }
14 |     }
15 |     comb {
16 |         if !sel { result = b; }
   |                   ^^^^^^ 'result' is also driven at line 13
   |
   = help: combine into a single comb block with complete if-else
   = note: each signal must have exactly one driver
```

**原因:** 同一信号が複数のブロックから駆動されている

**修正方法:**
1. 単一のcombブロックに統合
2. if-else式を使用して完全な条件分岐を記述

### O2004: 未初期化レジスタの読み取り

```
error[O2004]: potentially uninitialized register read
  --> src/pipe.iris:22:16
   |
22 |         stage2 = stage1;
   |                  ^^^^^^ 'stage1' may be read before initialization
   |
   = help: add initial value: `var stage1: bit[8] = 0;`
   = note: registers without reset values have undefined initial state
```

**原因:** リセット値のないレジスタを読み取っている可能性

**修正方法:**
1. var宣言時に初期値を指定
2. リセット処理で値を設定

### O2005: クロックドメイン交差

```
warning[O2005]: clock domain crossing detected
  --> src/cdc.iris:18:14
   |
18 |     sync(clk_b.posedge) {
19 |         data_b = data_a;
   |                  ^^^^^^ 'data_a' is in clock domain 'clk_a'
   |
   = help: use synchronizer: `sync_ff(data_a, stages: 2)`
   = note: direct CDC may cause metastability
```

**原因:** 異なるクロックドメイン間で直接信号を渡している

**修正方法:**
1. `sync_ff`などの同期化プリミティブを使用
2. 適切なCDC手法を適用

---

## 13.5 FSMエラー（O3001-O3999）

### O3001: FSM到達不能状態

```
warning[O3001]: unreachable state in FSM
  --> src/ctrl.iris:25:9
   |
25 |         Unused,
   |         ^^^^^^ state 'Unused' is never reached from initial state
   |
   = help: remove unused state or add transition to it
   = note: unreachable states waste hardware resources
```

**原因:** 初期状態から到達できない状態が定義されている

**修正方法:**
1. 未使用の状態を削除
2. 他の状態からの遷移を追加

### O3002: FSM遷移の非網羅性

```
error[O3002]: non-exhaustive transitions
  --> src/fsm.iris:30:5
   |
30 | transitions {
31 |     Idle => { when start { goto Run; } }
32 | }
   | ^ no transition defined for state 'Run'
   |
   = help: add transition for 'Run' or use '_ => { ... }' for default
```

**原因:** 全ての状態に対して遷移が定義されていない

**修正方法:**
1. 不足している状態の遷移を追加
2. `_ => { ... }` でデフォルト遷移を定義

---

## 13.6 インターフェースエラー（O4001-O4999）

### O4001: インターフェース方向不一致

```
error[O4001]: interface view direction mismatch
  --> src/top.iris:45:5
   |
45 |     inst slave1 = AxiSlave { axi: bus.initiator };
   |                                   ^^^^^^^^^^^^^ expected 'target' view, found 'initiator'
   |
   = help: use `bus.target` for slave modules
   = note: initiator connects to target, not initiator to initiator
```

**原因:** インターフェースのビュー方向が一致していない

**修正方法:**
1. 正しいビュー（initiator/target）を使用
2. モジュールのポート定義を確認

---

## 13.7 合成エラー（O5001-O5999）

### O5001: 合成不可能な構文

```
error[O5001]: non-synthesizable construct
  --> src/div.iris:12:12
   |
12 |     result = a / b;
   |              ^^^^^ division is not directly synthesizable
   |
   = help: use `#[synthesis(use_dsp)]` or implement iterative divider
   = note: consider using shift operations for power-of-2 divisors
```

**原因:** ハードウェアに直接合成できない構文を使用している

**修正方法:**
1. `#[synthesis(use_dsp)]`アトリビュートを使用
2. 反復型の除算器を実装
3. 2の累乗の場合はシフト演算を使用

---

## 13.8 リンクエラー（O6001-O6999）

### O6001: モジュール未定義

```
error[O6001]: module not found
  --> src/top.iris:8:16
   |
8  |     inst cpu = RiscvCore { ... };
   |                ^^^^^^^^^ module 'RiscvCore' not found
   |
   = help: check spelling or add: `import riscv::RiscvCore;`
   = note: available modules: RiscV32Core, RiscV64Core
```

**原因:** 指定されたモジュールが見つからない

**修正方法:**
1. スペルを確認
2. 必要なimport文を追加
3. モジュールが存在するパッケージを確認

---

## 13.9 テスト・シミュレーションエラー（O7001-O7999）

### O7001: seqブロックのtestモジュール外での使用

```
error[O7001]: seq block used outside test module
  --> src/counter.iris:15:5
   |
15 |     seq main {
   |     ^^^ seq blocks are only allowed in test modules
   |
   = help: move seq block inside a 'test' module or use 'initial' for synthesis
   = note: seq blocks are simulation-only constructs
```

**原因:** `seq`ブロックを`test`モジュール以外で使用している

**修正方法:**
1. `seq`ブロックを`test`モジュール内に移動
2. 合成可能なコードの場合は`initial`または`sync`ブロックを使用

### O7002: 外部Rust関数が見つからない

```
error[O7002]: external Rust function not found
  --> test/counter_test.iris:3:5
   |
3  | use rust::test_utils::verify_count;
   |     ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ function 'verify_count' not found in module 'test_utils'
   |
   = help: check function name spelling and ensure it is 'pub'
   = note: looking in: rust/test_utils.rs
```

**原因:** インポートしようとしたRust関数が見つからない

**修正方法:**
1. 関数名のスペルを確認
2. Rust側で関数が`pub`で宣言されていることを確認
3. `rust/`ディレクトリのパスを確認

### O7003: Rustモジュールが見つからない

```
error[O7003]: Rust module not found
  --> test/axi_test.iris:2:5
   |
2  | use rust::generators::AxiGenerator;
   |     ^^^^^^^^^^^^^^^ module 'generators' not found
   |
   = help: ensure 'rust/generators.rs' exists and is declared in 'rust/mod.rs'
   = note: expected file: rust/generators.rs
```

**原因:** 指定されたRustモジュールが見つからない

**修正方法:**
1. `rust/`ディレクトリに該当ファイルが存在することを確認
2. `rust/mod.rs`で`pub mod モジュール名;`が宣言されていることを確認

### O7004: Rust関数の型シグネチャ不一致

```
error[O7004]: Rust function signature mismatch
  --> test/verify_test.iris:8:20
   |
8  |         verify_count(actual, expected);
   |                      ^^^^^^ expected `u64`, found `bit[8]`
   |
   = help: add explicit cast: `actual as u64`
   = note: Rust function signature: fn verify_count(actual: u64, expected: u64)
```

**原因:** Rust関数の引数型とIRISから渡す値の型が一致しない

**修正方法:**
1. 明示的なキャストを追加
2. Rust関数のシグネチャを確認
3. IRIS-Rust型マッピングを参照

### O7005: seqブロック内での合成可能な信号操作

```
error[O7005]: synthesizable signal operation in seq block
  --> test/counter_test.iris:12:9
   |
12 |         counter = counter + 1;
   |         ^^^^^^^^ direct signal assignment in seq block
   |
   = help: use signal API: counter.set(counter.value() + 1)
   = note: seq blocks use .value() and .set() for signal access
```

**原因:** `seq`ブロック内で通常の代入構文を使用している

**修正方法:**
1. `.value()`で信号値を読み取り
2. `.set()`で信号値を設定
3. 信号アクセスAPIを使用

### O7006: Rustコンパイルエラー

```
error[O7006]: Rust compilation failed
  --> rust/test_utils.rs:15:5
   |
   | Error from rustc:
   | error[E0599]: no method named `unwrap_or` found for type `u8`
   |
   = help: check Rust code in rust/test_utils.rs:15
   = note: run 'cargo check --manifest-path build/rust/Cargo.toml' for details
```

**原因:** 外部Rustコードのコンパイルに失敗した

**修正方法:**
1. 該当のRustファイルを確認
2. `cargo check`でRustコードをデバッグ
3. Rustの標準エラーメッセージに従って修正

### O7007: 非同期関数のawait欠落

```
error[O7007]: missing await for async function
  --> test/async_test.iris:10:20
   |
10 |         let data = load_test_vectors("test.bin");
   |                    ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ async function called without await
   |
   = help: add .await: load_test_vectors("test.bin").await
   = note: async functions must be awaited to execute
```

**原因:** 非同期関数を`await`なしで呼び出している

**修正方法:**
1. `.await`を追加
2. Rust側で`async fn`として宣言されているか確認

### O7008: iris.toml Rust設定エラー

```
error[O7008]: invalid Rust configuration in iris.toml
  --> iris.toml:15:1
   |
15 | [rust]
16 | src = "nonexistent/"
   |       ^^^^^^^^^^^^^ directory not found
   |
   = help: create directory 'nonexistent/' or update path in iris.toml
   = note: default Rust source directory is 'rust/'
```

**原因:** `iris.toml`のRust設定が不正

**修正方法:**
1. 指定されたディレクトリが存在することを確認
2. `iris.toml`の`[rust]`セクションを確認

---

## 13.10 警告一覧

| コード | 説明 | デフォルト |
|--------|------|-----------|
| W0001 | 未使用信号 | 有効 |
| W0002 | 未使用パラメータ | 有効 |
| W0003 | 暗黙の型拡張 | 有効 |
| W0004 | 深いネスト（>5レベル） | 無効 |
| W0005 | 大規模なバレルシフタ生成 | 有効 |
| W0006 | クロックドメイン交差の可能性 | 有効 |
| W0007 | 高ファンアウト信号 | 有効 |
| W0008 | 未使用のseqブロック | 有効 |
| W0009 | 外部Rust関数の未使用インポート | 有効 |
| W0010 | seqブロック内の非効率なループ | 無効 |

---

## 13.11 警告の制御

```rust
// ファイルレベルで警告を抑制
#![allow(W0001)]

// 特定の項目で抑制
#[allow(W0001)]
let _unused_debug: bit[32];

// 警告をエラーに昇格
#![deny(W0006)]

// 全警告をエラーに
#![deny(warnings)]
```

---

## 13.11 エラーメッセージの読み方

IRISのエラーメッセージは以下の構造で表示される：

```
error[CODE]: エラーの概要
  --> ファイルパス:行番号:列番号
   |
行 | ソースコード
   |     ^^^^^^^^^ 問題の詳細
   |
   = help: 修正方法の提案
   = note: 追加情報
```

| 要素 | 説明 |
|------|------|
| `error` / `warning` | メッセージの種類 |
| `[CODE]` | エラーコード（ドキュメント検索用） |
| 概要 | エラーの簡潔な説明 |
| ファイルパス | 問題のあるファイル |
| 行番号:列番号 | 問題の位置 |
| `^^^^^` | 問題の箇所を示すマーカー |
| `help` | 修正方法の提案 |
| `note` | 追加の説明や背景情報 |

---

[<< アトリビュート](./12_attributes.md) | [目次](./iris_spec_0.1.0.md) | [移行ガイド >>](./14_migration_guide.md)
