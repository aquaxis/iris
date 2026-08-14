# 拡張ツールの実装

IRISのソースコードからブロック図を出す道具と、
多次元配列を展開できる波形ツールを実装した報告である。

すべての測定は2026-08-14にこの機械で行った。
示す命令は実際に走らせたものであり、示す出力は実際に返ったものである。

---

## 1. 結果

**両方できた。**

| | 作ったもの | 置き場所 | 状態 |
|---|---|---|---|
| **A** | ブロック図ツール | `tools/schematic/` | **動く。描画を確認済み** |
| **B-1** | 波形出力の配列対応 | `sim/iris-sim`、`sim/iris-runtime` | **動く** |
| **B-2** | Surfer翻訳プラグイン | `tools/surfer-plugin/` | **動く** |

水準ごとの結果。

| 水準 | 内容 | 結果 |
|---|---|---|
| A-L0 | IRISを構文解析する | **動く。** 19本すべて |
| A-L1 | モジュールとポートを箱にする | **動く。** 32節点。描画も確認 |
| A-L2 | 書いてある辺を引く | **動く。** 12本 |
| A-L3 | `comb`と`sync`を辿った辺を引く | **動く。** 27本 |
| A-L4 | 掴んで動かす、保存、読み込み | **動く。** 階層の入れ子だけ未確認 |
| B-L1 | 階層が入れ子の`$scope`として出る | **動く** |
| B-L2 | 配列が波形に入る | **動く。** 1024要素 |
| B-L3 | Surferが配列を展開する | **動く。** 1024変数を読み込んだ |
| B-L4 | 翻訳プラグイン | **読み込まれ、呼ばれる。** 出力の表示は未確認 |

**そして着手前に見つかっていた不具合D-10を改修した。**
これが無ければ配列対応は成立しなかった。

---

## 2. 実装前に直した不具合 D-10

### 2.1 症状

VCDの識別子が94本で一周し、95本目が1本目と同じ符号を受け取る。
警告は出ない。

### 2.2 再現

101信号のテストベンチを`iris-sim`に通した。

```
$ iris-sim -i idoverflow.iris -o idov.vcd -c 5
Simulation completed successfully.

$ grep -cF '$var' idov.vcd
102
$ grep -F '$var' idov.vcd | awk '{print $4}' | LC_ALL=C sort -u | wc -l
94
$ grep -F '$var' idov.vcd | awk '$4=="!"{print $5}'
clk s92
```

**102本の信号に符号が94個しかない。`clk`と`s92`が`!`を共有していた。**

94という数はそのまま原因を指している。
`'!'`から`'~'`までがちょうど94個である。

### 2.3 原因

2箇所が1文字の符号しか使わず、使い切ると先頭へ戻していた。

`sim/iris-sim/src/fst/writer.rs`。

```rust
self.next_id = (self.next_id as u8 + 1) as char;
if self.next_id > '~' {
    self.next_id = '!';
}
```

`sim/iris-runtime/src/trace.rs`。

```rust
next_id = if next_id >= b'~' { b'!' } else { next_id + 1 };
```

### 2.4 なぜ今まで出なかったか

既存の設計が届いていなかった。

| ファイル | `$var`の数 |
|---|---|
| `example/riscv/sim/output_alu.vcd` | 91 |
| `example/riscv/sim/output_mem.vcd` | 91 |
| `example/async_fifo/sim/output.vcd` | 31 |

**上限まで3本である。**

### 2.5 直し方

VCDの識別子は文字の**列**であってよい。
94進の数として割り当てる関数を`iris-runtime`に置き、両方から呼ぶ。

```rust
pub fn vcd_ident(mut n: usize) -> String {
    const FIRST: u8 = b'!';
    const COUNT: usize = (b'~' - b'!' + 1) as usize; // 94
    let mut chars = Vec::new();
    loop {
        chars.push((FIRST + (n % COUNT) as u8) as char);
        if n < COUNT { break; }
        n = n / COUNT - 1;
    }
    chars.iter().rev().collect()
}
```

**94本目までは今までと同じ1文字を返す。**
上限に届いていなかったファイルの中身は変わらない。

### 2.6 検証

```
$ grep -cF '$var' idov_fixed.vcd
102
$ grep -F '$var' idov_fixed.vcd | awk '{print $4}' | LC_ALL=C sort -u | wc -l
102
$ grep -F '$var' idov_fixed.vcd | awk '$4=="!"{print $5}'
clk
```

**102本に102個。衝突0。**

既存の波形が変わっていないことを確かめた。

```
IDENTICAL  example/riscv/sim/output_alu.vcd
IDENTICAL  example/riscv/sim/output_mem.vcd
IDENTICAL  example/riscv/sim/output_sys.vcd
IDENTICAL  example/async_fifo/sim/output.vcd
```

**直したのか壊したのかを分けるために、この確認を入れた。**

試験を4本足した。
`sim/iris-runtime/src/trace.rs`にある。
20,000個まで衝突しないこと、すべて印字可能なこと、94本目までが今までと同じことを見る。

**6項目が揃ったのでD-10は閉じた。**

---

# 第I部 波形

## 3. 階層を入れ子にした（B-L1）

### 3.1 情報はすでに名前の中にあった

`SignalTrace`は信号名を平らな文字列で持つが、名前自体が階層を持っていた。

```
$var wire 5 7 dut.wr_ptr [4:0] $end
```

点で区切られた名前を木に組み替えるだけでよく、**記録側は変えていない。**

### 3.2 結果

`example/riscv`の波形はこうなった。

```
$ grep -E '\$scope|\$upscope' output_mem.vcd
$scope module TestMem $end
$scope module rom $end
$upscope $end
$scope module core $end
$scope module dec $end
$upscope $end
$scope module rf $end
$upscope $end
$scope module alu $end
$upscope $end
$upscope $end
$upscope $end
```

**設計の構造そのものである。**
`TestMem`の下に`rom`と`core`があり、`core`の下に`dec`と`rf`と`alu`がある。

Surferが読み、`dut`スコープを解決した。

```
$ surfer output.vcd -c 'scope_add AsyncFifoTB.dut'
INFO libsurfer: Loaded 19 variables in 13.782467ms
```

### 3.3 2つの書き出しを同じに保った

`iris-runtime`と`iris-sim`には別々のVCD書き出しがあり、
両者はバイト単位で同じ波形を出すことになっている。
試験がそれを見ている。

共通の関数を`iris-runtime`に置き、両方から呼ぶことで保った。

```
$ cargo test --release --test compiled
test result: ok. 28 passed; 0 failed
```

---

## 4. 配列を波形に入れた（B-L2）

### 4.1 既定では出さない

`riscv_core`の`dmem`は1024語である。
毎回出すと波形が10倍以上になる。

```
iris-sim --dump-arrays
```

### 4.2 結果

```
$ iris-sim -i test_mem.iris ... -o dump.vcd -c 200 --dump-arrays
$ grep -cF '$var' dump.vcd
1147
$ grep -F '$var' dump.vcd | awk '{print $4}' | LC_ALL=C sort -u | wc -l
1147
```

**1147本の信号に1147個の識別子。**
1024語の`dmem`と32語の`regs`が入っている。

**これがD-10を先に直した理由である。**
上限の12倍を超えており、直す前なら11回巻き戻って壊れた波形が出ていた。

構造。

```
$scope module dmem $end
$var wire 32 | 0 [31:0] $end
$var wire 32 } 1 [31:0] $end
$var wire 32 ~ 2 [31:0] $end
```

大きさは200,130バイトである。

### 4.3 要素の名前に角括弧を使えなかった

**設計では要素を`[0]`と名付けるつもりだった。**
前回の調査で、手で作ったVCDに対して`variable_add ....[3]`が通ったと報告していた。

**その報告は誤りだった。**

今回、命令が受理されたかどうかではなく、変数が見つかったかどうかを見た。

```
$ surfer dump.vcd -c 'variable_add TestMem.core.dmem.[3]'
ERROR libsurfer::wave_data: Failed to find variable: VariableRef {
    path: ScopeRef { strs: ["TestMem", "core", "dmem"] }, name: "[3]" }
```

**受理されるが、見つからない。**
前回は「エラーが出ないこと」を成功と読んでいた。
命令の構文が通ることと、変数が解決することは別である。

名前の付け方を5通り作って測った。

| 要素名 | 末尾に`[31:0]`を付けるか | `scope_add`が読み込んだ数 |
|---|---|---|
| `[2]` | 付ける | **0** |
| `[2]` | 付けない | **0** |
| `dmem[2]` | 付ける | **0** |
| `dmem[2]` | 付けない | **0** |
| `w2` | 付けない | **4** |
| `2` | 付けない | **4** |

**角括弧を含む名前は1つも読み込まれない。**
読む側が角括弧を添字の注記として扱い、名前として扱わないためである。

そこで要素名を`0`、`1`、`2`とした。

### 4.4 検証

```
scope_add TestMem.core.dmem                  => OK  Loaded 1024 variables
variable_add TestMem.core.dmem.3             => OK  Loaded 1 variables
variable_add TestMem.core.rf.regs.5          => OK  Loaded 1 variables
--- 対照（落ちなければならない） ---
variable_add TestMem.core.dmem.9999          => NOT FOUND
variable_add TestMem.core.nosuch.3           => NOT FOUND
```

**1024個の変数が読み込まれた。**

対照を2つ置いた。
存在しない添字と存在しないスコープが落ちる。
**落ちない検査は検査ではない。**
4.3節で誤った報告を出したのは、まさにその対照が無かったからである。

---

## 5. 翻訳プラグイン（B-L4）

### 5.1 Extismだった

Surfer 0.7.0の実体と原本から確かめた。
WITでもコンポーネントモデルでもない。

| 項目 | 値 |
|---|---|
| 機構 | Extism 1.21.0 |
| 型 | `surfer-translation-types` v0.7.0 |
| 読み込み | `libsurfer/src/translation/wasm_translator.rs` |

必須の関数は4つである。

```
name / translates / variable_info / translate
```

### 5.2 何をするか

IRISはVCDが運べない情報を持っている。
`bit[8]`は符号なし、`int[32]`は2の補数、1ビットの`bit`は真偽値である。

| IRISの型 | 翻訳前 | 翻訳後 |
|---|---|---|
| `bit[8]` | `11110000` | `240` |
| `int[32]` | `11110000` | `-16` |

**配列は翻訳しない。**
配列は4節で構造として出ており、Surferがスコープとして展開する。
**翻訳器は値の見せ方であり、ファイルに無い値を作れない。**

### 5.2.1 符号の情報はVCDの語彙で運んだ

**当初の実装は効いていなかった。**
`variable_type_name`から`int[32]`を読む作りにしていたが、
その欄はVHDLの型名から埋まるもので、VCDでは常に空である。

```
libsurfer/src/wellen.rs:765
variable_type_name: var.vhdl_type_name(&self.hierarchy).map(ToString::to_string),
```

VCDが持っている語彙で表すことにした。
`iris-sim`が符号付きの信号を`$var integer`として書く。

```
$var integer 32 ; s_rs1 [31:0] $end
$var wire    32 z dmem_rdata [31:0] $end
```

**これで負の値が負として出る。**

### 5.2.2 ただし表示しているのは組み込みである

プラグインは読み込まれ、Surferから呼ばれている。

```
WARN libsurfer::wave_data: More than one preferred translator for
     variable s_rs1 in scope TestMem.core: IRIS, Signed
```

**Surferがこれを出せるのは、プラグインの`translates`を呼んだからである。**

一方、画面の値はSurfer組み込みの`Signed`が作っている。
`$var integer`は組み込みも受け持ち、そちらが選ばれる。

判別のため、出力に印を付けた版を一時的に作って確かめた。
**印は画面に出なかった。**

| | 状態 |
|---|---|
| プラグインが読み込まれる | **確認済み** |
| Surferがプラグインを呼ぶ | **確認済み** |
| プラグインの出力が画面に出る | **未確認** |
| 符号付きが正しく出る | **確認済み。ただし組み込みによる** |

**VCDが運べる型情報は`wire`と`integer`の区別しか無く、そこは組み込みが覆っている。**
プラグインの値は、VCDが運べない情報をIRIS側から渡せるようになったときに出る。
現時点では、その口が用意してあるということ以上を主張しない。

### 5.3 組み立てと読み込み

```
$ cargo build --release --target wasm32-unknown-unknown --ignore-rust-version
    Finished `release` profile [optimized] target(s)
205517  iris_surfer_translator.wasm
```

`--ignore-rust-version`が要る。
Surferの型定義が依存する`ecolor`がrustc 1.92以上を求め、
この機械のrustcは1.91.1だからである。
**1.91.1で組み立てて動くことは確かめた。**

Surferに読ませた。

```
INFO libsurfer::translation::wasm_translator: Found .../iris_surfer_translator.wasm
INFO libsurfer: Translator IRIS loaded
```

**`Translator IRIS loaded`の`IRIS`は、このプラグインの`name()`が返した文字列である。**
Surferの原本がそう書いている。

```rust
info!("Translator {} loaded", t.name());
```

対照として壊れた`.wasm`を置いた。

```
ERROR libsurfer: Failed to load wasm translator Failed to load plugin from .../broken.wasm expected `(`
INFO  libsurfer: Translator IRIS loaded
```

**壊れたものは落ち、こちらは載る。**

試験が3本ある。2の補数、符号なし、`integer`を`int`と取り違えないこと。

```
test result: ok. 3 passed; 0 failed
```

### 5.4 Surferを複製していない

指示は「翻訳プラグインの導入」と限っていた。

| | ライセンス | 扱い |
|---|---|---|
| このプラグイン | MIT | リポジトリにある |
| `surfer-translation-types` | EUPL-1.2 | **git依存。複製しない** |
| Surfer本体 | EUPL-1.2 | **同梱しない** |

型定義はタグ`v0.7.0`に固定した。
Surferは版が食い違うと読み込みに失敗し、その旨を出す。

---

# 第II部 ブロック図

## 6. サーバの無いツール（調査A）

### 6.1 静的なファイル2つになった

```
$ npm run build
dist/index.html                    3.28 kB
dist/assets/index-DWd-RhsR.js  1,947.71 kB │ gzip: 587.59 kB
```

| 探した文字列 | 束ねた結果に何件 |
|---|---|
| `require(` | 0 |
| `process.env` | 0 |
| `__dirname` | 0 |
| `node:fs` | 0 |
| 外部URL | 0 |

**サーバもDockerも外部の実行ファイルも要らない。**
手本がバックエンドを持つ理由はVeribleが C++ の実行ファイルだからであり、
IRISの構文解析器はすでにTypeScriptである。

### 6.2 描いたもの

`example/`と`tools/conformance/fixtures/`の19本を通した。

| 対象 | 節点 | inst | io | reg | 書いてある辺 | 辿った辺 |
|---|---|---|---|---|---|---|
| `RiscvCore` | 16 | 3 | 9 | 4 | 4 | **20** |
| `AsyncFifoTB` | 4 | 1 | 0 | 3 | 0 | 3 |
| `TestAddi` | 3 | 2 | 0 | 1 | 2 | 1 |
| `TestAlu` | 3 | 2 | 0 | 1 | 2 | 1 |
| `TestMem` | 3 | 2 | 0 | 1 | 2 | 1 |
| `TestSys` | 3 | 2 | 0 | 1 | 2 | 1 |
| **合計** | **32** | **12** | **9** | **11** | **12** | **27** |

**`RiscvCore`の24本のうち20本は、`comb`と`sync`を辿らないと出ない。**
書いてある辺だけを描くと、図の6分の1しか出ない。

そのため状態表示に両方の数を出している。
図が何を根拠に描かれたかを、読む者が確かめられるようにするためである。

### 6.3 3つの罠を避けた

試作の段階で、素朴に書いた実装が3回、間違った図を出した。

| | 罠 | 何が起きるか | 直し方 |
|---|---|---|---|
| 1 | `load_byte.sign_extend[32]()`が`alu.y`と同じ`FieldExpr`に見える | 実在しないインスタンスの箱が出る | インスタンス名の集合で区別する |
| 2 | `comb`を辿るとレジスタを1段またぐ | 同じサイクルで値が届くという嘘になる | `sync`の代入先で止める |
| 3 | 自己ループが出る | 構造について何も言わない線が出る | 同上 |

3つとも試験にした。

```
$ npm test
✓ src/diagram/layout.test.ts (2 tests)
✓ src/model/build.test.ts (11 tests)
Test Files  2 passed (2)
      Tests  13 passed (13)
```

**レジスタを箱として描くことにしたのは、罠2の帰結である。**
状態を溶かさずに残せば、またぐ線が引けない。

### 6.4 配置

手本と同じELKを使う。
境界端子は層の制約で左端と右端に固定した。
試作では`clk`が画面の中ほどに置かれていた。

### 6.5 実際に描かせて直したもの

**ここまでの検証はモデルの試験と組み立ての成功までだった。**
ヘッドレスのChromeで実際に描画させたところ、3つの問題が出た。

| | 症状 | 直し方 |
|---|---|---|
| 1 | `we, waddr, wdata, raddr1, raddr2`が箱に重なった | 先頭3つと残りの数にした（`we, waddr, wdata +2`） |
| 2 | 線の付かないレジスタが浮いていた | 描かないことにした |
| 3 | 図が左上に寄り、下半分が空いた | 描画の完了を待ってから収めるようにした |

2番目は`TestMem`の`done`、`cycles`、`fails`である。
状態ではあるが、インスタンスにも境界にも繋がらない。
**箱にすると場所だけ取り、接続について何も言わない。**

3番目は`async`の紙に対して描画前に`fit`を呼んでいたためである。
**中身が無いうちに大きさを測っていた。**

この3件で節点が48から32へ減った。
**辺の数は39のまま変わらない。**
辺の付かない節点を消したので、当然そうなる。

試験を4本足した（合計13本）。

**モデルの試験と組み立ての成功だけでは、これらは1つも出なかった。**
**描かせて見るまで、図が読めるかどうかは分からない。**

---

# 第III部 全体

## 7. 壊していないこと

| 項目 | 結果 |
|---|---|
| `tools/conformance/run.sh` | **pass 130 fail 0** |
| `iris-sim`の試験 | **147 passed, 0 failed** |
| `iris-runtime`の試験 | **25 passed, 0 failed** |
| 解釈実行と compile 実行の一致 | **28 passed, 0 failed** |
| RV32I | **40 / 40** |
| `async_fifo` | **PASS** |
| 既存のVCD（D-10改修後） | **4本ともバイト単位で同一** |

## 8. 加えたもの

| 場所 | 内容 |
|---|---|
| `sim/iris-runtime/src/trace.rs` | 識別子の割り当て、入れ子スコープ、符号付きの`$var integer`、試験4本 |
| `sim/iris-sim/src/fst/writer.rs` | 同じ割り当てとスコープを使う |
| `sim/iris-sim/src/sim/hierarchy.rs` | 配列の記録 |
| `sim/iris-sim/src/main.rs` | `--dump-arrays` |
| `tools/schematic/` | ブロック図ツール |
| `tools/surfer-plugin/` | 翻訳プラグイン |
| `doc/schematic.md` と `_en` | ブロック図の資料。図つき |
| `doc/surfer_plugin.md` と `_en` | 波形とプラグインの資料。図つき |
| `doc/images/` | スクリーンショット4点 |
| `README.md` と `README_en.md` | 2つの道具の節を追加 |
| `report_schematic.md` | この報告書 |

`example/`の波形は作り直したが、`.vcd`は`.gitignore`にあるため記録は変わらない。

## 9. 確かめていないこと

**書き漏らしではなく、確かめていないものとして挙げる。**

| | 何を | なぜ |
|---|---|---|
| A-L4の階層 | インスタンスを持つインスタンスの入れ子表示 | **そういう設計がリポジトリに1つも無い** |
| 翻訳の見た目 | 翻訳後の値が画面にどう出るか | Surferの画面を自動で撮る手段が無い。関数の試験までとした |
| U-8 | ブラウザの中にWASM版Surferを埋め込めるか | 今回の範囲外 |
| `sv2iris` | jpegencの13本が変換できない | 前回記録した。指示の対象ではない |

**A-L4の階層について。**
IRISのASTには`InterfaceDef`と`ViewDef`があり、対応物は存在する。
コードは書いたが、試す題材が無い。
**対応があることを理由に、動くとは書かない。**

## 10. 前回の報告の訂正

前回`report_schematic.md`は調査結果だった。
そのうち1点が誤っていた。

**「手で作ったVCDで`variable_add ....[3]`が通った」と書いていた。**

今回、変数が解決したかどうかまで見たところ、通っていなかった。
命令が受理されることと、変数が見つかることを取り違えていた。

原因は対照を置かなかったことである。
存在しない添字を与えても同じ「成功」に見えていた。

**4.3節で名前の付け方を5通り測り直し、角括弧が使えないことを確かめて直した。**
実装は`0`、`1`、`2`という名前で出しており、1024要素が実際に読み込まれる。

前回の報告で`memory_viewer_open`が配布物に無いことを見つけられたのは、
でたらめな命令名との対照を置いたからだった。
**同じ用心を配列の側にも置いていれば、この誤りは前回の時点で出ていた。**

## 11. 使い方

### ブロック図

```
cd tools/schematic
npm install
npm run dev            # http://localhost:5173
```

`.iris`を選ぶ。
組み立てて静的に配る場合は`npm run build`で`dist/`に出る。

### 波形の配列

```
iris-sim -i design.iris -o out.vcd --dump-arrays
surfer out.vcd
```

Surferで`scope_add <top>.<path>.<mem>`を実行すると要素が並ぶ。

### 翻訳プラグイン

```
cd tools/surfer-plugin
cargo build --release --target wasm32-unknown-unknown --ignore-rust-version
cp target/wasm32-unknown-unknown/release/iris_surfer_translator.wasm \
   ~/.local/share/surfer/translators/
```

Surferを起動すると`Translator IRIS loaded`が出る。

## 12. 測定に使った環境

| 道具 | 版 |
|---|---|
| `node` | v24.14.0 |
| `npm` | 11.9.0 |
| `cargo` / `rustc` | 1.91.1 |
| `surfer` | 0.7.0 |
| `elkjs` | 0.11.1 |
| `@joint/core` | 4.x |
| `extism-pdk` | 1.4 |
| `surfer-translation-types` | v0.7.0（git、タグ固定） |
