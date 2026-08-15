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

**対照を置いてある。**

| 検査 | 変異 | 結果 |
|---|---|---|
| counterの往復 | 増分を2にする | `resumed=21` → `42` |
| ALUの往復 | SLTを符号無し比較にする | `fails=0` → `1` |
| regfileの往復 | 書き込む値を`wdata+1`にする | `fails=0` → `1` |
| decoderの往復 | 符号ビットの複製をゼロにする | 4形式すべての即値が変わる |

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

`tools/conformance/run.sh`に載せた。130項目から141項目になり、失敗0。

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
| `riscv_core` | 拒否（未実装）。インスタンスのポート読み |
| `async_fifo` | 拒否（未実装）。総称の幅 |

**`riscv_core`の理由は入れ替わった。**
`sign_extend`が解けたので、次に当たったのがこれである。

```
IRIS    alu_a = if dec.alu_a_pc { pc } else { rf.rdata1 };
```

IRISはインスタンスの出力ポートを式の中で直接読む。
Verylにはこの式が無く、インスタンス生成の場で変数へ配線して、
その変数を読む。**書き換えは可能だが、相手のモジュールのポートが要る。**
この変換器は1ファイルずつ読むので、まだそこに手が届かない。

**これも言語の差ではない。**

拒否は2種類に分けて出る。

| 種類 | 例 | 読む者がすること |
|---|---|---|
| 言語に無い | `fsm`、`f32`、`tri` | 設計を書き直すか、諦める |
| この変換器が未実装 | 総称、インスタンスのポート読み、複数値のcaseアーム | 道具を待つ |

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

**まだ拒否するもの。**

| | 理由 |
|---|---|
| 複数値のアーム（`2'd0, 2'd1: x`） | IRISの`match`は1アーム1パターン。分割すれば書けるが未実装 |
| 総称（`bit[DataWidth]`） | Verylにも総称はある。未実装 |
| インスタンスのポート読み（`dec.rd`） | Verylは変数へ配線して読む。相手のポートが要る。未実装 |
| `sign_extend`以外の幅変換 | Verylにも書ける。未実装 |
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
