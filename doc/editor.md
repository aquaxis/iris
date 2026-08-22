# エディタ支援

IRISはVSCode拡張を持つ。
拡張は`tools/irisfmt/packages/vscode-iris`にある。

## 2つの層

拡張は2つの層でエディタを支える。
どの機能がどの層で効くかが分かると、片方が動かないときの切り分けができる。

| 層 | 何をするか | 動く条件 |
|---|---|---|
| Syntax Highlight | 予約語、型、数値、演算子を色付けする | 文法ファイルだけで効く |
| Language Server | 診断、フォーマット、補完、ホバー、定義へ移動、参照検索、リネーム | サーバのビルドと起動が要る |

**Syntax HighlightはLanguage Serverが動かない環境でも効く。**
TextMate文法（`syntaxes/iris.tmLanguage.json`）だけで色が付くためである。

Language Serverの詳細は`tools/irisfmt-ls.md`にある。

## 何ができるか

### Syntax Highlight

`.iris`と`.irs`のファイルで、次を色付けする。

| 種類 | 例 |
|---|---|
| 制御 | `if`、`else`、`match`、`for`、`while`、`return`、`when`、`goto`、`break`、`continue`、`until`、`await`、`default` |
| 宣言 | `mod`、`fn`、`let`、`var`、`const`、`type`、`struct`、`union`、`enum`、`interface`、`package`、`import`、`use`、`export`、`extern`、`extends` |
| ハードウェア | `comb`、`sync`、`seq`、`fsm`、`state`、`transitions`、`mem`、`inst`、`ram`、`rom`、`initial`、`event` |
| 検証 | `assert`、`assume`、`expect`、`cover`、`rand`、`constraint`、`test`、`wait`、`sample`、`timeout`、`should_fail` |
| 深刻度 | `error`、`warning`、`fatal` |
| 方向 | `in`、`out`、`inout`、`initiator`、`target`、`monitor` |
| 修飾 | `pub`、`mut`、`async`、`parametric`、`ignore` |
| 型 | `bit`、`int`、`uint`、`bool`、`clock`、`reset`、`string`、`logic` |
| エッジ | `posedge`、`negedge`、`sync_reset` |
| 数値 | 10進、16進（`0x`）、2進（`0b`）、8進（`0o`）、幅付き（`16'd400`）、時間（`10ns`） |

**予約語の一覧は`tools/iris.ebnf`から起こした。**
言語にある語を色付けするだけであり、言語仕様は変えていない。

### Language Server

`irisfmt-ls.md`によれば、次を提供する。

| 機能 | LSPメソッド |
|---|---|
| 診断 | `textDocument/publishDiagnostics` |
| フォーマット | `textDocument/formatting` |
| 補完 | `textDocument/completion` |
| ホバー | `textDocument/hover` |
| 定義へ移動 | `textDocument/definition` |
| 参照検索 | `textDocument/references` |
| ドキュメントシンボル | `textDocument/documentSymbol` |
| リネーム | `textDocument/rename` |

## 使い方

### ビルド

`tools/irisfmt`で全体をビルドする。

```
$ tsc --build
```

VSCode拡張だけをビルドする場合は次を実行する。

```
$ cd packages/vscode-iris
$ tsc -p ./
```

### 拡張として使う

拡張は言語`iris`を`.iris`と`.irs`に結び、
文法`source.iris`を`syntaxes/iris.tmLanguage.json`に結んでいる。
VSCodeで`.iris`を開くと、Syntax Highlightが効く。

Language Serverは拡張が起動する。
ステータスバーの`IRIS`が、起動中、実行中、停止のどれかを示す。

## 検証

すべて2026-08-22にこの機械で測った。

### ビルドとテスト

```
$ tsc --build
（終了コード 0）

$ cd packages/vscode-iris && tsc -p ./
（終了コード 0）

$ vitest run
Test Files  4 passed (4)
     Tests  104 passed (104)
```

104件のうち14件は`packages/ls`のLSPプロトコルの試験である。

### 文法の検査

文法の各正規表現がコンパイルできること、
足した予約語がその種類で一致すること、
対照（綴りを変えた語）が一致しないことを確かめた。

```
H-L1 regex compile: ok
scanned 11 example files with all patterns: ok
RESULT: all checks passed
```

幅付きリテラル（`16'd400`、`'hFF`）と時間（`10ns`、`1.5us`）が一致し、
アポストロフィの無い`8hFF`は幅付きリテラルとして一致しないことを対照で確かめた。

## 確かめていないこと

**実際のVSCodeを立ち上げて色を目で見てはいない。**
文法の検査はJavaScriptの正規表現で行った。
VSCodeが使うOnigurumaとは実装が違うが、
ここで使う正規表現は語境界と文字クラスだけであり、両者は一致する。

**Onigurumaによる完全なトークン化は行っていない。**
