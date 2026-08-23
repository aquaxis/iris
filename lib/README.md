# IRIS標準ライブラリ

IRISで書いた、再利用できるRTLの論理モジュール群である。
FIFOやカウンタや調停器を毎回書き直さずに、部品として取り込む。

## 置き場所

分類ごとにディレクトリを分ける。

| ディレクトリ | 分類 |
|---|---|
| `arith/` | 算術・演算 |
| `mem/` | 記憶・バッファ |
| `stream/` | ストリーム・フロー制御 |
| `arbiter/` | 調停 |
| `cdc/` | CDC・リセット・クロック |
| `timing/` | カウンタ・タイミング制御 |
| `coding/` | 誤り検出・符号化 |
| `periph/` | 周辺インタフェース |
| `dsp/` | DSP・信号処理 |
| `util/` | ユーティリティ（関数） |

1部品は3点で構成する。

| 要素 | 置き場所 | 役目 |
|---|---|---|
| 実装 | `<分類>/<name>.iris` | 部品本体。ジェネリックでパラメタライズ |
| 試験 | `<分類>/<name>_tb.iris` | 振る舞いを`iris-sim`で確かめる`test`モジュール |
| 資料 | この`README.md` | 用途・パラメータ・注意点 |

## 規約

| 規約 | 決め方 |
|---|---|
| 命名 | モジュールはPascalCase、ポート・信号はsnake_case、パラメータはPascalCase（`Width`／`Depth`） |
| リセット | 非同期assert・同期deassert、能動High既定。`sync(clk.posedge, rst.async)`、リセット値は宣言の初期値 |
| ready/valid | validはready非依存で下げない（ストリーム部品で守る） |
| パラメータ | `Width`／`Depth`／`Stages`等に統一し、既定値を与える |
| 検証 | `assert`／`cover`と`iris-sim`／`iris sv`で確かめる。外部SDC／lintができない点は明記する |

## 使い方

部品を設計に取り込み、必要ならジェネリックで幅などを変える。

```
// 既定（Width=8）で使う
inst c8 = Counter { clk: clk, rst: rst, en: en };

// ジェネリックを上書きする
inst c4 = Counter[Width: 4, Saturate: 1] { clk: clk, rst: rst, en: en };
```

## 検証

1部品ごとに次を通す。

```
iris sim  -i <分類>/<name>.iris <分類>/<name>_tb.iris -c <cycles>
iris sv      <分類>/<name>.iris -o out/          # SystemVerilogへ変換できること
iris lint    <分類>/<name>.iris                  # 命名規約に沿うこと
```

## 部品一覧

### timing

| 部品 | 機能 | パラメータ |
|---|---|---|
| `Counter` | 汎用カウンタ | `Width`（幅、既定8）、`Down`（0=加算/1=減算、既定0）、`Saturate`（0=ラップ/1=飽和、既定0） |
| `EdgeDetect` | 立上り・立下り検出（1サイクル幅のパルス） | なし（1ビット） |
| `GrayCounter` | GRAY符号カウンタ（隣接値が1ビット差） | `Width`（既定8、1以上） |
| `Lfsr` | 線形帰還シフトレジスタ（Galois形、疑似乱数/PRBS） | `Width`（既定8、2以上）。多項式`poly`は入力ポート |
| `ClkDivider` | 整数分周（Divサイクルごとに1サイクル幅のtick） | `Div`（既定2、2以上）、`CountWidth`（導出） |

`ClkDivider`はクロックをゲーティングせず、クロックイネーブル（tick）を出す合成向きの方式。

`Counter`はラップを幅の自然なあふれに任せ、飽和は上限（全ビット1）と下限（0）で値を保つ。
上限の判定は`count + 1 == 0`で行う（全ビット1に1を足すとWidthビットで0へ戻る）。

`EdgeDetect`は前サイクルの値をレジスタに保ち、`rise = d & ~prev`、`fall = ~d & prev`で出す。

### arith

| 部品 | 機能 | パラメータ |
|---|---|---|
| `PriorityEncoder` | 立っている最下位ビットの添字と有効フラグ | `Width`（既定8、2以上）、`IdxWidth`（既定`$clog2(Width)`） |
| `Lzc` | 先頭ゼロ数（最上位から最初の1までの0の個数） | `Width`（既定8、1以上）、`CountWidth`（既定`$clog2(Width)+1`） |
| `Bin2Gray` | 2進 → GRAY符号（`bin ^ (bin >> 1)`） | `Width`（既定8、1以上） |

どちらも組み合わせで、`for`ループと「combの後の代入が優先される（last-wins）」性質を使う。
`PriorityEncoder`は高い添字から回して最下位の1を残す。
`Lzc`は低い添字から回して最上位の1を残し、`Width - 1 - i`を先頭ゼロ数とする。

### mem

| 部品 | 機能 | パラメータ |
|---|---|---|
| `FifoSync` | 単一クロックの同期FIFO（先入れ先出し） | `Width`（既定8）、`Depth`（既定4、2のべき乗）、`AddrWidth`／`PtrWidth`（Depthから導出） |
| `FifoAsync` | 2クロックドメインの非同期FIFO（GRAY符号ポインタ同期） | `DataWidth`（既定8）、`Depth`（既定16、4以上の2のべき乗）、`AddrWidth`／`PtrWidth`（導出） |

`FifoSync`は`mem`とラップビット付きポインタで実装する。
`empty`はポインタ一致、`full`はラップビットが異なり下位アドレスが等しいこと。

`FifoAsync`はGRAY符号のポインタを2段で同期させ、メタステーブルが伝わらないようにする
（`example/async_fifo`の設計を部品化）。**リセットは能動Low（`wr_rst_n`／`rd_rst_n`）**で、
本ライブラリの既定（能動High）とは異なる。非同期FIFOの定番に合わせた例外である。
配置制約（最大遅延SDC）はIRISから出せないので利用者の責任。

### arbiter

| 部品 | 機能 | パラメータ |
|---|---|---|
| `ArbiterFixed` | 固定優先度アービタ（最下位の要求にone-hotのgrant） | `N`（要求数、既定4、2以上） |
| `ArbiterRr` | ラウンドロビンアービタ（公平な巡回、`update`で次へ） | `N`（要求数、既定4、2以上） |

`ArbiterFixed`は2の補数の性質（`req & (~req + 1)`）で最下位の1を分離する。ループ不要。
`ArbiterRr`は優先マスク（直前のgrantより上の添字）で巡回する。
`mask = ~(grant | (grant - 1))`とし、最上位を選ぶとmaskが0になって最下位へ回り込む
（全ビット1のリテラルを使わずに巡回を実現する）。

### stream

| 部品 | 機能 | パラメータ |
|---|---|---|
| `SpillRegister` | ready/validの深さ2バッファ（スキッドバッファ） | `Width`（既定8、1以上） |

`SpillRegister`は上流と下流のパスを切り、バックプレッシャでデータを落とさず、
詰まっていなければ毎サイクル1語を通す。`in_ready`はスキッド段の空きだけで決まる
（`out_ready`から組み合わせで作らない）。

### cdc

| 部品 | 機能 | パラメータ |
|---|---|---|
| `Sync2ff` | 2段FF同期化器 | `Width`（既定1、1以上） |
| `RstSync` | リセット同期化器（非同期assert・同期deassert） | なし |
| `PulseSync` | パルスのクロック跨ぎ（トグル＋2段同期＋エッジ検出） | なし（2クロック） |

`PulseSync`はレベルでなくトグルを渡すので、パルスが同期段で消えない。
送信パルスの間隔は同期の遅れ（受信側で数サイクル）より広いこと。

`Sync2ff`は別ドメインの信号を2段のFFで受ける。`RstSync`はリセット解除だけを2段で
同期させる（assertは即時）。段数はどちらも定番の2段に固定する。

**CDC部品は論理だけを与える。** 物理的な同期化に要る配置制約（`ASYNC_REG`／
`dont_touch`、最大遅延のSDC）はIRISからは出せない。制約の付与は利用者の責任である。
可変段数はvar配列が生成境界に定数を要するため現状のIRISでは書けない（2段に固定）。

### coding

| 部品 | 機能 | パラメータ |
|---|---|---|
| `Crc` | CRC（巡回冗長検査、ビット直列） | `Width`（既定8、2以上）。多項式`poly`は入力ポート |

`Crc`はMSB先頭で1サイクルに1ビット取り込み、`poly`で更新する（LFSRにデータ入力を足した形）。
`clear`で区切れる。並列CRC（1バイト同時）はXORの畳み込みが要り、現状のcombでは書けない。

### periph

| 部品 | 機能 | パラメータ |
|---|---|---|
| `UartTx` | UART送信器（スタート0・LSB先頭8ビット・ストップ1） | `ClksPerBit`（ボー分周、既定4、2以上） |
| `UartRx` | UART受信器（立下り検出＋ビット中央で標本化） | `ClksPerBit`（既定4、2以上） |
| `SpiMaster` | SPIマスタ（モード0、MSB先頭、全二重） | `Width`（既定8）、`ClkDiv`（sclk半周期のクロック数、既定2） |
| `I2cMaster` | I2Cマスタ（1バイト書き：START＋8ビット＋ACK＋STOP） | `ClkDiv`（四半分あたりのクロック数、既定2） |

`UartTx`／`UartRx`はFSM＋シフトレジスタ＋ビット時間カウンタで書ける（段L3の第一候補）。
TX→RXのループバックで、送ったバイトがそのまま受信されることを確認している。
ボーレートは`clk / ClksPerBit`。`ClksPerBit`を大きくすれば実際のボーレートに合わせられる。

`SpiMaster`はsclkを内部で分周し、立上りでMISOを標本化・立下りでMOSIを更新する（モード0）。
MISOをMOSIに折り返すと受信＝送信になることを確認している（全二重）。
sclk周期は`2 * ClkDiv`クロック。cs_nは能動Low。

`I2cMaster`は1バイト書き込み（START＋8ビット＋ACK＋STOP）を行う。
SDAはオープンドレインなので出力イネーブル`sda_oe`（1で0駆動、0で開放）と入力`sda_i`で表す。
1ビットを4つの四半分に分け、STARTはSCL高でSDAを1→0、STOPはSCL高でSDAを0→1で作る。
リピーテッドSTART・読み出し・複数バイト・クロックストレッチ・アービトレーションは含まない
（本格版はOSSを参照）。

### dsp

| 部品 | 機能 | パラメータ |
|---|---|---|
| `FirSerial` | 直列（時分割）FIRフィルタ（1乗算器を時分割、1サンプルにTapsサイクル） | `Width`（既定8）、`Taps`（既定4、2以上）、`CoeffWidth`（既定8）、`AccWidth`／`IdxWidth`／`CntWidth`（導出） |

`FirSerial`は`y[n] = Σ coeff[k]*x[n-k]`を、1つの乗算器を時分割で使って求める。
係数は書き込みポートで読み込み、サンプルは`in_valid`で1つずつ入れ、`out_valid`で結果を出す。
**combでは畳み込み（積算）を書けないが、直列にして時間へ展開すればsyncの逐次加算で書ける**
（段L3の方針「直列にできるものはIRIS」の実例）。
乗算はオペランド幅に切り詰められるので、係数とサンプルは`AccWidth`幅のmemに零拡張して持ち、
積が切り詰められないようにする。数は符号なし（符号付きFIRはint型が要る。今後の課題）。

## 実装上の注意

**IRISのcombでは`var`を使えない。** `var`はsync／fsm専用である。
またcombでの信号の再代入は「後の代入が優先される（last-wins）」であって、
`x = x + d[i]`のような**逐次的な積算にはならない**（各代入はブロック入口の値を読む）。
このため**選択（最初/最後の1を選ぶ）は書けるが、総和や畳み込み（popcount、gray2bin等）は
組み合わせでは書けない**。`popcount`（総和）や`gray2bin`（上位からのXOR畳み込み）のように
積算を要する部品は、現状のIRISのcombでは表せない（今後の課題）。
`bin2gray`は1回のXОRなので書ける（逆変換のgray2binは畳み込みが要るので保留）。
同じ理由で、**パリティ生成やSECDEDのパリティ計算（ビット部分集合のXOR＝畳み込み）も
combでは書けない**。CRCは直列（毎サイクル1ビット）にすれば書ける（積算を時間に展開する）。

**配列型のポート・var（生成境界に定数以外を使うもの）は書けない。**
`in d: bit[Width][N]`や`var a: bit[W][N]`は「expected integer」で拒否される
（`mem`だけは生成境界にジェネリックを許す）。このため**N本のストリームを束ねるmux／demux
のような部品は、汎用の配列ポートでは書けない**（個別ポートやinterfaceが要る。今後の課題）。

**`iris2sv`は`for`ループに対応した。** 定数境界の`for`は、合成可能なSystemVerilogの
`for`（`always_comb`／`always_ff`内）へ変換する。これにより上記の`for`ベースの部品も
SystemVerilogへ出せる。

**関数（`fn`）は固定幅なら使えるが、ジェネリック関数はパースできない。**
`fn f(a: bit[8]) -> bit[8] { ... }`は動きSVの`function`にもなるが、
`fn f[Width](a: bit[Width])`は書けない。幅・パラメータの計算は組込み（`$clog2`等）を使う。
このため再利用できる汎用のmath関数ライブラリは現状は限定的で、今は置いていない。

**`iris2sv`はブロック内の`let`（局所束縛）を未対応。** sync／combの中で`let x = 式;`を
使うとSVへ変換できない（幅推論が要るため）。当面は式をインライン展開して書く
（`SpillRegister`は発火条件をインラインにしている）。将来のiris2svの課題。

**乗算`*`はオペランド幅に切り詰められる。** `bit[8] * bit[8]`は16ビットではなく8ビットに
なる（`200*200`が40000でなく下位8ビットの64になる）。全幅の積が要るときは、オペランドを
先に広い幅へ零拡張する。式中の`as`キャストはcomb／syncの位置ではパースできない
（`let x: bit[16] = a as bit[16];`の形は通るが、iris2svはブロック内letが未対応）。
そこで`FirSerial`は、係数とサンプルを`AccWidth`幅のmemに代入で持たせて零拡張し（代入は零拡張する）、
広い幅どうしを掛けて積の切り詰めを避ける。並列の畳み込み（総和）はcombでは書けないので、
`FirSerial`は直列にしてsyncで1タップずつ積算する。

**一部のSVでverilatorが幅の警告を出すが、いずれも値は正しい（警告でエラーではない）。**
`Lzc`は全ゼロ入力の既定（`count = Width`）で幅切り詰めの警告（`Width`はSVで32ビット
パラメータだが値は出力幅に収まる）。
`ArbiterFixed`／`ArbiterRr`は`~x + 1`の無型リテラル`1`がSVで32ビットに広がるため幅拡張の警告
（`&`で元の幅に戻るので挙動は正しい）。
`ClkDivider`／`UartTx`／`UartRx`／`SpiMaster`／`I2cMaster`は`count == Div - 1`等でパラメータが32ビットの
ため幅の警告（比較は正しい）。
これらはIRISの無型リテラルやパラメータがSVで32ビットになることに由来する。

## Tier 3（重いIP）の方針

重い層（DMA・暗号・DSP・周辺IF・オンチップバス）は、全部をIRISで書かない。

- **IRISで書ける（必要時に追加）**：`uart`／`spi`／`i2c`（FSM＋シフト）、
  直列/シストリック`fir`（syncで積算）、簡易`cache`（mem＋タグ＋FSM）。
- **OSSを流用する**：AXI一式（pulp-platform/axi）、暗号（OpenTitan prim_*）、
  浮動小数点演算器（hardfloat／FPnew）、大型DSP。実証済みのものを再実装しない。

判断基準は、IRISのcombの限界（XOR畳み込み/積算不可）と配列ポート不可。
直列にできるもの・FSMで書けるものはIRIS、重い/実証が要る/限界に当たるものはOSS。

## IRISで表さないもの

テクノロジ依存のセル（`clk_gate`、`tc_sram`、level_shifter等）はPDK実装に紐づくので、
IRISの合成可能な論理としては表さない。
SystemVerilogのレジスタマクロ（`FF`等）は対応物を作らない。`sync`と`var`で足りる。
これらが要る場合は、各PDKの実装や実在ライブラリ（`instructions.md`のB節）を使う。
