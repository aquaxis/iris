# Verylとの相互変換

## この資料が扱うもの

[Veryl](https://veryl-lang.org/)とIRISは、
どちらもSystemVerilogの構文を捨てつつ、その生態系は捨てない言語である。
2つの間でソースコードを変換できるかを扱う。

何が変換でき何ができないかを、文法定義の突き合わせと実際の書き換えから確かめ、
その範囲に対して変換器を作りかけている。

作業の記録は`report_veryl.md`にある。

## 変換器の現状

**`tools/veryl2iris/`に作りかけがある。**

| 方向 | 状態 |
|---|---|
| IRIS → Veryl（`iris2veryl`） | 動く。共通部分の一部 |
| Veryl → IRIS（`veryl2iris`） | 動く。共通部分の一部 |

**往復が閉じている。**

```
$ veryl2iris example/comparison/veryl/counter.veryl > c1.iris
$ iris2veryl c1.iris > c2.veryl
$ veryl2iris c2.veryl > c3.iris
$ iris-sim -i c1.iris tb.iris ...   resumed=21
$ iris-sim -i c3.iris tb.iris ...   resumed=21
```

**模擬実行で一致する（T-L3）。**
字面は一致しない。括弧の付き方が変わる。
整形の差で落ちる検査は意味の検証にならないので、値で比べている。

**ALUも往復する。**

```
$ veryl2iris alu.veryl > a1.iris ; iris2veryl a1.iris > a2.veryl ; veryl2iris a2.veryl > a3.iris
a1.iris  alu fails=0
a3.iris  alu fails=0
```

SLTとSLTU、SRAとSRLを含む5項目で確かめている。
`alu.veryl`のコメント自身が、これらは取り違えても動いてしまうと書いている。

**レジスタファイルも往復する。**
`mem`はVerylの配列に写る。

```
IRIS    mem regs: bit[32][32];
Veryl   var regs: logic<32> [32];
```

**デコーダも往復する。符号拡張を測ってからそうなった。**

`sign_extend`は「Verylに無い」と書いていた。**測ったら違った。**

| | 出すもの |
|---|---|
| IRIS `x.sign_extend[32]()` | `32'($signed(x))` |
| Veryl `x as i32` | `int'(x)` |

`int'(x)`は符号無しのxを**ゼロ拡張する**。
xが符号無しである限り、キャストは符号拡張にならない。
**キャストは対応物ではない。**

だが両方の言語が、符号ビットの複製を持っている。

```
IRIS    {20{instr[31]}}, ...
Veryl   {instr[31] repeat 20, ...}
```

これは形が違うだけで、意味は同じである。
`x.sign_extend[N]()`をこれに展開すれば、どちらの言語の
「いつ符号付きとみなすか」の規則にも頼らずに済む。

**言語の差ではなく、道具の差だった。**
根拠のない注記が測定の代わりに置かれていて、それが間違っていた。

I形式・S形式・B形式・J形式の4つの即値すべてで確かめている。

**非同期FIFOも往復する。総称パラメータを運ぶ。**

```
IRIS    mod AsyncFifo[DataWidth: uint = 8, Depth: uint = 16,
                      AddrWidth: uint = $clog2(Depth), ...]
Veryl   module AsyncFifo #(param DataWidth: logic<32> = 8, ...)
```

幅も記憶の深さも、パラメータの式のまま運ぶ。
`$clog2`は両方の言語にある。

**`where`句だけは運べない。**
Verylは`proto`でパラメータの**形**を縛るが、値は縛らない。
`where DataWidth >= 1`に対応物が無い。

**黙って落とさず、失われたと報告する。**
自分の境界条件を静かに失ったモジュールは、
作者が除外したはずの引数を受け取り、まるで別の場所で壊れる。

**プロセッサも往復する。6設計すべてが往復した。**

4モジュールが4ファイルに分かれており、
`riscv_core`はインスタンスの出力を式の中で直接読む。

```
IRIS    alu_b = if dec.alu_b_imm { dec.imm } else { rf.rdata2 };
```

**Verylにこの式は無い。**
出力はインスタンス生成の場で変数へ配線し、その変数を読む。

```
Veryl   var dec_imm: logic<32>;
        inst dec: Decoder (instr: imem_rdata, imm: dec_imm, ...);
        alu_b = if dec_alu_b_imm ? dec_imm : rf_rdata2;
```

**そのために複数ファイルを1つのプロジェクトとして読むようにした。**
`dec.rd`が何かは`decoder.iris`に書いてあり、
`riscv_core.iris`だけを見ても分からない。

変数名は`<インスタンス>_<ポート>`で、
既に使われていれば後ろを伸ばす。
**既存の名前を使い回すと、その名前が元々指していたものに繋がる。**
それは模擬実行を通り、間違っている。

RV32Iの4本の試験プログラムで、元と往復後の出力が1バイトも違わない。

**対照を置いてある。**

| 検査 | 変異 | 結果 |
|---|---|---|
| counterの往復 | 増分を2にする | `resumed=21` → `42` |
| ALUの往復 | SLTを符号無し比較にする | `fails=0` → `1` |
| regfileの往復 | 書き込む値を`wdata+1`にする | `fails=0` → `1` |
| decoderの往復 | 符号ビットの複製をゼロにする | 4形式すべての即値が変わる |
| async_fifoの往復 | `DataWidth`を4に狭める | 検証が落ちる |
| riscv_coreの往復 | `rdata1`の配線を`rdata2`に繋ぎ替える | 出力が変わる |

**async_fifoの対照は、パラメータが往復を生き延びたことを直接示す。**
狭めて壊れるということは、その値が効いているということである。

**decoderの対照は、キャストを使っていたら起きていた失敗そのものである。**
`{20{instr[31]}}`を`{20{1'b0}}`に変えるとゼロ拡張になり、
`i_neg`は`ffffffff`から`fff`になる。
`x as i32`を対応物として採っていたら、これが出ていた。

**decoderの往復は、手で書いた期待値ではなく元のdecoderと比べている。**
命令の符号化を書き写す時に間違えると、検査が検査でなくなるからである。
ただし「元も往復後も符号拡張していない」で一致しては意味がないので、
元のdecoderが実際に`ffffffff`を出していることを先に確かめている。

**regfileの対照は選び直した。**
最初はx0への書き込み禁止条件を外したが、落ちなかった。
この設計は読み出し側でもx0を0にしており、書き込み側の変異が見えない。
**観測できない場所を突いた対照は、対照にならない。**

`tools/conformance/run.sh`に載せた。130項目から151項目になり、失敗0。

**検査そのものが働くことも確かめた。**
`case`の`default`を落とすように変換器をわざと壊すと、
`alu round trip`が失敗する。

**いま往復する設計。**

| 設計 | 状態 |
|---|---|
| `counter` | 往復する |
| `alu` | 往復する |
| `regfile` | 往復する |
| `decoder` | 往復する |
| `async_fifo` | 往復する |
| `riscv_core` | 往復する |

**6設計すべてが往復する。**

### 対応表の行を1つずつ往復させた

**設計が6本通ったことは、構文を網羅したことではない。**
そこで、`Exact`と書いた30行それぞれに小さな断片を書き、往復させた。

| | 数 |
|---|---|
| `Exact`の行 | 30 |
| 往復する断片がある | **29** |
| 断片が書けない | 1 |

**残る1行は`iris-sim`側の未実装であって、この変換器の穴ではない。**

| 行 | 理由 |
|---|---|
| `string` | `iris-sim`に文字列の定数を往復させる手段が無い |

`import`は往復する。
`import Pkg::Item;`と`import Pkg::{A, B};`が両方向で写る。
`::*`だけは`iris-sim`が素の取り込みと区別しないので、断片はこの2形だけを使う。

`function`も往復する。
純粋な関数（束縛と単一の`return`）が両方向で写る。
IRISの引数は向きを持たないので、Verylでは`input`として書く。
`iris-sim`は`let`の型を関数の中で保たないので、往復すると型注記だけが消える。

`interface`と`modport`も往復する。
Verylの`var`信号はIRISの信号に、`modport`はIRISの`view`に写る。
`modport`は信号ごとに向きを書き、`view`は向きでまとめるので、
往復すると信号が向きごとにまとまり直す。
`modport`の`..`（既定の埋め合わせ）はIRISに対応が無いので拒否する。

`type`も往復するようになった。
`iris-sim`が型別名を実装し、解析して名指す型に解決する。

```
$ iris-sim -i alias.iris -c 2
Simulation completed successfully.
```

IRISは`type`をファイルの先頭に置き、Verylはモジュールの中に置く。
`enum`や`struct`と同じ持ち上げで、Veryl→IRISでは外へ持ち上げ、
IRIS→Verylではモジュールの中へ書き入れる。

**この数は`tools/veryl2iris/mapping`の試験が守る。**
行を足して断片も理由も書かなければ、試験が落ちる。
断片を消しても落ちる。**表の行と試験の数が合っていることを機械が見る。**

### 比べるのは2回目からである

往復の1回目は整形をする。

```
1回目  y = b < c        →  y = (b < c)
2回目  y = (b < c)      →  y = (b < c)
```

括弧の付き方で落ちる検査は、意味ではなく整形を見ている。
**確かめるべきは「動かなくなる点に達すること」である。**
2回目と3回目を比べている。

拒否は2種類に分けて出る。

| 種類 | 例 | 読む者がすること |
|---|---|---|
| 言語に無い | `fsm`、`f32`、`tri` | 設計を書き直すか、諦める |
| この変換器が未実装 | `as`キャスト、複数値のcaseアーム | 道具を待つ |

**この2つを混ぜない。**
片方は設計の話、もう片方は道具の話であり、行動が違う。

### 形が違う式は運べない

Veryl → IRISの式は、原則としてトークン列を運んで綴り直している。
**式の節点ごとに印字器を書くと、書き忘れた節点が黙って消えるからである。**

ただしこれは「両方の言語が同じ形で組み立てる式」にしか使えない。

```
Veryl   case x { 1: a, default: b }
IRIS    match x { 1 => a, _ => b }
```

意味は同じだが形が違う。
そのまま運ぶとIRISではないものが出る。

**これは`alu.veryl`を変換して見つけた。**
`case`式がそのまま出て、IRISの構文解析器が拒否した。
それまで変換器は成功と報告していた。

**`case`式と`if`式は、形を組み替えて変換するようにした。**

```
Veryl   y = case op { 4'd0: a + b, default: 32'd0, };
IRIS    y = match op { 4'd0 => a + b, _ => 32'd0, };

Veryl   if sa <: sb ? 32'd1 : 32'd0
IRIS    if sa < sb { 32'd1 } else { 32'd0 }
```

**同じ失敗を`repeat`でもう一度した。**

符号拡張をVerylへ書けるようにした直後、逆向きを試すとこうなった。

```
$ veryl2iris rep.veryl
    o_y = {i_v [11] repeat 20, i_v};    ← IRISではない
$ echo $?
0                                        ← 成功と報告している
```

形が違う構文の一覧に`repeat`が入っていなかった。
**一覧に載せ忘れた構文は、黙って素通りする。**

`case`のときと同じ種類の失敗であり、同じ方法で見つけた。
出したものを相手の構文解析器に通す。

```
Veryl   {a repeat n, b}
IRIS    {{n{a}}, b}
```

**3度目は`as`だった。**

```
$ veryl2iris cast.veryl
    y = a as 32;    ← IRISではない
$ echo $?
0
```

### `as`は、写す先が無かった

拒否する理由を測った。**IRIS側の`as`が実装されていない。**

仕様書と文法定義はどちらも持っている。

```
spec/03_type_system.md:514   | `as T` | 型変換 | `x as bit[16]` |
tools/iris.ebnf:154          cast_expr = expr "as" type_expr ;
```

`iris-sim`は受け付けない。

```
$ iris-sim -i as.iris
comb { y = a as bit[32]; }
Parse error: Syntax error at line 5, column 18: expected postfix or bin_op
```

**メソッド形は全部通る。**

| | 結果 |
|---|---|
| `.extend[32]()`／`.truncate[4]()` | 通る |
| `.saturate[4]()`／`.signed()`／`.unsigned()` | 通る |
| `x as bit[32]` | **構文誤り** |

つまり`as`は、書いてあって作られていない。
**写す先が無いのだから、拒否が正しい。**

これは仕様と実装の差であり、Verylとの差ではない。
`tools/conformance/run.sh`に、
**変換器が拒否すること**と**`iris-sim`が受け付けないこと**を
同時に見る検査を置いた。
`iris-sim`が受け付けるようになれば検査が落ちて、拒否を外せると教える。

### `else if`は式では連ねられない

`riscv_core`の書き戻しは5つの値から1つを選ぶ。

```
Veryl   if a ? x : if b ? y : if c ? z : w
```

これをそのまま平らに写すと、IRISでは通らない。

```
IRIS    if_expr = "if" expr "{" expr "}" "else" "{" expr "}"
```

`else`の後は`{ expr }`だけで、`else if`の形が無い。
**文（`if_stmt`）にはあるが、式には無い。**入れ子にする。

```
IRIS    if a { x } else { if b { y } else { if c { z } else { w } } }
```

条件が1つの設計では出なかった。**`riscv_core`で初めて出た。**

### 宣言に書いた定義を落としていた

**幅の件と同じ種類の、2つ目である。**

行を1つずつ往復させる作業で`let`と`const`に手を付けた時に出た。

```
IRIS                          出していたVeryl
const K: bit[8] = 8'd3;   →   var K: logic<8>;      ← 3が消える
let w: bit[8] = a;        →   var w: logic<8>;      ← w = a が消える
var acc: bit[8] = 8'd7;   →   var acc: logic<8>;    ← 0から始まる
```

**どれも正しいVerylで、模擬実行も通り、違う値を計算する。**

理由付けはこう書いてあった。

> IRISは宣言に初期値を書くが、Verylにその形は無く、
> `always_ff`のリセット節が値の置き場所である

**自分でリセットを書く設計のレジスタについては正しい。それ以外では違う。**
`const`と`let`の初期値は定義そのものであって、リセット値ではない。
`var`の初期値も、リセット節を書かない設計では効いている。

```
$ iris-sim -i initv.iris        # sync にリセット節が無い
before=7    ← 宣言の初期値が効いている
after=9
```

直した。`let`と`const`は定義を持って渡り、
`var`の初期値はVerylの`initial`ブロックになる。
戻す時は`initial`を宣言に畳み込む。**これは正確な逆写像である。**

**`let`と`const`は区別できない。**
`iris-sim`の構文解析器はどちらも「不変で初期値を持つもの」として記録し、
どちらの語が書かれたかを残さない。
`let`はどちらにとっても正しく、`const`は`let w = a`にとって誤りなので、
`let`を書いている。

### 「幅が無い」と「幅を読めなかった」を同じ答えにしていた

**この道具で見つけた中で最も重い不具合である。**

総称パラメータを扱い始めた時に出た。

```
$ veryl2iris w.veryl
mod W(
    in a: bit,        ← logic<Width> だったものが1ビットになっている
    out y: bit,
)
$ echo $?
0                      ← 成功と報告している
```

**出力はIRISとして正しく、模擬実行も通る。**
だから構文解析器では捕まらない。値でしか捕まらない。

```
8ビットのつもり: 200 + 1 = 201
実際に出たもの:  200 + 1 = 1
```

原因は型の幅を読む関数だった。

```rust
fn width_of(spelled: &str) -> Option<usize> {
    ...
    spelled.get(start + 1..end)?.parse().ok()   // "Width" は None になる
}
```

呼ぶ側は`None`を「幅が書かれていない」と読み、`bit`にしていた。
**`logic`（幅なし）と`logic<Width>`（読めない幅）が同じ答えになっていた。**

3つに分けた。

| | 意味 | IRIS |
|---|---|---|
| `None` | `<...>`が無い | `bit` |
| `Literal(8)` | `<8>` | `bit[8]` |
| `Expression("Width")` | `<Width>` | `bit[Width]` |

IRISも幅に定数式を取れるので、式のまま運べばよかった。

**これは`veryl translate`が代入を落とすのと同じ種類の失敗である。**
出したものが「解析を通り、模擬実行も通り、間違っている」。
この道具はそれを避けるために作ったのに、自分がやっていた。

**同じ場所でもう1つ落としていた。**
`#(param ...)`の区画を読むコードが無く、パラメータごと消えていた。
文法上は`module_declaration_opt1`にあるのに、
`opt`（総称）と`opt2`（ポート）しか見ていなかった。
`opt0`（`for` によるproto実装の宣言）も見ておらず、こちらは拒否するようにした。

**節点を「見ていない」ことは、コードのどこにも書かれない。**

**まだ拒否するもの。**

| | 理由 |
|---|---|
| 複数値のアーム（`2'd0, 2'd1: x`） | IRISの`match`は1アーム1パターン。分割すれば書けるが未実装 |
| `as`によるキャスト | **IRIS側の`as`が実装されていない**（下記） |
| `truncate`／`saturate`／`signed`／`unsigned` | Verylにも書ける。未実装 |
| 多次元配列 | IRISの`mem`は1次元。畳むと添字の意味が変わる |
| 大きな式の中の`case`（`8'd1 + case ...`） | 式全体としてのみ組み替えている |
| `switch`、`inside`、`outside`、`msb`、`lsb` | 未実装 |

## 結論から

**共通部分でしか完全にならない。**

| 方向 | 落ちるもの |
|---|---|
| Veryl → IRIS | 7構文、型4種、実数リテラル、範囲パターン、`step`、`modport`の3機能 |
| IRIS → Veryl | `fsm`、`constraint`、`rand`、`mem`の設定 |

**どちらの言語も、相手の全体を受け取れない。**

そのうえで、実用的な広さの共通部分がある。
`example/comparison/veryl/`の設計2本は、その範囲に収まっており、
手で書き換えて模擬実行まで一致した。

## 何が変換できるか

**次の範囲は、どちらの言語仕様も変えずに往復できる。**

```
module 宣言とポート（input / output / inout）
型: logic, logic<N>, signed logic<N>, u8..u64, i8..i64, string, clock, reset
宣言: let, var, const, type, enum, struct, union, function, import
本体: always_ff, always_comb, assign, inst
式: case, 条件式, 算術/論理/比較/シフト演算子
interface と modport（向きを信号ごとに書いたもの）
```

対応はこうなる。

| Veryl | IRIS |
|---|---|
| `module X ( ... ) { }` | `mod X( ... ) { }` |
| `a: input logic<8>` | `in a: bit[8]` |
| `var x: signed logic<32>` | `var x: int[32] = 0` |
| `always_ff (clk) { }` | `sync(clk.posedge) { }` |
| `always_comb { }` | `comb { }` |
| `case op { 4'd0: e, ... }` | `match op { 4'd0 => e, ... }` |
| `if c ? x : y` | `if c { x } else { y }` |
| `a <: b` | `a < b` |
| `u8`、`i32` | `uint[8]`、`int[32]` |

`u8`はIRISでも`uint[8]`の組み込み別名である。
8ビットとして振る舞うことを確かめた。

```
$ iris-sim -i u8test.iris ...
u8: 255+1 = 0
```

## 何が変換できないか

**ここを先に読む。**

### Verylにあり、IRISに無いもの

| Verylの構文 | なぜ変換できないか |
|---|---|
| `f32`、`f64` | IRISに浮動小数点が無い |
| `p8`〜`p64` | IRISに対応する型が無い |
| 実数リテラル（`1.5`） | IRISの`literal`は整数、真偽、文字列のみ |
| `tri` | IRISに三状態が無い。`inout`はあるが別のもの |
| `bind` | 外から既存のインスタンスへ結ぶ構文が無い |
| `connect` | インターフェース同士を結ぶ構文が無い |
| `generate_if`、`generate_block` | 条件付きの構造生成が無い |
| `alias` | モジュールの別名が無い |
| `final` | 終了時ブロックが無い |
| `unsafe` | 対応物が無い |
| `modport`の`..`、`same`、`converse` | `view`に既定の向きも反転も無い |
| 範囲パターン | `match`のパターンに範囲が無い |
| `step`付き部分選択 | `+:`／`-:`のみ |

**`bbool`と`lbool`はIRISの`bool`に写せるが、2種の区別が消える。**

### IRISにあり、Verylに無いもの

Verylの文法定義に次の語は1つも無い。

```
assert  cover  constraint  rand  fsm  state  memory  ram  rom
```

| IRISの構文 | Verylでどうなるか |
|---|---|
| `fsm`、`transitions`、`state`、`goto` | 対応物が無い。手で書き下すことになる |
| `assert`、`cover`、`constraint`、`rand` | 対応物が無い |
| `mem`の`ram`／`rom`／`read_mode`／`init_file` | 配列はあるが設定が無い |
| `test`、`seq`、`await`、`wait`、`drive`、`sample` | 対応物が無い |
| `use rust`、`extern rust` | 対応物が無い |

**IRISは検証と状態機械を言語に持ち、Verylは持たない。**

## 変換器に何を求めるか

**黙って落とさないことである。**

これには2つの実例がある。

**1つ目。`veryl translate`（SystemVerilog → Veryl）。**

| 設計 | 元の代入 | 変換後に残った数 |
|---|---|---|
| `alu` | 5 | 1 |
| `decoder` | 27 | 1 |
| `riscv_core` | 33 | 9 |

`--strict`を付けても黙って代入を落とす。

**2つ目。IRIS側の`iris-sim`。**

存在しない型名を診断なしで通し、1ビットとして扱う。

| 型名 | `bit[8]`の3を代入した結果 |
|---|---|
| `f32`、`f64`、`p32`、`lbool` | すべて 1 |
| `NoSuchTypeAtAll`、`Zzz` | すべて 1 |

`iris2sv`は同じ入力に警告を出す。

```
modonly.iris: warning: User type 'f32' treated as logic[1]
```

**この2つが重なると最悪になる。**

Verylの`f32`をそのまま通す変換器を書くと、

```
変換器      成功と報告する
iris-sim    黙って1ビットとして受け取る
模擬実行    成功する
値          違う
```

**誰も何も言わない。**

したがって変換器は3つに分けて振る舞う。

| 判定 | 振る舞い |
|---|---|
| 変換できる | 変換する |
| 対応はあるが差がある | **差を告げてから変換する** |
| 対応が無い | **位置を添えて拒否する** |

## 実際に書き換えて確かめた

`example/comparison/veryl/`の2本を、機械的な対応だけでIRISへ移した。

**ALU。符号に敏感な箇所を選んだ。**
`alu.veryl`のコメント自身が、SLTとSLTU、SRAとSRLは
取り違えても動いてしまうと書いている。

| 検査 | 期待 |
|---|---|
| SLT、`-1 < 1` | 1 |
| SLTU、`0xFFFFFFFF < 1` | 0 |
| SRA、`-16 >> 1` | `0xFFFFFFF8` |
| SRL、`0xFFFFFFF0 >> 1` | `0x7FFFFFF8` |
| ADD、`12 + 5` | 17 |

```
$ iris-sim -i alu_from_veryl.iris tb.iris -o /dev/null -c 60
fails=0
```

**カウンタ。**

```
$ iris-sim -i counter_from_veryl.iris ctb.iris -o /dev/null -c 40
snap=16 final=21 fails=0
```

有効な間は増え、無効にすると止まり、再び有効にすると続きから増える。

**この2本では足りない。**
どちらもIRISで書けることが分かっている設計をVerylで書いたものであり、
**IRISで書けないVerylを含んでいない。**

そのため「変換できない」の判定は別に確かめた。

```
実数リテラル 1.5   => 通らない
tri bit            => 通らない
範囲パターン 0..3  => 通らない
```

## 構文解析は解決している

**Verylの構文解析器は書かなくてよい。**
`veryl-parser`がクレートとして公開されている。

```
$ cargo add veryl-parser@0.20.3 && cargo build
   Compiling veryl-parser v0.20.3
    Finished `dev` profile in 21.54s
```

実物を解析させた。

```
alu.veryl:     OK  top-level items = 1
counter.veryl: OK  top-level items = 1
```

壊したVerylは位置付きで落ちる。

```
/tmp/broken.veryl: PARSE ERROR SyntaxError { cause: "LA(1): this (IdentifierTerm) at 2:3-7 ...
```

| 部品 | 用途 |
|---|---|
| `Parser::parse(text, path)` | 構文解析 |
| `veryl_grammar_trait` | ASTの型 |
| `veryl_walker::VerylWalker` | ASTの走査 |
| `veryl_token` | 位置情報つきのトークン |

**位置情報があるので、拒否するときに場所を示せる。**

IRIS側の構文解析器も`sim/iris-sim`にRustで存在する。
**両方向がRustで閉じる。**

## 確かめていないこと

| | 内容 |
|---|---|
| `veryl`本体 | **この機械に入らない。** wasmtimeがrustc 1.94を要求し、この機械は1.91.1 |
| 形式的等価性 | `veryl build`が使えないため、SystemVerilogに落として比べる経路が塞がっている |
| `veryl.ebnf`の版 | Veryl 0.20.3から起こしたもの。上流の現行版との差は未確認 |
| `proto`と`extern mod` | 同じでないことは分かったが、差の全体は測っていない |
| Verylの標準ライブラリ | 調べていない |

**この資料の構文の一覧は Veryl 0.20.3 のものである。**
`tools/veryl.ebnf`自身がこう注意している。

```
Veryl moves quickly. This was taken from the release named above; check the
upstream grammar before relying on it for a later version.
```

## 関連する資料

- [言語の比較](./language_comparison.md) — 構文、記述量、速度の比較
- `tools/veryl.ebnf` — Veryl 0.20.3の文法定義、187規則
- `tools/iris.ebnf` — IRISの文法定義、210規則
- `example/comparison/veryl/` — 手書きのVeryl 2本
- `report_veryl.md` — この調査の記録
