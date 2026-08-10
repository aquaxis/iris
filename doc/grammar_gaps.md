# 仕様書と文法定義と実装の食い違い

## この資料が扱うもの

IRISの言語は3箇所に書かれている。

| 文書 | 役割 |
|---|---|
| `spec/*.md` | 各章のEBNFと、散文と、コード例 |
| `tools/iris.ebnf` | 文法の定義。`spec/16_grammar.md`と同一 |
| `sim/iris-sim/src/parser/iris.pest` | 基準実装が実際に走らせる文法 |

章のEBNFと`tools/iris.ebnf`の食い違いは解消した。
`tools/conformance/grammar_check.py`がそれを検査する。

**残るのは、仕様書のコード例が使う構文である。**

仕様書から完結した例を55個抜き出し、基準実装に通した。
19個が構文解析を通らない。

```bash
python3 tools/conformance/grammar_check.py   # 章とEBNFの突き合わせ
```

この資料は、その19個が必要とするものを並べる。
**どれも直していない。** 実装するのも、仕様から消すのも、言語の設計判断だからである。

## 分類

### 1. 文法にあり、実装に無い

`tools/iris.ebnf`が定義しており、`iris.pest`に無いものである。
文法と実装のどちらかを動かせば済む。

| 構文 | 章 | 文法の規則 |
|---|---|---|
| `T: type = bit[8]` 型の境界 | 15 | `generic_bound = "type" \| "uint" \| ...` |
| `extern rust "..." { }` | 11 | `extern_rust_block` |
| `enum E[W: uint = 8]` | 03 | `enum_def` の `[ generic_params ]` |
| `struct S[W: uint = 8]` | 03 | `struct_def` の `[ generic_params ]` |
| `comb default(y = 0) { }` | 05 | `default_spec` |
| `'hFF` サイズ無しリテラル | 02 | `integer_literal` の `[ literal_size ]` |

**この6件は、文法が言語を定めていて実装が追いていないだけである。**
仕様書の記述は正しい。

### 2. どこにも無い

仕様書のコード例だけに現れ、`tools/iris.ebnf`にも`iris.pest`にも規則が無い。

| 構文 | 章 | 例 |
|---|---|---|
| 境界なしの型パラメータ | 03 | `mod Fifo[T, Depth: uint = 16]` |
| 配列展開 | 04 | `enable: enables[..]` |
| ジェネリックなインターフェースの実体化 | 08 | `let bus: AxiLite[AddrWidth: 16]` |
| ポート配列 | 08 | `initiator ports[4]: AxiLite` |
| ビュー方向に別のビュー | 08 | `write: initiator` |
| 配列リテラル | 10 | `const t: bit[8][16] = [ ... ]` |
| `mem`の設定キー`clocks` | 10 | `clocks: independent` |
| テストベンチAPI | 11 | `Clock.new(period: 10.ns)`（5例） |
| 本体の無いモジュール宣言 | 11 | `pub mod test_utils;` |
| ビューの短縮記法 | 15 | `out awaddr,` |

**この10件は、仕様書が言語に無いものを説明している。**

### 3. 抽出の都合

定義と使用例が1つのコードブロックに同居しているため、
そのままでは1つのファイルとして通らないものである。

`03_type_system`の3例が該当する。
文法の問題ではない。

## それぞれが必要とするもの

### 境界なしの型パラメータ

```
mod Fifo[T, Depth: uint = 16]
```

`generic_param = identifier ":" generic_bound [ "=" default_value ]`は境界を必須にしている。
`T`だけを書くには、境界を省いたときの既定を決める必要がある。
`type`を既定にするのが素直だが、`uint`との取り違えを招く。

15章は`T: type = bit[Width]`と書いており、こちらは文法に収まる。
**同じ資料の中で2通りの書き方が使われている。**

### 配列展開

```
inst cells[4] = Cell { enable: enables[..] };
```

インスタンス配列の各要素へ、配列の各要素を配ることを意味する。
インスタンス配列（`inst u[4] = M { ... }`）は文法にあるが、
その接続をどう書くかは定めていない。

### ポート配列とジェネリックなインターフェース

```
initiator ports[4]: AxiLite
let bus: AxiLite[AddrWidth: 16, DataWidth: 32]
```

`port_decl = port_direction identifier ":" type_expr`に配列の指定は無い。
インターフェースを型引数付きで使う書き方も無い。

8章はインターフェースの章であり、**章の主題そのものが文法から外れている。**

### 配列リテラル

```
const lookup: bit[8][16] = [
    8'h00, 8'h01, ...
];
```

ROMの初期値を書く手段である。
`mem`の初期化は10章の主題であり、代わりの手段は用意されていない。

### `Clock.new(period: 10.ns)`

11章の5例が使っている。

```
let clk = Clock.new(period: 10.ns);
```

IRISが実際に持つのは型による宣言である。

```
let clk: clock(period: 10ns);
```

**別系統のAPIであって、記法の違いではない。**
どちらを採るかは検証環境の設計判断になる。

## なぜ直していないか

**消せば、書かれた意図が失われる。**
通らない例を削れば仕様書は一貫するが、説明していたことが減る。
FSMの章が誰も実装していない言語を説明するに至ったのは、
確かめる者がおらず、記録も残らなかったからである。

**`tools/iris.ebnf`に足せば、矛盾が移る。**
文法が定めて実装が持たない機能が増えるだけで、
上の「1. 文法にあり、実装に無い」が長くなる。

**実装すれば、言語に機能が増える。**
ポート配列も配列リテラルも、あって困るものではない。
だが`Clock.new`のように、既存の書き方と競合するものもある。

判断の材料を揃えるところまでが、この資料の役目である。

## 数字の作り直し方

```bash
python3 tools/conformance/grammar_check.py
tools/conformance/run.sh
```
