# IRIS標準ライブラリ

## この資料が扱うもの

IRISで書いた、再利用できるRTLの論理モジュール群である。
FIFOやカウンタや調停器を毎回書き直さずに、部品として取り込む。
部品の本体・テストベンチ・詳しい説明は`lib/`にある。
この資料は全体像と、書けたもの／書けなかったものの線引きを示す。

一覧と各部品のパラメータは[`lib/README.md`](../lib/README.md)にある。

## 置き場所

分類ごとにディレクトリを分ける。
現在74部品を10分類に置く。

| 分類 | 部品数 | 主な部品 |
|---|---|---|
| `timing/` | 11 | Counter、EdgeDetect、GrayCounter、Lfsr、ClkDivider、Pwm、Debounce、Timer、OneShot、Watchdog、JohnsonCounter |
| `arith/` | 17 | PriorityEncoder、Lzc、Bin2Gray、Decoder、Rotator、Gray2Bin、MinMax、DivSerial、MulSerial、SatAdd、SatSub、OneHotCheck、Abs、Accumulator、PopcountSerial、Comparator、Bin2Bcd |
| `mem/` | 8 | FifoSync、FifoAsync、RamSp、RamDp、Ram2r1w、ShiftRegister、RingBuffer、Lifo |
| `arbiter/` | 2 | ArbiterFixed、ArbiterRr |
| `stream/` | 12 | SpillRegister、Serializer、Deserializer、VecMux、VecDemux、StreamDownsizer、StreamUpsizer、StreamFork、StreamJoin、StreamFilter、CreditCounter、StreamArbiter |
| `cdc/` | 4 | Sync2ff、RstSync、PulseSync、HandshakeSync |
| `coding/` | 7 | Crc、Parity、Secded、TmrVoter、Checksum、Scrambler、Descrambler |
| `periph/` | 4 | UartTx、UartRx、SpiMaster、I2cMaster |
| `dsp/` | 5 | FirSerial、MacSerial、MovingAverage、Nco、ComplexMult |
| `util/` | 4 | BitReverse、EndianSwap、ByteEnableExpand、RangeMask |

1部品は3点で構成する。
実装（`<分類>/<name>.iris`）、試験（`<分類>/<name>_tb.iris`）、資料（`lib/README.md`）である。

## 規約

モジュール名はPascalCase、ポートと信号はsnake_case、パラメータはPascalCase（`Width`／`Depth`）とする。
リセットは非同期assert・同期deassert、能動Highを既定とし、リセット値は宣言の初期値で表す。
ストリーム部品ではvalidをready非依存で下げない。
パラメータは`Width`／`Depth`／`Taps`等に統一し、既定値を与える。

## 検証

1部品ごとに次の3つを通す。

```bash
iris sim  -i <分類>/<name>.iris <分類>/<name>_tb.iris -c <cycles>
iris sv      <分類>/<name>.iris -o out/
iris lint    <分類>/<name>.iris
```

全部品のテストベンチ（振る舞い＝assert）は`bash tools/lib_test.sh`で一括実行できる
（conformanceは変換・往復・verilatorを守り、これはassertの回帰を捕まえる。現在74/0）。

74部品すべてのテストベンチが`iris-sim`で通る。
`tools/conformance/run.sh`は584/0を保つ（lib部品70個を検体に登録）。
SystemVerilogへ変換した部品はverilatorがexit 0で受ける
（無型リテラルやパラメータがSVで32ビットになることに由来する幅警告は出るが、値は正しい）。

## 書けたもの／書けなかったもの

**この線引きが、この資料の要点である。**

IRISで素直に書けるのは次の3種である。

| 種類 | 例 | なぜ書けるか |
|---|---|---|
| 単一クロックの論理 | Counter、FifoSync、ArbiterRr | comb／syncとmemで素直に表せる |
| FSM＋シフトレジスタ | UartTx／Rx、SpiMaster、I2cMaster | 状態機械とシフトで周辺IFを組める |
| 直列にして時間へ展開する積算 | Crc、Lfsr、FirSerial、MacSerial | syncの逐次加算で畳み込みを時間に展開できる |
| 直列に展開した総和の畳み込み | PopcountSerial | combの畳み込み不可を直列（Widthサイクル）で回避 |
| 符号付き演算 | MacSerial[Signed: 1]、ComplexMult | `.signed()`＋`.sign_extend[N]()`で2の補数のまま積算。結果は`acc.signed()`で読む |
| XORの畳み込み | Parity、Gray2Bin、Secded | `.xor_reduce()`と部分ビット代入（`out[i]=...`はビットごとに積む）で書ける |
| 多ストリームのmux／demux（パックドベクタ） | VecMux、VecDemux | 要素を連結した`bit[Width*N]`と部分選択`[i*Width +: Width]`で表せる（添字は幅拡張してから掛ける） |
| 語彙変換（ビット/バイト順、マスク展開） | BitReverse、EndianSwap、ByteEnableExpand | `for`と部分ビット代入/部分選択で1要素ずつ埋める |
| ジェネリック関数（幅に依らない関数） | `fn max2[W](a,b)` | 呼び出し位置でインライン展開。本体が幅の数値を要しなければ任意幅で可 |

書けなかったものは、理由とともに残す。

| 書けないもの | 理由 |
|---|---|
| combでの総和の畳み込み（popcount、並列CRCのXOR網） | combで`var`が使えず、まるごとの再代入はlast-winsで逐次和にならない（XOR畳み込みは`.xor_reduce()`で可。**直列にすれば書ける**＝`PopcountSerial`） |
| `bit[W][N]`をsignal/portに使う配列型 | 非対応。使うと明示エラー`O1009`（配列信号はビットに平坦化され`d[i]`が要素でなくビットを指す誤りを防ぐ）。多ストリームmux/demuxはパックドベクタで可（上表）。`mem`は`bit[W][Depth]`可 |
| ジェネリック関数で本体が幅の数値を要するもの | `fn f[W]`自体は書ける（インライン）。ただし本体で`W`を数値として使うと展開後に未解決になる |
| 可変段数の同期化器 | var配列が生成境界に定数を要するため2段固定 |

符号付きの`==`／`!=`が値で比較するよう、iris-simを修正した（負のリテラルと比較できる。仕様9.3.1）。

直列にできるもの・FSMで書けるもの・パックドベクタで表せるものはIRISで書き、
combの総和畳み込みの限界に当たるもの・実証が要る重いものはOSSを流用する。
重いIP（AXI・暗号・浮動小数点演算器・大型DSP）の流用先は[`lib/README.md`](../lib/README.md)に残す。

## テクノロジ依存のセルは表さない

`clk_gate`や`tc_sram`やlevel_shifterのようなPDK実装に紐づくセルは、
IRISの合成可能な論理としては表さない。
SystemVerilogのレジスタマクロ（`FF`等）の対応物も作らない。`sync`と`var`で足りる。
これらが要る場合は、各PDKの実装や実在ライブラリを使う。
