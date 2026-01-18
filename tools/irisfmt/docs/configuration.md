# 設定リファレンス

irisfmtは、プロジェクトルートに配置した設定ファイルを通じてカスタマイズできます。

## 設定ファイル

以下のファイル名が認識されます（優先順位順）：

1. `.irisfmtrc.json`
2. `.irisfmtrc`
3. `irisfmt.config.json`

設定ファイルは、対象ファイルのディレクトリから親ディレクトリに向かって検索されます。

## 設定構造

```json
{
  "format": {
    // フォーマット設定
  },
  "lint": {
    // リント設定
  }
}
```

## フォーマット設定 (`format`)

| 設定項目 | 型 | デフォルト | 説明 |
|----------|-----|-----------|------|
| `indentWidth` | number | `4` | インデント幅（スペース数） |
| `useTabs` | boolean | `false` | タブを使用するか |
| `maxLineLength` | number | `100` | 最大行長 |
| `braceStyle` | string | `"same-line"` | ブレーススタイル |
| `trailingComma` | string | `"multi-line"` | 末尾カンマのスタイル |

### indentWidth

インデントに使用するスペースの数を指定します。

```json
{
  "format": {
    "indentWidth": 2
  }
}
```

**Before (indentWidth: 4):**
```iris
mod Counter(in clk: clock) {
    comb {
        let x = 1;
    }
}
```

**After (indentWidth: 2):**
```iris
mod Counter(in clk: clock) {
  comb {
    let x = 1;
  }
}
```

### useTabs

`true`の場合、インデントにタブを使用します。

```json
{
  "format": {
    "useTabs": true
  }
}
```

**Before (useTabs: false):**
```iris
mod Counter(in clk: clock) {
    comb {
        let x = 1;
    }
}
```

**After (useTabs: true):**
```iris
mod Counter(in clk: clock) {
→   comb {
→   →   let x = 1;
→   }
}
```
※ `→` はタブ文字を表します

### maxLineLength

1行の最大文字数を指定します。長い行は自動的に折り返されます。

```json
{
  "format": {
    "maxLineLength": 80
  }
}
```

**Before (maxLineLength: 100):**
```iris
fn calculate(a: uint<32>, b: uint<32>, c: uint<32>) -> uint<32> {
    return a + b + c;
}
```

**After (maxLineLength: 40):**
```iris
fn calculate(
    a: uint<32>,
    b: uint<32>,
    c: uint<32>
) -> uint<32> {
    return a + b + c;
}
```
※ 現在のバージョンでは自動行折り返しは限定的にサポートされています

### braceStyle

ブロックの開始ブレース `{` の配置スタイルを指定します。

- `"same-line"` - 同じ行に配置（K&Rスタイル）
- `"new-line"` - 新しい行に配置（Allmanスタイル）

```json
{
  "format": {
    "braceStyle": "same-line"
  }
}
```

**same-line の例:**
```iris
mod Counter(in clk: clock) {
  // ...
}
```

**new-line の例:**
```iris
mod Counter(in clk: clock)
{
  // ...
}
```

### trailingComma

複数行のリストにおける末尾カンマのスタイルを指定します。

- `"none"` - 末尾カンマなし
- `"all"` - 常に末尾カンマを付ける
- `"multi-line"` - 複数行の場合のみ末尾カンマを付ける（デフォルト）

```json
{
  "format": {
    "trailingComma": "all"
  }
}
```

**trailingComma: "none"**
```iris
mod Counter(
    in clk: clock,
    out count: uint<8>
) {
    // ...
}
```

**trailingComma: "all"**
```iris
mod Counter(
    in clk: clock,
    out count: uint<8>,
) {
    // ...
}
```

**trailingComma: "multi-line"**
```iris
// 複数行の場合は末尾カンマを付ける
mod Counter(
    in clk: clock,
    out count: uint<8>,
) {
    // ...
}

// 単一行の場合は末尾カンマなし
enum State { Idle, Running, Done }
```

## リント設定 (`lint`)

| 設定項目 | 型 | デフォルト | 説明 |
|----------|-----|-----------|------|
| `rules` | object | `{}` | 各ルールの設定 |
| `ignore` | string[] | `[]` | 無視するglobパターン |

### rules

各リントルールの重大度を設定します。

```json
{
  "lint": {
    "rules": {
      "naming-convention": "warning",
      "unused-variable": "error",
      "unused-signal": "off"
    }
  }
}
```

#### 重大度レベル

| レベル | 説明 |
|--------|------|
| `"error"` | エラーとして報告（終了コード1） |
| `"warning"` | 警告として報告 |
| `"info"` | 情報として報告 |
| `"off"` | ルールを無効化 |

### ignore

リント対象から除外するファイルパターンを指定します。

```json
{
  "lint": {
    "ignore": [
      "**/vendor/**",
      "**/generated/**"
    ]
  }
}
```

## 完全な設定例

```json
{
  "format": {
    "indentWidth": 2,
    "useTabs": false,
    "maxLineLength": 100,
    "braceStyle": "same-line",
    "trailingComma": "multi-line"
  },
  "lint": {
    "rules": {
      "naming-convention": "warning",
      "unused-variable": "error",
      "unused-signal": "warning",
      "unused-import": "error",
      "no-empty-block": "warning",
      "var-context-restriction": "error",
      "import-order": "warning",
      "duplicate-import": "error"
    },
    "ignore": [
      "**/test/fixtures/**"
    ]
  }
}
```

## コマンドラインからの設定

設定ファイルの他に、コマンドラインオプションでも設定を指定できます。コマンドラインオプションは設定ファイルより優先されます。

```bash
# 設定ファイルを明示的に指定
irisfmt-format --config custom-config.json src/counter.iris
irisfmt-lint --config custom-config.json src/counter.iris
```
