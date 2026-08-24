# IRIS標準ライブラリ

IRISで書いた、再利用できるRTLの論理モジュール群である。
FIFOやカウンタや調停器を毎回書き直さずに、部品として取り込む。

## 全体像

現在66部品を10分類に置く。各部品は`iris-sim`のテストベンチ・`iris sv`（SystemVerilog変換）・
`iris lint`（命名規約）の3つを通し、`tools/conformance/run.sh`は530/0を保つ（lib部品62個を検体に登録）。

| 分類 | 部品数 | 部品 |
|---|---|---|
| `timing/` | 10 | `Counter`／`EdgeDetect`／`GrayCounter`／`Lfsr`／`ClkDivider`／`Pwm`／`Debounce`／`Timer`／`OneShot`／`Watchdog` |
| `arith/` | 15 | `PriorityEncoder`／`Lzc`／`Bin2Gray`／`Decoder`／`Rotator`／`Gray2Bin`／`MinMax`／`DivSerial`／`MulSerial`／`SatAdd`／`SatSub`／`OneHotCheck`／`Abs`／`Accumulator`／`PopcountSerial` |
| `mem/` | 7 | `FifoSync`／`FifoAsync`／`RamSp`／`RamDp`／`Ram2r1w`／`ShiftRegister`／`RingBuffer` |
| `arbiter/` | 2 | `ArbiterFixed`／`ArbiterRr` |
| `stream/` | 11 | `SpillRegister`／`Serializer`／`Deserializer`／`VecMux`／`VecDemux`／`StreamDownsizer`／`StreamUpsizer`／`StreamFork`／`StreamJoin`／`StreamFilter`／`CreditCounter` |
| `cdc/` | 4 | `Sync2ff`／`RstSync`／`PulseSync`／`HandshakeSync` |
| `coding/` | 7 | `Crc`／`Parity`／`Secded`／`TmrVoter`／`Checksum`／`Scrambler`／`Descrambler` |
| `periph/` | 4 | `UartTx`／`UartRx`／`SpiMaster`／`I2cMaster` |
| `dsp/` | 3 | `FirSerial`／`MacSerial`／`MovingAverage` |
| `util/` | 3 | `BitReverse`／`EndianSwap`／`ByteEnableExpand` |
| 合計 | 66 | |

**書けたもの／書けなかったものの線引きが、この一覧の要点である。**
単一クロックの論理（カウンタ・FIFO・調停）、FSM＋シフト（周辺IF）、直列にして時間へ
展開する積算（CRC・LFSR・直列DSP）はIRISで素直に書ける。
多ストリームのmux／demuxも、要素を連結した**パックドベクタ**（`bit[Width*N]`）と
部分選択（`data[i*Width +: Width]`）で書ける。`VecMux`／`VecDemux`が実例で、
`sel`は積が桁あふれしないよう幅拡張してから掛ける。
combでの総和の畳み込み（popcount／並列CRC）は書けないが、**直列に時間へ展開すれば書ける**（`PopcountSerial`が実例）。
一方、`bit[W][N]`という構文の配列ポートそのもの、
ジェネリック関数（汎用math）は現状のIRISでは書けない。
（XORの畳み込みは`.xor_reduce()`と部分ビット代入で書ける。`Parity`／`Gray2Bin`が実例。）
詳しくは各部品の説明と「実装上の注意」に、できなかった理由まで残している。

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

全部品のテストベンチ（振る舞い＝assert）を一括で回すには次を使う。
`tools/conformance/run.sh`が変換・往復・verilatorを守るのに対し、これは各`_tb`のassertを実行して
**振る舞いの回帰**を捕まえる（iris-simはassert失敗でexit 1）。

```
bash tools/lib_test.sh    # lib/ の全 <name>_tb.iris を iris-sim で実行（現在 66/0）
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
| `Pwm` | PWM生成（カウンタ＋比較、デューティ比`duty/Period`） | `Period`（1周期のクロック数、既定256、2以上）、`Width`（導出`$clog2(Period)`） |

`ClkDivider`はクロックをゲーティングせず、クロックイネーブル（tick）を出す合成向きの方式。

`Pwm`は周期`Period`の自由走行カウンタを回し、`cnt < duty`の間だけ出力を1にする。
デューティ比は`duty / Period`（`duty`が0なら常に0）。LEDの調光やモータ駆動に使う。

`Debounce`は入力`d`が`Count`サイクル連続して現在の出力と異なったときだけ出力`q`を
切り替える。それより短いグリッチは無視する（押しボタンのチャタリング除去）。
メタステーブル対策ではないので、非同期入力は先に`Sync2ff`で同期させてから入れる。

`Counter`はラップを幅の自然なあふれに任せ、飽和は上限（全ビット1）と下限（0）で値を保つ。
上限の判定は`count + 1 == 0`で行う（全ビット1に1を足すとWidthビットで0へ戻る）。

`EdgeDetect`は前サイクルの値をレジスタに保ち、`rise = d & ~prev`、`fall = ~d & prev`で出す。

| 部品 | 機能 | パラメータ |
|---|---|---|
| `Timer` | 周期タイマ（ダウンカウンタ、0で1サイクルtick、自動リロード） | `Width`（既定16、1以上） |
| `OneShot` | ワンショット（trigの立上りでLenサイクル幅のパルス） | `Len`（パルス幅、既定4、1以上）、`CntWidth`（導出`$clog2(Len)+1`） |

`Timer`は`en`のあいだ`reload`から0へ数え下げ、0のサイクルで`tick`を1サイクル出して`reload`を
読み直す（周期＝`reload+1`）。`reload`は毎サイクル参照するので動的に変えられる。周期割り込みや
レート生成に使う。

`OneShot`は`trig`の立上りを検出すると`pulse`をLenサイクルのあいだ1にする（前値との比較でエッジ検出、
カウンタを`Len-1`から数え下げ）。短いイベントを一定幅の制御信号に伸ばす。発火中の追加トリガは無視する。

| 部品 | 機能 | パラメータ |
|---|---|---|
| `Watchdog` | ウォッチドッグ（一定時間kickされないとalarm） | `Width`（既定16、1以上） |

`Watchdog`は`en`のあいだカウンタを進め、`timeout`に達したら`alarm`を1にして保持する。`kick`が来ると
カウンタと`alarm`を0に戻す（生存確認）。`kick`は`en`より優先。定期的にkickできなくなった＝ハングや
異常を検出する（機能安全・監視）。Timer（周期tick）と違い「期限内にkickが来るか」を見る。

### arith

| 部品 | 機能 | パラメータ |
|---|---|---|
| `PriorityEncoder` | 立っている最下位ビットの添字と有効フラグ | `Width`（既定8、2以上）、`IdxWidth`（既定`$clog2(Width)`） |
| `Lzc` | 先頭ゼロ数（最上位から最初の1までの0の個数） | `Width`（既定8、1以上）、`CountWidth`（既定`$clog2(Width)+1`） |
| `Bin2Gray` | 2進 → GRAY符号（`bin ^ (bin >> 1)`） | `Width`（既定8、1以上） |
| `Decoder` | 2進の添字 → one-hot（`en`で開く） | `Width`（出力線の数、既定8、2以上）、`SelWidth`（導出`$clog2(Width)`） |
| `Rotator` | バレルローテータ（可変量の巡回シフト） | `Width`（既定8、2以上）、`Right`（0=左/1=右、既定0）、`ShWidth`（導出`$clog2(Width)`） |
| `Gray2Bin` | GRAY符号 → 2進（`Bin2Gray`の逆） | `Width`（既定8、1以上） |
| `MinMax` | 2入力の最小/最大（符号なし・符号付き） | `Width`（既定8、1以上）、`Signed`（0/1、既定0）、`Max`（0=最小/1=最大、既定0） |
| `DivSerial` | 直列除算器（復元法、符号なし） | `Width`（既定8、1以上）、`CntWidth`（導出`$clog2(Width)+1`） |
| `MulSerial` | 直列乗算器（シフト加算、符号なし、全幅の積） | `Width`（既定8、1以上）、`PWidth`（導出`Width+Width`）、`CntWidth`（導出） |

`MinMax`は`a`と`b`の小さい方または大きい方を出す。`out = a`と置き、条件に合えば`out = b`で
上書きする（選択）。`Signed`が1なら`.signed()`で符号付き比較する（符号付き比較の修正の実例）。

`DivSerial`は`start`で除算を始め、Widthサイクルで商と剰余を求める（復元法、1サイクル1ビット）。
部分剰余をシフトして被除数のビットを取り込み、除数と比べて引ければ引き商ビットを立てる。
`200/7=28余り4`等を確認。`done`が完了の次に1サイクル1になる。

`MulSerial`は`start`で乗算を始め、Widthサイクルで全幅（2*Width）の積を求める（シフト加算）。
IRISの`*`はオペランド幅に切り詰められるが、これは全幅の積を出す（`200*200=40000`等を確認）。
上位への加算は桁上げを含めるため1ビット零拡張してから足す（加算の結果幅は最大オペランド幅なので）。

`Gray2Bin`は`bin[i] = (gray >> i).xor_reduce()`で各ビットを作る（第i位以上のXOR）。
`.xor_reduce()`（XORリダクション）と部分ビット代入（`bin[i] = ...`はビットごとに積み上がる）で、
XORの畳み込みをcombで書ける。`Bin2Gray`と往復して元に戻ることを確認している。

`Rotator`は`data`を`amt`ビット巡回シフトする。両方向のシフトをORして作る
（`(data << amt) | (data >> (Width - amt))`、右回転はその逆）。
`amt`が0のとき`data >> Width`は0になる（全幅シフトは0）ので、回転量0はそのまま返る。

`PriorityEncoder`／`Lzc`／`Decoder`は組み合わせで、`for`ループと
「combの後の代入が優先される（last-wins）」性質を使う。
`PriorityEncoder`は高い添字から回して最下位の1を残す。
`Lzc`は低い添字から回して最上位の1を残し、`Width - 1 - i`を先頭ゼロ数とする。
`Decoder`は`sel`に一致する1ビットだけを立てる（`PriorityEncoder`の逆向き）。
`1 << sel`は使わない。無型リテラル`1`が1ビット幅と推論され、シフトで桁があふれて0になる
ためである。幅付きの`for`で1ビットを選べば確実である。

| 部品 | 機能 | パラメータ |
|---|---|---|
| `SatAdd` | 飽和加算（あふれで折り返さず端に貼り付く） | `Width`（既定8、2以上）、`Signed`（0/1、既定0）、`Ext`（導出＝Width+1） |
| `SatSub` | 飽和減算（符号なしは下限0、符号付きは±飽和） | `Width`（既定8、2以上）、`Signed`（0/1、既定0）、`Ext`（導出＝Width+1） |

`SatAdd`／`SatSub`は桁上げ・符号あふれを見るため1ビット広い`bit[Width+1]`で和/差を作る。
符号なしは最上位ビット（桁上げ/借り）で判定し、`SatAdd`は全ビット1（`0-1`はWidth幅で全1）、
`SatSub`は下限0へ飽和させる。符号付きは`.signed().sign_extend[Ext]()`で符号拡張してから
演算し、上位2ビットの不一致であふれを検出、正のあふれは最大正（0x7F..）、負のあふれは
最小負（0x80..）へ飽和させる（端の値は部分ビット代入でMSBだけ立てる/落として作る）。組み合わせのみ。

| 部品 | 機能 | パラメータ |
|---|---|---|
| `OneHotCheck` | one-hot妥当性判定（ちょうど1ビット立っているか） | `Width`（既定8、1以上） |

`OneHotCheck`は`din & (din - 1)`で最下位の1を1つ落とし、結果が0でかつ`din`が0でなければ
`is_onehot`を1にする（畳み込み・popcount不要）。全0なら`is_zero`を1にする。組み合わせのみ。

| 部品 | 機能 | パラメータ |
|---|---|---|
| `Abs` | 絶対値（符号付き2の補数） | `Width`（既定8、2以上） |
| `Accumulator` | 積算器（enで加算・clearで0） | `Width`（既定16、1以上） |

`Abs`は負なら`~a + 1`、非負ならそのまま。最小負値（0x80..）は同幅で表せずラップする（明記）。
`Accumulator`は`en`のたびに`acc += din`、`clear`で0に戻す。乗算のない単純な積算器
（積和は`MacSerial`、飽和が要るなら`SatAdd`と組み合わせる）。加算はWidth幅でラップする。

| 部品 | 機能 | パラメータ |
|---|---|---|
| `PopcountSerial` | 直列ポップカウント（1の個数、ハミング重み） | `Width`（既定8、1以上）、`CntWidth`（導出`$clog2(Width)+1`） |

`PopcountSerial`は`start`で`din`を取り込み、Widthサイクルで1ビットずつ`sr[0]`を`cnt`へ足す
（毎サイクル右シフト）。**combでは総和の畳み込みが書けないが、直列に時間へ展開すれば書ける**
という方針の実例（CRC・FIR・移動平均と同じ）。`done`は最後のビットで1、`busy`は計数中1。

### mem

| 部品 | 機能 | パラメータ |
|---|---|---|
| `FifoSync` | 単一クロックの同期FIFO（先入れ先出し） | `Width`（既定8）、`Depth`（既定4、2のべき乗）、`AddrWidth`／`PtrWidth`（Depthから導出） |
| `FifoAsync` | 2クロックドメインの非同期FIFO（GRAY符号ポインタ同期） | `DataWidth`（既定8）、`Depth`（既定16、4以上の2のべき乗）、`AddrWidth`／`PtrWidth`（導出） |
| `RamSp` | 単一ポート同期RAM（登録読み出し、read-before-write） | `Width`（既定8）、`Depth`（既定256、2以上）、`AddrWidth`（導出） |
| `RamDp` | 簡易デュアルポートRAM（書き1・読み1、登録読み出し） | `Width`（既定8）、`Depth`（既定256、2以上）、`AddrWidth`（導出） |
| `Ram2r1w` | 2読み1書きRAM（レジスタファイル型、登録読み出し） | `Width`（既定8）、`Depth`（既定32、2以上）、`AddrWidth`（導出） |

`FifoSync`は`mem`とラップビット付きポインタで実装する。
`empty`はポインタ一致、`full`はラップビットが異なり下位アドレスが等しいこと。

`FifoAsync`はGRAY符号のポインタを2段で同期させ、メタステーブルが伝わらないようにする
（`example/async_fifo`の設計を部品化）。**リセットは能動Low（`wr_rst_n`／`rd_rst_n`）**で、
本ライブラリの既定（能動High）とは異なる。非同期FIFOの定番に合わせた例外である。
配置制約（最大遅延SDC）はIRISから出せないので利用者の責任。

`RamSp`は1つのアドレスポートで読み書きする素直な同期RAM（`mem`）である。
読み出しは1サイクル遅れる（同期読み出し）。同一アドレスへ同時に読み書きすると`dout`には
書き込み前の古い値が出る（read-before-write）。RAMの中身はリセットしない（`mem`はリセット
対象にしない）。リセットは出力レジスタ`dout`だけを0に戻す。書き込みバイトイネーブルは
含まない（必要時に変種を足す）。

`RamDp`は書き込みポート（`we`／`waddr`／`din`）と読み出しポート（`raddr`／`dout`）を
別々に持つ同期RAMである。同じクロックで、書きながら別アドレスを読める（FIFOや行バッファの
土台）。読み出しは1サイクル遅れ、書き込みと読み出しが同アドレスなら`dout`に古い値が出る
（`RamSp`と同じread-before-write）。真のデュアルポート（両ポートで読み書き）は含まない。

`Ram2r1w`は読み出し2ポート＋書き込み1ポート（レジスタファイル型）。2つのオペランドを同時に読める。

| 部品 | 機能 | パラメータ |
|---|---|---|
| `ShiftRegister` | 固定段の遅延線（delay line、`en`で1段進める） | `Width`（既定8、1以上）、`Stages`（段数＝遅延サイクル、既定4、1以上）、`Total`（導出＝Width*Stages） |

`ShiftRegister`は`en`のたびに`din`を取り込み、Stagesサイクル遅れて`dout`へ出す。
段は連結したパックドベクタ`bit[Width*Stages]`で持ち、`en`のとき段iに段i-1の値を送る。
syncは非ブロッキング（右辺は前エッジの値を読む）なので、部分選択の代入がそのまま正しいシフトになる。
`en`が0の間は保持する。パイプラインの整合遅延やサンプル遅延に使う。

| 部品 | 機能 | パラメータ |
|---|---|---|
| `RingBuffer` | 循環バッファ（順次書込み＋ランダム読出し、登録読み出し） | `Width`（既定8、1以上）、`Depth`（既定8、2以上）、`AddrWidth`（導出） |

`RingBuffer`は`we`のたびに書き込みポインタ`wp`へ`din`を書いて`wp`を進める（末尾で0へ循環）。
読み出しは`raddr`で任意アドレスを指す（1サイクル遅れ）。`wptr`を出すので相対アクセスは利用側で
`wp`から算出する。FIRの遅延線・行バッファ・履歴に使う（FIFOの順次読みと違い、書込みは自動進行・
読出しは絶対アドレス）。中身はリセットしない（`mem`）。

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

| 部品 | 機能 | パラメータ |
|---|---|---|
| `Serializer` | パラレル入力・シリアル出力（PISO、LSB先頭） | `Width`（既定8、1以上）、`CntWidth`（導出） |

`Serializer`は`load`で`din`を取り込み、Widthサイクルで1ビットずつ`dout`へ出す（LSB先頭）。
`valid`は送出中1、`done`は最後のビットで1。0xB4を送って集め直すと元に戻ることを確認している。

`Deserializer`はその対（SIPO）。`en`のたびに`din`を取り込み、Widthビットで`dout`＋`valid`を出す。

| 部品 | 機能 | パラメータ |
|---|---|---|
| `VecMux` | N入力1出力の選択（パックドベクタ） | `Width`（既定8、1以上）、`N`（既定4、2以上）、`SelWidth`／`IdxWidth`／`Total`（導出） |
| `VecDemux` | 1入力N出力の振り分け（パックドベクタ） | 同上 |

`VecMux`／`VecDemux`はIRISに配列ポートがなくても多ストリームのmux／demuxを表せる例。
Widの要素をN個連結した1本の`bit[Width*N]`を入出力し、要素iを`[i*Width +: Width]`で選ぶ。
`sel`は積`sel*Width`が桁あふれしないよう`IdxWidth`へ拡張してから掛ける（IRISの積は
オペランド幅に丸める）。`VecDemux`は`data`を先に0で埋め、選んだ要素だけ部分書き込みで
上書きする（comb部分書き込みは累積する）。組み合わせのみ。

| 部品 | 機能 | パラメータ |
|---|---|---|
| `StreamDownsizer` | 幅変換（広い語→狭い語N個、ready/valid） | `Width`（既定8、1以上）、`N`（既定4、2以上）、`Total`／`CntWidth`／`IdxWidth`（導出） |
| `StreamUpsizer` | 幅変換（狭い語N個→広い語、ready/valid） | 同上 |

`StreamDownsizer`は幅`Width*N`の1語を保持レジスタに取り込み、`out_ready`のたびにLSB側の要素から
1つずつ出す（取り込み中は`in_ready`を下げる）。`StreamUpsizer`はその逆で、狭い語をN個集めて
1語にまとめ、そろったら`out_valid`を上げる。要素位置は`cnt`を`IdxWidth`へ拡張して`*Width`し、
部分選択で読み書きする（`VecMux`／`VecDemux`と同じ手筋）。ready/validでバックプレッシャに従う。

| 部品 | 機能 | パラメータ |
|---|---|---|
| `StreamFork` | 1入力→N出力へ分配（全消費側が受けたら転送） | `Width`（既定8、1以上）、`N`（既定2、2以上）、`Total`（導出） |
| `StreamJoin` | N入力→1出力へ同期合流（全入力が揃ったら転送） | 同上 |

`StreamFork`は入力を同じデータでN本へ配り（`out_valid`は各出力に`in_valid`、`out_data`は各要素に
`in_data`）、`in_ready`を`out_ready`のANDにする（全消費側が同時に受けられるとき転送）。
`StreamJoin`はその逆で、`out_valid`を`in_valid`のANDにし、`in_ready[i]`を「全入力有効かつ`out_ready`」に
する（全入力を同時に消費）。多方向のvalid/readyは`bit[N]`、データはパックドベクタ。組み合わせのみ。
出力／入力ごとのバッファは持たない（個別に待たせたい場合は`SpillRegister`を挟む）。

| 部品 | 機能 | パラメータ |
|---|---|---|
| `StreamFilter` | 条件で通過・破棄（`keep`で選別） | `Width`（既定8、1以上） |
| `CreditCounter` | クレジットベースのフロー制御 | `Width`（既定8、1以上）、`MaxCredit`（初期クレジット、既定8） |

`StreamFilter`は`keep`が1の要素を下流へ通し（`out_valid=in_valid`、下流の`out_ready`に従う）、
0の要素は`in_ready`を1にして吸い込み捨てる。不要要素の除去に使う。組み合わせのみ。
`CreditCounter`は使えるクレジット数を数える。`give`で返し（+1）、`take`で使う（−1）、同時なら相殺。
`MaxCredit`から始め、残りがあれば`available`が1。送信可否をクレジットで律速するフロー制御に使う。

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

| 部品 | 機能 | パラメータ |
|---|---|---|
| `HandshakeSync` | 多ビット値のクロック跨ぎ（2相トグルのハンドシェイク） | `Width`（既定8、1以上） |

`HandshakeSync`は送信ドメインの1語を受信ドメインへ安全に渡す（非同期FIFOより軽い、たまに1語を
確実に渡す用途）。`send`（src_readyのとき）で取り込みリクエストのトグルを反転し、受信側は2段FFで
同期して変化を検出、保持レジスタ（安定な多サイクルパス）を取り込み`valid`を1サイクル出してackを返す。
送信側はackを2段FFで同期し、追いついたら`src_ready`を戻す。データ線自体は同期しない（ack戻りまで
送信側が保持し安定なので安全）。配置制約（トグル・データ線の最大遅延SDC）は利用者の責任。

### coding

| 部品 | 機能 | パラメータ |
|---|---|---|
| `Crc` | CRC（巡回冗長検査、ビット直列） | `Width`（既定8、2以上）。多項式`poly`は入力ポート |
| `Parity` | パリティ生成（偶/奇） | `Width`（既定8、1以上）、`Odd`（0=偶/1=奇、既定0） |
| `Secded` | 単一誤り訂正・二重誤り検出（8ビットデータの拡張ハミング(13,8)） | なし（データ8ビット固定）。`SecdedEnc`＋`SecdedDec` |
| `TmrVoter` | 三重冗長多数決（ビットごと、不一致フラグ付き） | `Width`（既定8、1以上） |
| `Checksum` | 1の補数和チェックサム（エンドアラウンドキャリー） | `Width`（既定8、1以上）、`Ext`（導出＝Width+1） |

`Crc`はMSB先頭で1サイクルに1ビット取り込み、`poly`で更新する（LFSRにデータ入力を足した形）。
`clear`で区切れる。並列CRC（1バイト同時）はXOR網の畳み込みが要り、現状のcombでは書けない。

`Parity`は`.xor_reduce()`でビットのXORを取る（偶パリティ）。`Odd`で奇パリティ（反転）。
iris2svは`.xor_reduce()`をSystemVerilogの縮約演算子`(^d)`へ変換する。

`Secded`はメモリECCの定番で、`SecdedEnc`（8ビット→13ビット符号語）と`SecdedDec`
（符号語→訂正データ＋single_err／double_err）の2モジュールからなる。
パリティは`.xor_reduce()`、訂正は「シンドロームが指す位置のビットを反転」で書く。
1ビット誤りを訂正し、2ビット誤りを検出することをTBで確認している。
データ8ビットに固定である（一般のハミング符号はパリティ数のコンパイル時計算が要り、
現状のIRISでは幅をジェネリックにできない）。

`TmrVoter`は三重化した3入力`a`／`b`／`c`のビットごとの多数決を出す
（`y = a&b | b&c | a&c`）。どれか1つがビット反転しても正しい値が残る（単一故障の吸収）。
3対の差（XOR）のORリダクションで`mismatch`を立て、食い違いを検出する。
SEU耐性や機能安全の出力合流に使う。組み合わせのみ。

`Checksum`は`en`のたびに`din`を1の補数和で積む（インターネットチェックサム方式）。
桁上げは捨てず下位へ回して足す（end-around carry）ので語順に依存しない。`clear`で0に戻す。
1回の加算では二重桁上げが起きないので1段の畳み込みで正しい。和はcombで作り（syncで同じvarを
読むと前サイクル値になるため）、accに登録する。送出値は出力`sum`の1の補数（`~sum`）。CRCと同じく直列。

| 部品 | 機能 | パラメータ |
|---|---|---|
| `Scrambler` | スクランブラ（自己同期型、ビット直列、LFSR） | `Width`（LFSR長、既定7、2以上）。多項式`poly`は入力ポート |
| `Descrambler` | デスクランブラ（`Scrambler`の対、自己同期型） | 同上 |

`Scrambler`は入力ビットを`poly`のLFSRで撹拌する。帰還は`(sr & poly).xor_reduce()`、
出力`scr = din ^ 帰還`で、状態`sr`には**送出した`scr`**をシフトインする（自己同期の要）。
`Descrambler`は同じ`poly`で、`dout = din ^ 帰還`、`sr`には**受信した`din`**をシフトインする。
自己同期なので種の同期は不要で、受信開始から数ビットで整合し元データを復元する（往復一致を確認）。
連続0/1の抑制やDCバランス（ラインコーディング）に使う。

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
| `MacSerial` | 直列積和（MAC）。`en`ごとに`acc += a*b`、`clear`で0に戻す | `AWidth`（既定8）、`BWidth`（既定8）、`GuardBits`（既定8）、`AccWidth`（導出）、`Signed`（0=符号なし/1=符号付き、既定0） |

`MacSerial`はDSPの基本部品で、`en`のたびに`acc = acc + a*b`を積む。内積Σa[i]*b[i]を対を
1つずつ流して求めるのに使う（`FirSerial`の中核を単体で取り出したもの）。
乗算の切り詰めを避けるため入力をAccWidth幅へ零拡張し、非ブロッキングのsyncに合わせて
「幅を広げて登録する段」と「掛けて足す段」の2段にする（入力からaccへ2サイクルの遅延、
`valid_out`も同じ遅延で1になる）。`clear`は`en`より優先。
`Signed`が1なら符号付きになり、入力を`.signed().sign_extend[AccWidth]()`で符号拡張してから積む
（桁は2の補数で正しいので和・積の式は同じ）。符号付きの結果は`acc.signed()`で読む
（負の積を含む内積 `-68` を確認）。

`FirSerial`は`y[n] = Σ coeff[k]*x[n-k]`を、1つの乗算器を時分割で使って求める。
係数は書き込みポートで読み込み、サンプルは`in_valid`で1つずつ入れ、`out_valid`で結果を出す。
**combでは畳み込み（積算）を書けないが、直列にして時間へ展開すればsyncの逐次加算で書ける**
（段L3の方針「直列にできるものはIRIS」の実例）。
乗算はオペランド幅に切り詰められるので、係数とサンプルは`AccWidth`幅のmemに零拡張して持ち、
積が切り詰められないようにする。`FirSerial`自体は符号なしだが、符号付きは`MacSerial`の
`Signed`と同じ要領（`.signed().sign_extend[AccWidth]()`）で書ける。

**符号付き演算はできる。** `bit[N]`を`.signed()`で符号付きに解釈し、`.sign_extend[M]()`で
符号拡張してから掛ければ、2の補数で正しく積算される（`MacSerial[Signed: 1]`が実例）。
符号付きの`==`／`!=`は値で比較するので、`acc.signed() == -68`のように負のリテラルと
比較できる（この比較はiris-simの修正で対応した。9.3.1参照）。
`int[Width]`／`uint[Width]`のジェネリック幅も書ける（`bit[Width]`と同様。パーサの不備を修正）。
`bit[N]`＋`.signed()`でも、`int[N]`直接でも、どちらでも幅をジェネリックにできる。

| 部品 | 機能 | パラメータ |
|---|---|---|
| `MovingAverage` | 移動平均（ボックスカー、窓幅N＝2のべき乗） | `Width`（既定8、1以上）、`N`（窓幅、2のべき乗、既定4、2以上）、`LogN`／`SumWidth`／`Total`（導出） |

`MovingAverage`は直近N個の平均を出す。総和の畳み込み（毎サイクルN個を足す）はcombでは
書けないが、**走査和**（`sum += din - 窓から出る最古の標本`）なら書ける。最古の標本は
長さNの遅延線（連結パックドベクタ）の最終段から得る。Nが2のべき乗なので平均は`sum >> LogN`。
リセット直後は遅延線が0なので最初のNサイクルで正しく立ち上がる。`FirSerial`と同じ
「畳み込みは直列（時間）に展開すれば書ける」方針の実例。

### util

| 部品 | 機能 | パラメータ |
|---|---|---|
| `BitReverse` | ビット順反転（`dout[i]=din[Width-1-i]`） | `Width`（既定8、1以上） |
| `EndianSwap` | バイト順反転（エンディアン変換） | `Bytes`（既定4、1以上）、`Width`（導出＝Bytes*8） |
| `ByteEnableExpand` | バイトEN→ビットマスク（1ビット→8ビット） | `Bytes`（既定4、1以上）、`Width`（導出＝Bytes*8） |

いずれも組み合わせのみの語彙変換部品。`for`で1要素ずつ埋める：`BitReverse`は部分ビット代入
（`dout[i]=...`はビットごとに積む）、`EndianSwap`はバイト単位の部分選択の読み書き、
`ByteEnableExpand`は部分選択への書き込み（値は`if be[i] { 8'hFF } else { 8'h00 }`）。
`EndianSwap`のように`(Bytes-1-i)*8`と括弧で優先順位を変える式は、iris2svが括弧を保って
SVへ写す（優先順位に応じた括弧付けに対応。従来は`Bytes-1-i*8`と落ちて意味が変わっていた）。

## 実装上の注意

**IRISのcombでは`var`を使えない。** `var`はsync／fsm専用である。
またcombでの信号の「まるごとの」再代入は「後の代入が優先される（last-wins）」であって、
`x = x + d[i]`のような**逐次的な総和にはならない**（各代入はブロック入口の値を読む）。
このため**総和の畳み込み（popcount、並列CRCのXOR網）は組み合わせでは書けない**（今後の課題）。

**ただしXORの畳み込みは書ける。** `.xor_reduce()`（XORリダクション、`.and_reduce()`／
`.or_reduce()`も同様）でビット全体のXORが取れ、**部分ビット代入（`out[i] = ...`）は
ビットごとに積み上がる**（まるごとの再代入と違い、`for`で全ビットを1つずつ埋められる）。
この2つで、`Parity`（`d.xor_reduce()`）や`Gray2Bin`（`bin[i] = (gray >> i).xor_reduce()`）が
combで書ける。SECDEDのパリティ計算（ビット部分集合のXOR）も同じ要領で書ける。
`iris2sv`は`.xor_reduce()`／`.and_reduce()`／`.or_reduce()`をSVの縮約演算子`(^d)`／`(&d)`／`(|d)`へ変換する。
CRCは直列（毎サイクル1ビット）にすれば書ける（積算を時間に展開する）。

**`bit[W][N]`という構文の配列ポートは書けないが、パックドベクタで代替できる。**
`in d: bit[Width][N]`や`var a: bit[W][N]`は「expected integer」で拒否される
（`mem`だけは生成境界にジェネリックを許す）。ただし**N本のストリームを束ねるmux／demux
は、要素を連結したパックドベクタ`bit[Width*N]`と部分選択`data[i*Width +: Width]`で書ける**
（`VecMux`／`VecDemux`が実例）。添字は積が桁あふれしないよう`sel.resize(IdxWidth) * Width`と
拡張してから掛ける。よくある用途はこれで足りる。真の`bit[W][N]`アンパックド配列ポートは今後の課題。

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

**IRISで書ける（必要時に追加）**：`uart`／`spi`／`i2c`（FSM＋シフト）、
直列`fir`／`mac`（syncで積算）、簡易`cache`（mem＋タグ＋FSM）。

**OSSを流用する（実証済みを再実装しない）。** 分野ごとの流用先は次のとおり。
IRIS側で書かず、変換後のSystemVerilogからインスタンス化して接続する。

| 分野 | 流用先（OSS） | ライセンス | 使い方の要点 |
|---|---|---|---|
| AXI一式（xbar／dma／cdc／cut） | [pulp-platform/axi](https://github.com/pulp-platform/axi) | Solderpad 0.51 | データパスはパックドベクタmux（`VecMux`）で書けるが、多マスタ/スレーブのプロトコルと調停は規模が大きく実証が要る。SVで接続 |
| 汎用セル（深いFIFO／可変段数同期化器ほか） | [pulp-platform/common_cells](https://github.com/pulp-platform/common_cells) | Solderpad 0.51 | 本libに無い変種はこちら（例：段数可変の`sync`、`fifo_v3`） |
| 暗号（AES／SHA-2／PRNG） | [OpenTitan](https://github.com/lowRISC/opentitan) `hw/ip/*`／`prim_*` | Apache 2.0 | 正しさとSCA対策のため自作しない。ラウンド関数のXOR網はcomb畳み込みにも当たる |
| 浮動小数点演算器 | [berkeley-hardfloat](https://github.com/ucb-bar/berkeley-hardfloat)／[pulp-platform/fpnew](https://github.com/pulp-platform/cvfpu) | BSD／Solderpad | IRISの`f32`/`f64`は模擬実行用。合成する演算器はこちら |
| 周辺IF（Ethernet／PCIe／UART DMA等） | [alexforencich/verilog-*](https://github.com/alexforencich) | MIT | 本libの`uart`/`spi`/`i2c`は軽量版。本格版はこちら |
| 大型DSP（FFT等） | 各ベンダ／OSS | 各条件 | 規模が大きく実証が要る |

判断基準は、IRISのcombの総和畳み込みの限界（popcount／並列CRC不可）。
直列にできるもの・FSMで書けるもの・パックドベクタで表せるものはIRIS、
重い/実証が要る/限界に当たるものはOSS。

## IRISで表さないもの

テクノロジ依存のセル（`clk_gate`、`tc_sram`、level_shifter等）はPDK実装に紐づくので、
IRISの合成可能な論理としては表さない。
SystemVerilogのレジスタマクロ（`FF`等）は対応物を作らない。`sync`と`var`で足りる。
これらが要る場合は、各PDKの実装や実在ライブラリ（`instructions.md`のB節）を使う。
