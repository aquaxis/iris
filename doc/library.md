# IRIS標準ライブラリ

## この資料が扱うもの

IRISで書いた、再利用できるRTLの論理モジュール群である。
FIFOやカウンタや調停器を毎回書き直さずに、部品として取り込む。
部品の本体・テストベンチ・詳しい説明は`lib/`にある。
この資料は全体像と、書けたもの／書けなかったものの線引きを示す。

一覧と各部品のパラメータは[`lib/README.md`](../lib/README.md)にある。

## 置き場所

分類ごとにディレクトリを分ける。
現在24部品を9分類に置く。

| 分類 | 部品数 | 主な部品 |
|---|---|---|
| `timing/` | 5 | Counter、EdgeDetect、GrayCounter、Lfsr、ClkDivider |
| `arith/` | 3 | PriorityEncoder、Lzc、Bin2Gray |
| `mem/` | 3 | FifoSync、FifoAsync、RamSp |
| `arbiter/` | 2 | ArbiterFixed、ArbiterRr |
| `stream/` | 1 | SpillRegister |
| `cdc/` | 3 | Sync2ff、RstSync、PulseSync |
| `coding/` | 1 | Crc |
| `periph/` | 4 | UartTx、UartRx、SpiMaster、I2cMaster |
| `dsp/` | 2 | FirSerial、MacSerial |

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

24部品すべてのテストベンチが`iris-sim`で通る。
`tools/conformance/run.sh`は158/0を保つ。
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

書けなかったものは、理由とともに残す。

| 書けないもの | 理由 |
|---|---|
| combの畳み込み・積算（popcount、parity、gray2bin、並列CRC） | combで`var`が使えず、信号の再代入はlast-winsで逐次和にならない |
| ジェネリックな配列ポート・var配列（多ストリームのmux／demux） | 配列の生成境界に定数が要る（`mem`だけがジェネリックを許す） |
| ジェネリック関数（汎用math関数） | `fn f[Width](...)`がパースできない。固定幅の`fn`は動く |
| 符号付きの積和（符号付きFIR／MAC） | int型はあり同幅の演算は効くが、幅を広げる代入が符号拡張せず零拡張になる（asキャストもcomb／syncで不可） |
| 可変段数の同期化器 | var配列が生成境界に定数を要するため2段固定 |

直列にできるもの・FSMで書けるものはIRISで書き、
畳み込みや配列ポートの限界に当たるもの・実証が要る重いものはOSSを流用する。
重いIP（AXI・暗号・浮動小数点演算器・大型DSP）の流用先は[`lib/README.md`](../lib/README.md)に残す。

## テクノロジ依存のセルは表さない

`clk_gate`や`tc_sram`やlevel_shifterのようなPDK実装に紐づくセルは、
IRISの合成可能な論理としては表さない。
SystemVerilogのレジスタマクロ（`FF`等）の対応物も作らない。`sync`と`var`で足りる。
これらが要る場合は、各PDKの実装や実在ライブラリを使う。
