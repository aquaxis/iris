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

## 13.9 警告一覧

| コード | 説明 | デフォルト |
|--------|------|-----------|
| W0001 | 未使用信号 | 有効 |
| W0002 | 未使用パラメータ | 有効 |
| W0003 | 暗黙の型拡張 | 有効 |
| W0004 | 深いネスト（>5レベル） | 無効 |
| W0005 | 大規模なバレルシフタ生成 | 有効 |
| W0006 | クロックドメイン交差の可能性 | 有効 |
| W0007 | 高ファンアウト信号 | 有効 |

---

## 13.10 警告の制御

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
