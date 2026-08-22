# アプリのRust統合の検討

## この文書について

指示はこう言っている。

```
現在、JavaScript/TypeScriptになっているアプリをrustで統合する検討を行う
例えば、irisというコマンドの一つにしてしまい、irisコマンドにシミュレーションが存在する、
例えば`iris sim`のように実行できるようにする検討を行い、どれだけのオプションができるか調査し、
@report_apps.mdに報告する。
```

**これは検討である。実装はしていない。**
`iris`という単一コマンドに統合したときの構成案と、そこで取りうるオプションを調べて並べる。

すべて2026-08-22にこの機械で測った。

## 1. なぜ統合するか

**いま入口が散らばっている。**

利用者はシミュレーションに`iris-sim`、整形に`irisfmt-format`、
変換に`iris2sv`と、別々のコマンドを覚えることになる。
言語もRustとTypeScriptに分かれ、ビルドの仕方も違う。

**1つの`iris`コマンドにサブコマンドで束ねれば、入口が1つになる。**
`cargo`が`cargo build`、`cargo test`と束ねているのと同じ形である。

## 2. 現状

### 2.1 どのツールがどの言語か

```
$ for d in ...; do [ -f "$d/Cargo.toml" ] && echo Rust; [ -f "$d/package.json" ] && echo TS; done
```

| ツール | 言語 | 現在の入口 | 役割 |
|---|---|---|---|
| `iris-sim` | Rust | `iris-sim` | シミュレータ（インタプリタ） |
| `iris-compile` | Rust | `iris-compile` | シミュレータ（コンパイル） |
| `iris-formal` | Rust | `iris-formal` | 形式的等価性の基準モデル生成 |
| `veryl2iris` | Rust | `veryl2iris` | Veryl → IRIS |
| `iris2veryl` | Rust | `iris2veryl` | IRIS → Veryl |
| `irisfmt` | TypeScript | `irisfmt-format`／`-lint`／`-ls`／`-syntax` | 整形、リント、Language Server |
| `iris2sv` | TypeScript | `iris2sv`（`cli`パッケージ） | IRIS → SystemVerilog |
| `sv2iris` | TypeScript | `sv2iris` | SystemVerilog → IRIS |
| `schematic` | TypeScript | ブラウザ（`npm run dev`） | ブロック図ビューア |
| `surfer-plugin` | Rust | Surferのプラグイン | 波形の翻訳 |

### 2.2 Rustはすでに束ねやすい

Rustのツールは`clap`のサブコマンドに素直に載る。
`iris-sim`は現在`-i`／`-o`／`-c`／`--release`の少数の引数で動く。

### 2.3 TypeScriptは重さが3段階ある

| ツール | TypeScriptの重さ |
|---|---|
| `sv2iris` | 中。単一の変換器 |
| `iris2sv` | 大。`analyzer`／`core`／`sv-backend`／`transform`／`cli`の5パッケージ |
| `irisfmt` | 大。`core`（字句・構文・AST）／`format`／`lint`／`ls`／`syntax`／`vscode-iris` |
| `schematic` | 別種。ブラウザのフロントエンドで、CLIではない |

## 3. 構成案

**`iris <サブコマンド>`の木にする。**

```
iris
├── sim        設計を模擬実行する（iris-sim）
├── compile    実行ファイルを生成して模擬実行する（iris-compile）
├── formal     形式的等価性の基準モデルを出す（iris-formal）
├── fmt        整形する（irisfmt-format）
├── lint       リントする（irisfmt-lint）
├── lsp        Language Serverを起動する（irisfmt-ls）
├── sv         SystemVerilogへ変換する（iris2sv）
├── from-sv    SystemVerilogから変換する（sv2iris）
├── veryl      Verylへ／から変換する（veryl2iris／iris2veryl）
└── schematic  ブロック図ビューアを起動する（schematic）
```

`iris sim`が指示の挙げた例である。

### 3.1 双方向の変換をどう束ねるか

`veryl2iris`と`iris2veryl`は向きが逆なだけである。
`iris veryl --to iris`と`iris veryl --to veryl`のように向きを引数にする案と、
`iris veryl import`／`iris veryl export`のように孫サブコマンドにする案がある。
**孫サブコマンドのほうが、`--to`の値を覚えるより読みやすい。**

## 4. どれだけのオプションができるか

### 4.1 `iris sim`

現在の`iris-sim`の引数から起こす。

| オプション | 意味 | 由来 |
|---|---|---|
| `-i, --input <file>...` | 入力の`.iris`（複数可） | 現行 |
| `-o, --output <vcd>` | 波形の出力先 | 現行 |
| `-c, --cycles <n>` | サイクル数 | 現行 |
| `-t, --top <module>` | トップモジュールの指定 | 追加候補 |
| `--vcd/--no-vcd` | 波形を出すか | 追加候補 |

### 4.2 `iris compile`

| オプション | 意味 |
|---|---|
| `-i, --input <file>...` | 入力 |
| `-o, --output <bin>` | 生成する実行ファイル |
| `--release` | 最適化ビルド（現行にある） |

### 4.3 `iris fmt` / `iris lint`

`irisfmt`の設定（`.irisfmtrc.json`）から起こす。

| オプション | 意味 |
|---|---|
| `--write` | 書き戻す（整形） |
| `--check` | 差分があれば失敗する |
| `--indent <n>` | 字下げ幅 |
| `--config <file>` | 設定ファイル |
| `--rules <...>` | 有効にするリント規則（lint） |

### 4.4 `iris sv` / `iris from-sv`

| オプション | 意味 |
|---|---|
| `-i, --input <file>...` | 入力 |
| `-o, --output <dir>` | 出力先 |
| `--tb` | テストベンチも変換する |

### 4.5 `iris veryl`

| サブ | オプション |
|---|---|
| `iris veryl import` | `<file.veryl>`、`--check`（Verylの解析器を通すだけ） |
| `iris veryl export` | `<file.iris>...` |

### 4.6 `iris lsp` / `iris schematic`

`iris lsp`は標準入出力でLSPを話す。オプションはほぼ無い。
`iris schematic`はブラウザを開く。`--port`と`--open`くらい。

**サブコマンドは10前後、オプションは全体で30前後になる見込みである。**

## 5. 移行の重さ

**統合には2つの道がある。**

| 道 | 中身 | 重さ |
|---|---|---|
| 甲 全部Rustへ移植 | TypeScriptの資産をRustで書き直す | 重い。特に`iris2sv`と`irisfmt`の解析器 |
| 乙 `iris`が呼び分ける | Rustは直に、TypeScriptはnodeを起動して呼ぶ | 軽い。まず入口だけ1つにする |

### 5.1 段階を踏むのが現実的である

**まずRustのツールを`iris`に畳む。**
`iris sim`、`iris compile`、`iris formal`、`iris veryl`は、
既存のRustのバイナリをサブコマンドに載せ替えるだけで済む。

**TypeScriptのツールは、当面`iris`から呼び出す。**
`iris fmt`が内部で`irisfmt-format`（node）を起動する形なら、入口は1つになる。
利用者から見れば`iris fmt`で整形できる。

**移植は重い順に後で行う。**
`sv2iris`が最も軽く、次いで`iris2sv`、最後に`irisfmt`である。
`irisfmt`の`core`（字句・構文・AST）は`iris-sim`のpest解析器と役割が重なる。
**Rustに寄せるなら、この重複をどう解くかが要になる。**

### 5.2 `schematic`は畳めない

`schematic`はブラウザのフロントエンドで、CLIではない。
`iris schematic`はサーバかブラウザを起動する入口にとどまる。
ここだけは他と性質が違う。

## 6. 推奨

**乙（呼び分け）で入口を1つにし、そのあと甲（移植）を重い順に進める。**

| 段 | 内容 |
|---|---|
| 1 | `iris`を作り、Rustのツールをサブコマンドに畳む |
| 2 | TypeScriptのツールを`iris`から起動する形にする |
| 3 | `sv2iris`をRustへ移植する |
| 4 | `iris2sv`をRustへ移植する |
| 5 | `irisfmt`をRustへ移植する。`core`の重複を`iris-sim`の解析器に寄せる |

**入口を1つにする効果は段1と段2で出る。**
移植は効果ではなく、言語をRustに統一する作業であり、急がなくてよい。

## 7. やらなかったこと

- **実装していない。** `iris`コマンドは作っていない
- オプションの一覧は現行の引数と妥当な追加から起こしたもので、確定仕様ではない
- `irisfmt`の`core`と`iris-sim`の解析器の重複の解き方は、案の提示にとどめた
- 各ツールの全オプションを網羅してはいない。主要なものを挙げた
