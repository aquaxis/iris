# IRIS標準ライブラリ

## この資料が扱うもの

IRISで書いた、再利用できるRTLの論理モジュール群である。
FIFOやカウンタや調停器を毎回書き直さずに、部品として取り込む。
部品の本体・テストベンチ・詳しい説明は`lib/`にある。
この資料は全体像と、書けたもの／書けなかったものの線引きを示す。

一覧と各部品のパラメータは[`lib/README.md`](../lib/README.md)にある。

## 置き場所

分類ごとにディレクトリを分ける。
現在56部品を10分類に置く。

| 分類 | 部品数 | 主な部品 |
|---|---|---|
| `timing/` | 9 | Counter、EdgeDetect、GrayCounter、Lfsr、ClkDivider、Pwm、Debounce、Timer、OneShot |
| `arith/` | 12 | PriorityEncoder、Lzc、Bin2Gray、Decoder、Rotator、Gray2Bin、MinMax、DivSerial、MulSerial、SatAdd、SatSub、OneHotCheck |
| `mem/` | 6 | FifoSync、FifoAsync、RamSp、RamDp、Ram2r1w、ShiftRegister |
| `arbiter/` | 2 | ArbiterFixed、ArbiterRr |
| `stream/` | 9 | SpillRegister、Serializer、Deserializer、VecMux、VecDemux、StreamDownsizer、StreamUpsizer、StreamFork、StreamJoin |
| `cdc/` | 3 | Sync2ff、RstSync、PulseSync |
| `coding/` | 5 | Crc、Parity、Secded、TmrVoter、Checksum |
| `periph/` | 4 | UartTx、UartRx、SpiMaster、I2cMaster |
| `dsp/` | 3 | FirSerial、MacSerial、MovingAverage |
| `util/` | 3 | BitReverse、EndianSwap、ByteEnableExpand |

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

56部品すべてのテストベンチが`iris-sim`で通る。
`tools/conformance/run.sh`は470/0を保つ（lib部品52個を検体に登録）。
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
| 符号付き演算 | MacSerial[Signed: 1] | `.signed()`＋`.sign_extend[N]()`で2の補数のまま積算。結果は`acc.signed()`で読む |
| XORの畳み込み | Parity、Gray2Bin、Secded | `.xor_reduce()`と部分ビット代入（`out[i]=...`はビットごとに積む）で書ける |
| 多ストリームのmux／demux（パックドベクタ） | VecMux、VecDemux | 要素を連結した`bit[Width*N]`と部分選択`[i*Width +: Width]`で表せる（添字は幅拡張してから掛ける） |
| 語彙変換（ビット/バイト順、マスク展開） | BitReverse、EndianSwap、ByteEnableExpand | `for`と部分ビット代入/部分選択で1要素ずつ埋める |

書けなかったものは、理由とともに残す。

| 書けないもの | 理由 |
|---|---|
| combの総和の畳み込み（popcount、並列CRCのXOR網） | combで`var`が使えず、まるごとの再代入はlast-winsで逐次和にならない（XOR畳み込みは`.xor_reduce()`で可） |
| `bit[W][N]`という構文の配列ポート・var配列 | 配列の生成境界に定数が要る（`mem`だけがジェネリックを許す）。多ストリームのmux／demux自体はパックドベクタで書ける（上表） |
| ジェネリック関数（汎用math関数） | `fn f[Width](...)`がパースできない。固定幅の`fn`は動く |
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
