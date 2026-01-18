# リントルールリファレンス

irisfmt-lintが提供するリントルールの詳細なリファレンスです。

## ルール一覧

| ルール | カテゴリ | デフォルト | 説明 |
|--------|---------|-----------|------|
| [naming-convention](#naming-convention) | style | warning | 命名規則のチェック |
| [unused-variable](#unused-variable) | correctness | warning | 未使用変数の検出 |
| [unused-signal](#unused-signal) | correctness | warning | 未使用シグナルの検出 |
| [unused-import](#unused-import) | correctness | warning | 未使用インポートの検出 |
| [no-empty-block](#no-empty-block) | suspicious | warning | 空ブロックの検出 |
| [var-context-restriction](#var-context-restriction) | correctness | error | var文の使用制限 |
| [import-order](#import-order) | style | warning | インポート順序のチェック |
| [duplicate-import](#duplicate-import) | correctness | warning | 重複インポートの検出 |

---

## naming-convention

### 説明

一貫した命名規則を強制します。

- モジュール名: PascalCase
- 関数名: snake_case
- 変数/シグナル名: snake_case
- 定数名: SCREAMING_SNAKE_CASE
- 型名: PascalCase

### カテゴリ

`style`

### デフォルト重大度

`warning`

### 非推奨な例

```iris
mod counter(in clk: clock) {  // モジュール名はPascalCaseであるべき
  let mySignal: bit<8> = 0;   // シグナル名はsnake_caseであるべき
}
```

### 推奨される例

```iris
mod Counter(in clk: clock) {
  let my_signal: bit<8> = 0;
}
```

### 設定

```json
{
  "lint": {
    "rules": {
      "naming-convention": "warning"
    }
  }
}
```

---

## unused-variable

### 説明

宣言されたが使用されていない変数を検出します。未使用の変数はコードの可読性を下げ、バグの原因となる可能性があります。

### カテゴリ

`correctness`

### デフォルト重大度

`warning`

### 非推奨な例

```iris
fn calculate() -> bit<8> {
  let unused: bit<8> = 0;  // 未使用
  let result: bit<8> = 42;
  return result;
}
```

### 推奨される例

```iris
fn calculate() -> bit<8> {
  let result: bit<8> = 42;
  return result;
}
```

### 例外

アンダースコアで始まる変数名（`_unused`）は意図的に未使用であることを示し、警告の対象外となります。

```iris
fn calculate(_param: bit<8>) -> bit<8> {
  // _param は意図的に未使用
  return 42;
}
```

---

## unused-signal

### 説明

モジュール内で宣言されたが使用されていないシグナル（let/var宣言）を検出します。

### カテゴリ

`correctness`

### デフォルト重大度

`warning`

### 非推奨な例

```iris
mod Counter(in clk: clock, out count: bit<8>) {
  let unused_signal: bit<8> = 0;  // 未使用
  var counter: bit<8> = 0;

  sync(clk.posedge) {
    counter = counter + 1;
  }

  comb {
    count = counter;
  }
}
```

### 推奨される例

```iris
mod Counter(in clk: clock, out count: bit<8>) {
  var counter: bit<8> = 0;

  sync(clk.posedge) {
    counter = counter + 1;
  }

  comb {
    count = counter;
  }
}
```

### 例外

- **ポートシグナル**: 入出力ポートは常に使用されているとみなされます
- **アンダースコアプレフィックス**: `_`で始まるシグナル名は警告の対象外です

---

## unused-import

### 説明

インポートされたが使用されていないモジュールや型を検出します。

### カテゴリ

`correctness`

### デフォルト重大度

`warning`

### 非推奨な例

```iris
import std::io;      // 未使用
import std::mem;

mod Counter(in clk: clock) {
  // mem のみ使用
}
```

### 推奨される例

```iris
import std::mem;

mod Counter(in clk: clock) {
  // ...
}
```

---

## no-empty-block

### 説明

空のブロック（comb、sync、関数本体など）を検出します。空のブロックは多くの場合、実装忘れや不要なコードを示します。

### カテゴリ

`suspicious`

### デフォルト重大度

`warning`

### 非推奨な例

```iris
mod Counter(in clk: clock) {
  comb {
    // 空のcombブロック
  }

  sync(clk.posedge) {
    // 空のsyncブロック
  }
}
```

### 推奨される例

```iris
mod Counter(in clk: clock, out count: bit<8>) {
  var counter: bit<8> = 0;

  sync(clk.posedge) {
    counter = counter + 1;
  }

  comb {
    count = counter;
  }
}
```

---

## var-context-restriction

### 説明

`var`宣言が適切なコンテキスト（sync/fsmブロック内）でのみ使用されることを強制します。`var`は状態を持つシグナルを宣言するため、クロック同期ブロック外での使用は設計上の問題を示します。

### カテゴリ

`correctness`

### デフォルト重大度

`error`

### 非推奨な例

```iris
mod Counter(in clk: clock) {
  var counter: bit<8> = 0;  // モジュールレベルでのvar

  comb {
    var temp: bit<8> = 0;  // combブロック内でのvar
  }
}
```

### 推奨される例

```iris
mod Counter(in clk: clock, out count: bit<8>) {
  let counter: bit<8> = 0;  // 組み合わせ論理にはletを使用

  sync(clk.posedge) {
    var state: bit<8> = 0;  // syncブロック内でのvar（順序回路）
  }
}
```

---

## import-order

### 説明

インポート文の順序が一貫していることを強制します。

**推奨される順序:**
1. 標準ライブラリ（`std::`）のインポート
2. 外部パッケージのインポート（アルファベット順）

### カテゴリ

`style`

### デフォルト重大度

`warning`

### 非推奨な例

```iris
import mylib::util;
import std::io;      // std:: は先頭に配置すべき
```

### 推奨される例

```iris
import std::io;
import mylib::util;
```

---

## duplicate-import

### 説明

同じモジュールやシンボルの重複インポートを検出します。

### カテゴリ

`correctness`

### デフォルト重大度

`warning`

### 非推奨な例

```iris
import std::io;
import std::io;  // 重複

import std::{mem, mem};  // リスト内での重複
```

### 推奨される例

```iris
import std::io;
import std::mem;
```

---

## ルールの設定方法

### 単一ルールの設定

```json
{
  "lint": {
    "rules": {
      "naming-convention": "error"
    }
  }
}
```

### 複数ルールの設定

```json
{
  "lint": {
    "rules": {
      "naming-convention": "warning",
      "unused-variable": "error",
      "unused-signal": "off",
      "no-empty-block": "info"
    }
  }
}
```

### すべてのルールを無効化

```json
{
  "lint": {
    "rules": {
      "naming-convention": "off",
      "unused-variable": "off",
      "unused-signal": "off",
      "unused-import": "off",
      "no-empty-block": "off",
      "var-context-restriction": "off",
      "import-order": "off",
      "duplicate-import": "off"
    }
  }
}
```
