# Verylのサポートの検討

IRISの言語仕様を変更せずにVerylを取り込めるかを調べた報告である。

第I部は仕様を変えずに取り込めるかを、第II部は変換器を作れるかを扱う。

| | 問い | 答 |
|---|---|---|
| **第I部** | 仕様を変えずに取り込めるか | **部分集合なら可能。言語全体は不可能** |
| **第II部** | 変換器を作れるか | **作れる。構文解析は`veryl-parser`で解決済み** |

すべての測定は2026-08-15にこの機械で行った。
示す命令は実際に走らせたものであり、示す出力は実際に返ったものである。

---

# 第I部 仕様を変えずに取り込めるか

## 1. 判定

**部分集合なら取り込める。言語全体は覆えない。**

| 水準 | 内容 | 判定 |
|---|---|---|
| **V-L0** | Verylの文法を読める | **可能。** 文法定義が`tools/veryl.ebnf`にある |
| **V-L1** | 構文の対応付けができる | **可能。** 対応表を5節に出した |
| **V-L2** | 実物を移せる | **可能。** `example/comparison/veryl/`の2本を移した |
| **V-L3** | 移した結果が同じ回路になる | **可能。** 模擬実行で確かめた |
| **V-L4** | 言語全体を覆える | **不可能。** 7構文が表せない |

モジュール本体に書ける23構文を分けるとこうなる。

| 判定 | 数 |
|---|---|
| 表せる | **12** |
| 近いが同じでない | **4** |
| 表せない | **7** |

**したがって答はこうなる。**

Verylのうち、`always_ff`、`always_comb`、`assign`、`inst`、`enum`、`struct`、
`function`、`import`、型定義、定数と変数の宣言までは、
IRISの言語仕様を変えずに受け取れる。

`bind`、`connect`、`generate`の3種、`alias`、`final`、`unsafe`は受け取れない。
浮動小数点と固定小数点の型、実数リテラル、三状態、範囲パターンも受け取れない。

## 2. 先に書いておく危険

**素朴な変換器は、黙って違う回路を作る。**

IRISの`iris-sim`は、知らない型名を受け取っても何も言わず、1ビットとして扱う。

```
$ iris-sim -i f32test.iris ...
f32: y = 1
```

`bit[8]`の値3を`f32`と書いた出力に代入して、1が出ている。

これは`f32`に限らない。

| 型名 | 3を代入した結果 |
|---|---|
| `f32` | 1 |
| `f64` | 1 |
| `p32` | 1 |
| `lbool` | 1 |
| `NoSuchTypeAtAll` | 1 |
| `Zzz` | 1 |

**存在しない型名がすべて通り、すべて1ビットになる。**

`iris2sv`は同じ入力に警告を出す。

```
$ node iris2sv modonly.iris
modonly.iris: warning: User type 'f32' treated as logic[1]
```

**2つのツールで扱いが違う。**
`iris-sim`が黙るほうが危ない。

Verylの`f32`をそのまま通す変換器を書くと、
**変換は成功と報告され、模擬実行も成功し、値だけが違う。**

この不具合は6.4節に改めて書く。

## 3. 「取り込む」の3つの読み方

指示は方向を明示していない。

| | 何をするか | 制約は効くか |
|---|---|---|
| **A** | Veryl → IRIS | **効く** |
| B | IRIS → Veryl | 効かない |
| C | IRIS → Veryl → SystemVerilog | 効かない |

**Aを主とした。**

「IRISの言語仕様を変更しないで」という条件が意味を持つのは、
**Verylの側にIRISで書けないものがあるかもしれない場合**だけである。
BとCではIRISで書けるものを外へ出すだけなので、IRISを変える理由が最初から無い。

BとCは9節で扱う。

## 4. 何を突き合わせたか

両方の文法定義がリポジトリにある。

| ファイル | 規則数 | 由来 |
|---|---|---|
| `tools/iris.ebnf` | 210 | 仕様書16章と同一 |
| `tools/veryl.ebnf` | 187 | Veryl 0.20.3（633a884、2026-08-03） |

予約語を機械的に取り出して突き合わせた。

```
$ （両ファイルから "..." の中の識別子を取り出して集合演算）
Veryl の literal keyword: 85
IRIS  の literal keyword: 114
共通: 29  Verylにのみ: 56  IRISにのみ: 85
```

**予約語の差は出発点であって結論ではない。**

語が違っても表せるものがある。

```
Veryl   always_ff (clk) { }
IRIS    sync(clk.posedge) { }
```

語が同じでも違うものがある。
`interface`は両方にあるが、Verylの`modport`とIRISの`view`は同じではない（5.3節）。

**そのため規則の側で見た。**

## 5. 構文ごとの判定

### 5.1 モジュール本体に書けるもの

Verylの`generate_item`は23の構文を持つ。
IRISの`mod_item`は8つである。

| Verylの構文 | IRISの対応 | 判定 |
|---|---|---|
| `let_declaration` | `let_decl` | 表せる |
| `var_declaration` | `var_decl` | 表せる |
| `const_declaration` | `const_decl` | 表せる |
| `type_def_declaration` | `type_alias` | 表せる |
| `enum_declaration` | `enum_def` | 表せる |
| `struct_union_declaration` | `struct_def`／`union_def` | 表せる |
| `function_declaration` | `fn_def` | 表せる |
| `import_declaration` | `import_decl` | 表せる |
| `inst_declaration` | `inst_decl` | 表せる |
| `always_ff_declaration` | `sync_block` | 表せる |
| `always_comb_declaration` | `comb_block` | 表せる |
| `assign_declaration` | `comb`の中の代入 | 表せる |
| `gen_declaration` | `generic_params`が近い | 近いが同じでない |
| `generate_for_declaration` | `inst u[N]`が部分的 | 近いが同じでない |
| `initial_declaration` | `initial_block`。**`test`の中だけ** | 近いが同じでない |
| `embed_declaration` | `extern_mod_def`が近い | 近いが同じでない |
| `bind_declaration` | 無し | **表せない** |
| `connect_declaration` | 無し | **表せない** |
| `generate_if_declaration` | 無し | **表せない** |
| `generate_block_declaration` | 無し | **表せない** |
| `alias_declaration` | 無し | **表せない** |
| `final_declaration` | 無し | **表せない** |
| `unsafe_block` | 無し | **表せない** |

`initial`が`test`の中だけであることは確かめた。

```
$ echo 'mod M(out y: bit[8],) { initial { y = 1; } comb { } }' > ini.iris
$ iris-sim -i ini.iris ...
Error: Failed to load file: ini.iris
```

### 5.2 型

| Verylの型 | IRISの対応 | 判定 |
|---|---|---|
| `logic`、`logic<N>` | `bit`、`bit[N]` | 表せる |
| `u8`〜`u64` | `uint[N]`。`u8`は組み込み別名 | 表せる |
| `i8`〜`i64` | `int[N]` | 表せる |
| `signed logic<N>` | `int[N]` | 表せる |
| `string` | `string` | 表せる |
| `clock`、`reset` | `clock`、`reset` | 表せる |
| `bbool`、`lbool` | `bool`。**2種の区別が無い** | 近いが同じでない |
| `f32`、`f64` | 無し | **表せない** |
| `p8`〜`p64` | 無し | **表せない** |
| `tri` | 無し | **表せない** |

`u8`が本当に8ビットであることは確かめた。

```
$ iris-sim -i u8test.iris ...
u8: 255+1 = 0
```

`tri`が通らないことも確かめた。

```
mod M(inout p: tri bit,) { comb { } }
=> 通らない
```

### 5.3 インターフェース

| Verylの構文 | IRISの対応 | 判定 |
|---|---|---|
| `modport`の`input`／`output` | `view`の`in`／`out` | 表せる |
| `modport_default`の`..` | 無し | **表せない** |
| `same(...)`、`converse(...)` | 無し | **表せない** |

Verylの`modport`は既定の向きを`..`で指定でき、
`converse`で別のmodportの向きを反転して作れる。
IRISの`view`は信号ごとに向きを書くだけである。

**「`view`があるから`modport`は表せる」と書くと、この差が消える。**

### 5.4 式と文

| Verylの構文 | IRISの対応 | 判定 |
|---|---|---|
| `case`式 | `match`式 | 表せる |
| `switch`式 | `if`／`match`の連鎖 | 表せる |
| `if c ? x : y` | `if c { x } else { y }` | 表せる |
| `a <: b` | `a < b` | 表せる |
| `>>>`、`<<`、`>>` | 同じ | 表せる |
| `+=`、`-=`ほか | `a = a + b`と書き換える | 表せる |
| `inside`／`outside` | **`match`に範囲パターンが無い** | 近いが同じでない |
| `select_operator`の`step` | `+:`／`-:`のみ | **表せない** |
| 実数リテラル（`1.5`） | 無し | **表せない** |
| `msb`、`lsb` | 式で書ける（`width-1`） | 表せる |

範囲パターンが無いことは確かめた。

```
mod M(in s: bit[4], out y: bit[8],) { comb { y = match s { 0..3 => 8'd1, _ => 8'd0, }; } }
=> 通らない
```

実数リテラルも通らない。

```
mod M(out y: bit[8],) { comb { y = 1.5; } }
=> 通らない
```

**この2つは、通らないことが正しい振る舞いである。**
2節の型名と違い、黙って別の意味にはならない。

## 6. 実物で確かめた

### 6.1 ALU

`example/comparison/veryl/alu.veryl`を、機械的な対応だけでIRISへ移した。

```
module X ( ... ) { }        ->  mod X( ... ) { }
op: input logic<4>          ->  in op: bit[4]
var sa: signed logic<32>    ->  var sa: int[32] = 0
always_comb { }             ->  comb { }
case op { 4'd0: e, ... }    ->  match op { 4'd0 => e, ... }
if c ? x : y                ->  if c { x } else { y }
a <: b                      ->  a < b
```

**符号に敏感な箇所を選んで突き合わせた。**
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

**5項目すべて一致した。**

### 6.2 カウンタ

`counter.veryl`も同じように移した。

```
$ iris-sim -i counter_from_veryl.iris ctb.iris -o /dev/null -c 40
snap=16 final=21 fails=0
```

有効な間は増え、無効にすると止まり、再び有効にすると続きから増える。

**最初のテストベンチは失敗した。**
クロック周期の仮定から数え上げの期待値を書いていたためで、
移した設計の誤りではなかった。
性質そのものを見る形に書き直して通した。

### 6.3 この2本では足りない

**どちらもIRISで書けることが分かっている設計をVerylで書いたものである。**
`example/`に対応するIRIS版がある。

**IRISで書けないVerylを含んでいない。**
そのため5節の「表せない」の判定は、この2本では確かめられない。

そこで別に確かめた。5.2節と5.4節の「通らない」がそれである。

### 6.4 未定義の型が黙って通る

**2節に書いた不具合である。**

| 項目 | 内容 |
|---|---|
| 症状 | 存在しない型名が診断なしで通り、1ビットとして扱われる |
| 部品 | `iris-sim` |
| 再現 | `mod M(in a: bit[8], out y: f32,) { comb { y = a; } }`に3を入れると1が出る |
| 対照 | `NoSuchTypeAtAll`、`Zzz`も同じ結果 |
| 他ツール | `iris2sv`は`warning: User type 'f32' treated as logic[1]`を出す |

**Verylを取り込むうえで、これは単なる不具合ではない。**

Verylには`f32`、`f64`、`p8`〜`p64`、`bbool`、`lbool`という、
IRISに無い型名が10個ある。
素朴な変換器がそれを通すと、**すべて1ビットの信号になり、誰も気づかない。**

**この作業では直していない。指示の動詞は調査である。**

## 7. 仕様を変えずに覆える部分集合

**次の範囲のVerylは、IRISの言語仕様を変えずに受け取れる。**

```
module 宣言とポート（input / output / inout）
型: logic, logic<N>, signed logic<N>, u8..u64, i8..i64, string, clock, reset
宣言: let, var, const, type, enum, struct, union, function, import
本体: always_ff, always_comb, assign, inst
式: case, switch, 条件式, 算術/論理/比較/シフト演算子, 複合代入
interface と modport（向きを信号ごとに書いたもの）
```

**`example/comparison/veryl/`の2本は、この範囲に収まっている。**
だから移せた。

### 7.1 範囲の外にあるもの

| 構文 | なぜ表せないか |
|---|---|
| `f32`、`f64`、`p8`〜`p64` | IRISに浮動小数点も固定小数点も無い。実数リテラルも無い |
| `tri` | IRISに三状態が無い。`inout`はあるが別のもの |
| `bind` | 外から既存のインスタンスへ結ぶ構文が無い |
| `connect` | インターフェース同士を結ぶ構文が無い |
| `generate_if`／`generate_block` | 条件付きの構造生成が無い |
| `alias` | モジュールの別名が無い |
| `final` | 終了時ブロックが無い |
| `unsafe` | 対応物が無い |
| `modport`の`..`／`converse` | `view`に既定の向きも反転も無い |
| 範囲パターン | `match`のパターンに範囲が無い |
| `step`付きの部分選択 | `+:`／`-:`のみ |

### 7.2 変換器の側で処理できるもの

**言語仕様を変えなくても、変換器が引き受けられるものがある。**

| 構文 | 変換器がどうするか |
|---|---|
| `+=`、`-=`ほか | `a = a + b`へ展開する |
| `msb`、`lsb` | `width-1`、`0`へ展開する |
| `switch`式 | `if`の連鎖へ展開する |
| `a <: b` | `a < b`へ置き換える |
| `generate_for` | 定数回なら展開する。`inst u[N]`に落ちる場合もある |
| `include` | 取り込んで1つの入力にする |

**これらは「仕様を変えずに取り込める」に入る。**
7.1節と混ぜない。

## 8. 仕様を変えるとしたら

**変えていない。指示が禁じている。以下は提案である。**

| 何を足すか | 何が覆えるようになるか | 大きさ |
|---|---|---|
| `match`のパターンに範囲 | `inside`、`outside`、範囲付き`case` | **小**。文法の1規則 |
| `view`に既定の向きと反転 | `modport`の`..`、`same`、`converse` | 小 |
| 部分選択に`step` | `select_operator` | 小 |
| 条件付き生成（`gen if`相当） | `generate_if`、`generate_block` | 中 |
| 三状態の型 | `tri` | 中。型体系と模擬実行に波及 |
| 浮動小数点と固定小数点 | `f32`、`f64`、`p8`〜`p64`、実数リテラル | **大**。型体系、演算、模擬実行、変換のすべてに波及 |

**最後の行が、V-L4が不可能である理由である。**

`bind`、`alias`、`unsafe`、`final`は、
言語に足すべきかどうかがIRISの設計判断であり、
Verylに合わせる理由だけで決めるものではない。

## 9. 読み方BとC

### 9.1 IRIS → Veryl

**この向きではIRISの仕様を変える理由が無い。**
指示の制約が空振りする。

問いは反転し、「IRISに書けてVerylに書けないものは何か」になる。
予約語ではIRIS側に85語が残る。

| IRISの構文 | Verylの対応 |
|---|---|
| `fsm`、`transitions`、`state`、`goto`、`when` | 無し。手で書くことになる |
| `mem`と`ram`／`rom`／`read_mode`／`init_file` | 配列はあるが設定は無し |
| `assert`、`assume`、`cover`、`constraint`、`rand` | 無し |
| `test`、`seq`、`await`、`wait`、`drive`、`sample` | 無し |
| `use rust`、`extern rust` | 無し |
| `view`の`initiator`／`target`／`monitor` | `modport`が近い |

**IRISのほうが検証と状態機械を言語に持っている。**
Verylへ出すと、そこが落ちる。

### 9.2 IRIS → Veryl → SystemVerilog

**確かめていない。`veryl`をこの機械に入れられなかった。**

```
$ cargo install veryl --locked
wasmtime-internal-unwinder@47.0.3 requires rustc 1.94.0

$ cargo install veryl --version 0.20.3 --locked
（同じ理由で失敗）
```

この機械のrustcは1.91.1である。

`iris2sv`がすでにSystemVerilogを直接出しているので、
Verylを挟む利点は、Verylのフォーマッタ、言語サーバ、標準ライブラリを使えることになる。
**その利点があるかは、動かしていないので判断できない。**

## 10. 判断できなかったこと

**書き漏らしではなく、確かめていないものとして挙げる。**

| ID | 問い | 状態 |
|---|---|---|
| W-1 | `veryl`をこの機械に入れられるか | **解決。入らない。** rustc 1.94が要る |
| W-2 | `tools/veryl.ebnf`はVerylの現行版と一致するか | **未解決** |
| W-3 | `proto`と`extern mod`は同じか | **未解決** |
| W-6 | Verylの標準ライブラリに何があるか | **未解決** |

**W-2は結果全体に効く。**

**追記（第II部）。** `veryl`本体は入らないが、`veryl-parser`クレートは動いた。
これで実物のVerylを解析できるので、W-2に手が届く道はある。
ただし解析できるのはやはり0.20.3であり、上流の現行版との差は依然として未確認である。

`tools/veryl.ebnf`はVeryl 0.20.3から起こしたもので、ファイル自身がこう書いている。

```
Veryl moves quickly. This was taken from the release named above; check the
upstream grammar before relying on it for a later version.
```

**この報告の構文の一覧は、0.20.3のものである。**
`veryl`を入れられなかったため、現行版との差は確かめていない。

W-3は`proto`を「近いが同じでない」に置いた根拠が弱いままであることを意味する。
Verylの`proto`はモジュール、インターフェース、パッケージの3つに付き、
総称の境界にも使われる。
`extern mod`はモジュールの外部宣言だけである。
**同じでないことは分かるが、どこまで違うかは測っていない。**

---

# 第II部 変換器の実現可能性

**追記。** VerylからIRISへ変換するトランスパイラを作れるかを検討した。

## 11. 判定

**作れる。前段は解く必要がない。**

最も重いはずの構文解析が、**Veryl自身のパーサをそのまま使える**ことで消える。

| 段 | 何が要るか | 状態 |
|---|---|---|
| 字句解析 | | **不要。`veryl-parser`が持つ** |
| 構文解析 | | **不要。`veryl-parser`が持つ** |
| AST | | **不要。`veryl_grammar_trait`が持つ** |
| 対応付け | VerylのAST → IRISのAST | **要る。ここが本体** |
| 出力 | IRISのソース | 要る |
| 診断 | 表せない構文の報告 | **要る。最も重要** |

## 12. `veryl-parser`がこの機械で動く

**`veryl`本体は入らなかったが、パーサだけなら入る。**

```
$ cargo install veryl --locked
wasmtime-internal-unwinder@47.0.3 requires rustc 1.94.0
```

本体が要求するのは、埋め込み実行のためのwasmtimeである。
パーサはそれに依存しない。

```
$ cargo add veryl-parser@0.20.3 && cargo build
   Compiling veryl-parser v0.20.3
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 21.54s
```

**rustc 1.91.1で通った。**

実物を解析させた。

```
$ cargo run -- example/comparison/veryl/alu.veryl example/comparison/veryl/counter.veryl
alu.veryl: OK  top-level items = 1
counter.veryl: OK  top-level items = 1
```

対照として壊したVerylを与えた。

```
/tmp/ok.veryl: OK  top-level items = 1
/tmp/broken.veryl: PARSE ERROR SyntaxError { cause: "LA(1): this (IdentifierTerm)
                   at /tmp/broken.veryl:2:3-7 ...
```

**正しいものは通り、壊れたものは位置付きで落ちる。**
パーサが実際に検査している。

`veryl-parser`は次を備えている。

| 部品 | 用途 |
|---|---|
| `Parser::parse(text, path)` | 構文解析 |
| `veryl_grammar_trait` | ASTの型 |
| `veryl_walker::VerylWalker` | ASTの走査 |
| `veryl_token` | 位置情報つきのトークン |

**診断に位置を付けられる。**
14節で述べるとおり、これは飾りではない。

## 13. `sv2iris`との比較が規模の目安になる

このリポジトリには、同じ形の変換器がすでにある。

| | `sv2iris` | `veryl2iris`（見込み） |
|---|---|---|
| 入力 | SystemVerilog | Veryl |
| 出力 | IRIS | IRIS |
| 言語 | TypeScript | **Rust**（`veryl-parser`を使うため） |
| 字句解析 | 1,046行 | **0行** |
| 構文解析 | 2,514行 | **0行** |
| AST | 1,397行 | **0行** |
| 変換 | 2,384行 | 要る |
| 出力 | 937行 | 要る |
| CLI、エラー | 791行 | 要る |
| 試験 | 443行 | 要る |
| **合計** | **9,625行** | **見込み 3,500〜4,500行** |

**`sv2iris`の9,625行のうち4,957行が前段である。**
`veryl2iris`ではそこが要らない。

残るのは変換、出力、診断、CLI、試験である。
`sv2iris`の対応部分は4,555行なので、同じ程度と見る。

**ただしこれは見込みである。**
書いていないので、測った数ではない。

### 13.1 言語の選択

**Rustになる。**

理由は`veryl-parser`がRustのクレートだからである。
TypeScriptで書くなら187規則の構文解析器を手で書くことになり、
`sv2iris`が49規則のSystemVerilog部分集合に2,514行を使ったことから、
前段だけで数千行が戻ってくる。

置き場所は`tools/veryl2iris/`が既存の並びに合う。

**IRISのシミュレータと同じRustになるので、`sim/`の資産を使う道も開く。**
変換したIRISをその場で解析して、対応が正しいかを確かめられる。

## 14. 本当に難しいのは変換ではなく診断

**第I部5節の判定表から、変換器が何をすべきかが決まる。**

| 判定 | 数 | 変換器の振る舞い |
|---|---|---|
| 表せる | 12 | 変換する |
| 近いが同じでない | 4 | **差を告げてから変換する** |
| 表せない | 7 | **拒否する。黙って落とさない** |

### 14.1 黙って落とすと何が起きるか

**この危険には、すでに2つの実例がある。**

**1つ目。`veryl translate`（SystemVerilog → Veryl）。**

| 設計 | 元の代入 | 変換後に残った数 |
|---|---|---|
| `alu` | 5 | 1 |
| `decoder` | 27 | 1 |
| `riscv_core` | 33 | 9 |

`--strict`を付けても黙って代入を落とす。

**2つ目。IRIS側の`iris-sim`。**

第I部2節で測ったとおり、存在しない型名がすべて通り、1ビットになる。

**この2つが重なると最悪になる。**

Verylの`f32`を変換器がそのまま`f32`として出すと、

```
変換器      成功と報告する
iris-sim    黙って1ビットとして受け取る
模擬実行    成功する
値          違う
```

**誰も何も言わない。**

### 14.2 したがって設計はこうなる

```
表せない構文に出会ったら、位置を添えて拒否する
近いが同じでない構文は、何が変わるかを告げてから変換する
未知の型名は、絶対にそのまま出さない
```

3行目が要である。
`veryl-parser`が位置情報を持っているので、こう出せる。

```
alu.veryl:21:18: error: Veryl の f32 は IRIS に対応する型が無い
```

**`tools/conformance/run.sh`が既に同じ不変条件を検査している。**

```
- 扱えない入力は黙って消えず、診断が出る
```

`veryl2iris`を作るなら、この検査に加えるのが筋である。

## 15. 段階の切り方

**全部を一度に作らない。**

| 段 | 覆う範囲 | 確かめ方 |
|---|---|---|
| **1** | `module`、ポート、`logic`型、`always_comb`、`assign` | 組み合わせ回路が移る |
| **2** | `always_ff`、`var`、`if_reset` | 順序回路が移る |
| **3** | `enum`、`struct`、`function`、`import`、`const` | `example/comparison/veryl/`の2本が移る |
| **4** | `interface`、`modport`（向きを書いたもの） | 階層のある設計が移る |
| **5** | `inst`、`generate_for`の定数展開 | 実用的な設計が移る |

**段1と段2で、第I部6.2節のカウンタが移る。**
段3までで、第I部6.1節のALUが移る。

どちらも今回は手で移して動作を確かめてあるので、
**変換器が出すべき答が分かっている状態で作れる。**

これは前回、証明の駆動部を基準モデルより先に作ったのと同じ形である。
答が分かっているうちに道具を作るほうが安い。

### 15.1 検査の作り方

`example/comparison/veryl/`の2本は、対応するIRIS版が`example/`にある。

```
alu.veryl      -> example/riscv/src/alu.iris に対応
counter.veryl  -> example/counter/src/counter.iris に対応
```

**変換器の出力と、手で書いたIRISを突き合わせられる。**
字面は一致しなくてよい。
第I部6節と同じように、模擬実行して値が一致すればよい。

## 16. 作らないと分からないこと

| | 何が分からないか |
|---|---|
| 変換の実際の行数 | 13節は`sv2iris`からの見込みであり、測った数ではない |
| `veryl_walker`の使い勝手 | ハンドラ方式であり、素朴な訪問者と作りが違う |
| `veryl-parser`の版追従 | 0.20.3で確かめた。上流が動くとASTの型も動く |
| 段4以降の難しさ | `interface`と`modport`は第I部5.3節のとおり差がある |

**`veryl-parser`に依存することは、Verylの版に縛られることでもある。**

`tools/veryl.ebnf`が「Verylは速く動く」と注意しているのと同じ問題が、
今度は文法定義ではなくクレートの側に来る。
Cargo.tomlで版を固定することになる。

これは`tools/surfer-plugin`で`surfer-translation-types`を
タグ`v0.7.0`に固定したのと同じ扱いである。

## 17. 第II部のまとめ

**作れる。前段が要らないぶん、`sv2iris`より小さくなる。**

| 問い | 答 |
|---|---|
| 構文解析は解けるか | **解けている。`veryl-parser`が動く** |
| 言語は何になるか | **Rust。** パーサがRustのクレートだから |
| 規模は | 見込み3,500〜4,500行。`sv2iris`は9,625行 |
| 何が難しいか | **変換ではなく診断。** 表せない7構文を黙って落とさないこと |
| 何を覆えるか | 第I部7節の部分集合。段階的に広げられる |
| 何を覆えないか | 第I部7.1節の11項目。仕様を変えない限り |

**そして作る前に直すべきものが1つある。**

`iris-sim`が未知の型名を黙って1ビットにする（第I部2節、6.4節）。
これを残したまま変換器を作ると、
**変換器がどれだけ丁寧に診断を出しても、出力を受け取る側が黙る。**

---

## 18. 測定に使った環境

| 道具 | 版 |
|---|---|
| `iris-sim` | このリポジトリの`sim/iris-sim` |
| `iris2sv` | このリポジトリの`tools/iris2sv` |
| `cargo` / `rustc` | 1.91.1 |
| `veryl`（本体） | **入らない。** wasmtimeがrustc 1.94を要求する |
| `veryl-parser`（クレート） | **0.20.3が動く。** rustc 1.91.1で組み立てた |
| `tools/veryl.ebnf` | Veryl 0.20.3（633a884、2026-08-03）由来 |

## 19. この調査で変えていないもの

指示は「IRISの言語仕様を変更しないで」と書いている。

| 項目 | 状態 |
|---|---|
| `spec/` | **変えていない** |
| `tools/iris.ebnf` | **変えていない** |
| `sim/`、`tools/`の各ツール | 変えていない |
| `doc/` | 変えていない |

6.4節の不具合も直していない。
**指示の動詞は調査である。**

移した設計とテストベンチは作業用の一時領域に置いた。
**リポジトリに加えたのはこの報告書だけである。**
