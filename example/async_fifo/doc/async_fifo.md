# 非同期FIFO（Async FIFO）のIRIS言語Example

## 概要

**非同期FIFO**は、異なるクロックで動く2つの回路のあいだでデータを受け渡すバッファである。
書き込み側は`wr_clk`で、読み出し側は`rd_clk`で動作し、両者のあいだに位相関係はない。
「非同期FIFO」はポインタをGRAY符号に変換してから相手のドメインへ渡すことで、クロックドメインをまたぐ多ビット信号のメタステーブル性を避ける。

本Exampleは、この回路をIRIS言語で記述し、iris-simで書き込みデータと読み出しデータの一致を検証するところまでを扱う。

使用するIRIS言語の機能は次のとおりである。

- **異なるクロックの`sync`ブロック**：1つのモジュールに2つのクロックドメインを置く
- **`reset(active_low: true)`**：負論理リセットの宣言
- **ジェネリックパラメータ**：データ幅と深さを`DataWidth`と`Depth`で与える
- **`where`句**：パラメータが満たすべき条件を宣言する
- **`$clog2`**：深さからアドレス幅とポインタ幅を導出する
- **`mem`宣言**：FIFOストレージを2次元配列として宣言する
- **メモリのインデックスアクセス**：`storage[addr]`による読み書き
- **ビットスライス**：`wr_ptr[AddrWidth - 1 : 0]`によるアドレス部の切り出し
- **連結**：`{a, b}`によるフル判定用ビットパターンの組み立て
- **`comb`ブロック**：読み出しデータとフラグの組み合わせ論理
- **ビット演算**：XORと右シフトによるGRAY符号変換
- **`assert ... else error(...)`**：読み出しデータの検証（テストベンチ）
- **`$display`と`$finish`**：結果の表示とシミュレーションの終了（テストベンチ）

## ディレクトリ構成

```
example/async_fifo/
├── src/
│   ├── async_fifo.iris       # 非同期FIFO本体
│   └── async_fifo_tb.iris    # テストベンチ
├── sim/
│   ├── run.sh                # シミュレーション実行スクリプト（インタプリタ）
│   ├── run_compiled.sh       # シミュレーション実行スクリプト（コンパイル型）
│   ├── output.vcd            # 波形出力
│   └── output.log            # シミュレータの標準出力
├── sv/
│   ├── async_fifo.sv         # iris2svで変換したDUT
│   ├── async_fifo_tb.sv      # SystemVerilogテストベンチ（手書き）
│   └── run.sh                # SystemVerilogシミュレーション実行スクリプト
└── doc/
    ├── async_fifo.md         # 本ドキュメント（日本語）
    └── async_fifo_en.md      # 英語ドキュメント
```

## 設計

### パラメータ

データ幅と深さはジェネリックパラメータで与える。
アドレス幅とポインタ幅は深さから導出するため、呼び出し側が指定する必要はない。

```rust
mod AsyncFifo[
    DataWidth: uint = 8,
    Depth: uint = 16,
    AddrWidth: uint = $clog2(Depth),
    PtrWidth: uint = $clog2(Depth) + 1,
]
where
    DataWidth >= 1,
    Depth >= 4,
(
    // ポート宣言は次節
) {
    // 本体
}
```

既定値の宣言は上から順に評価される。
`Depth`をインスタンス側で上書きすると、`AddrWidth`と`PtrWidth`もその値から計算し直される。

**where句**は、パラメータが満たすべき条件を宣言する。
深さが4未満だと`PtrWidth`が3に満たず、フル判定のスライス`[PtrWidth - 3 : 0]`が成り立たない。
条件を満たさない値でインスタンス化すると、シミュレーションを始める前にエラーになる。

```
error[O1005]: generic parameter constraint violation: Depth=2 violates constraint: Depth >= 4
  --> AsyncFifo:24:5
   = note: AsyncFifo requires: DataWidth >= 1, Depth >= 4
```

深さが2のべき乗であるという条件は、比較だけを書けるwhere句では表せない。
これは呼び出し側の責任となる。

### ポインタとラップビット

深さ`Depth`のFIFOに必要なアドレスは`$clog2(Depth)`ビットである。
ポインタはこれより1ビット広くとり、最上位ビットを**ラップビット**として使う。
ラップビットがあると、ポインタが一周ぶんずれた「フル」の状態と、完全に一致した「エンプティ」の状態を区別できる。
ストレージのアドレスには下位`AddrWidth`ビットだけを使う。

```rust
var wr_ptr: bit[PtrWidth] = 0;

storage[wr_ptr[AddrWidth - 1 : 0]] = wr_data;
```

### GRAY符号による同期

2進カウンタをそのままクロックドメインに渡すと、複数ビットが同時に変化する瞬間に受け側が中間値を取り込む可能性がある。
**GRAY符号**は隣接する値のあいだで1ビットしか変化しないため、取り込みに失敗しても値は変化前か変化後のどちらかになる。

変換は`gray = binary ^ (binary >> 1)`で行う。
ポインタを更新するのと同じエッジでGRAY符号も更新するため、更新後の値を式に書く。

```rust
wr_ptr = wr_ptr + 1;
wr_ptr_gray = (wr_ptr + 1) ^ ((wr_ptr + 1) >> 1);
```

渡されたGRAY符号は、受け側で2段のフリップフロップを通してから使う。

```rust
rd_ptr_gray_sync1 = rd_ptr_gray;
rd_ptr_gray_sync2 = rd_ptr_gray_sync1;
```

### フルとエンプティの判定

エンプティは、読み出し側のGRAYポインタが、同期された書き込み側のGRAYポインタと一致したときに成立する。

フルの判定はこれと異なる。
2進表現では「上位1ビットが異なり、下位4ビットが一致する」がフルの条件だが、GRAY符号ではこれが「上位2ビットが反転し、残り3ビットが一致する」に対応する。

```rust
empty = (rd_ptr_gray == wr_ptr_gray_sync2);
full  = (wr_ptr_gray == {
    ~rd_ptr_gray_sync2[PtrWidth - 1 : PtrWidth - 2],
    rd_ptr_gray_sync2[PtrWidth - 3 : 0]
});
```

どちらのフラグも`comb`ブロックで、登録済みのGRAYポインタから組み合わせ論理として求める。
読み出しデータも同じ`comb`ブロックで、読み出しポインタが指す語を非同期に取り出す。

```rust
rd_data = storage[rd_ptr[AddrWidth - 1 : 0]];
```

## テストベンチと検証方法

`async_fifo_tb.iris`は、書き込みクロックを10ns周期、読み出しクロックを25ns周期で駆動する。
読み出し側が2.5倍遅いため、FIFOは途中でフルに達し、書き込み側が待たされる。
この状態を作ることで、GRAY符号によるフル判定が働いていることを確認できる。

書き込み側は`wr_en`を立てたまま保持し、DUTが受理したエッジ（`wr_en`が1でフルでないエッジ）でだけ次のデータへ進む。
フルのあいだデータを進めないため、40語すべてが欠落せずにFIFOへ入る。

```rust
if wr_en {
    if ~dut.full {
        wr_data = wr_data + 1;
        wr_count = wr_count + 1;
        ...
    } else {
        wr_en = 1;
    }
}
```

読み出し側は、エンプティでないエッジで`dut.rd_data`を取り込み、期待値`expected`と比較する。
期待値は0x01から1ずつ増える連番であり、書き込み順とのずれや取りこぼしがあれば検出できる。

比較は二通りの方法で行う。
`mismatch`へのラッチは波形で追うためであり、`assert`はシミュレーションを失敗させて
終了コードに反映するためである。

```rust
if ~dut.empty {
    rd_data_obs = dut.rd_data;

    if dut.rd_data != expected {
        mismatch = 1;
    }
    assert dut.rd_data == expected
        else error("読み出しデータが期待値と一致しない");

    expected = expected + 1;
    rd_count = rd_count + 1;

    if (rd_count + 1) == 40 {
        $display("all %0d words verified at %0d", rd_count + 1, rd_count + 1);
        $finish;
    }
}
```

40語すべてを検証したら`$finish`でシミュレーションを終了する。
指定サイクル数に達するまで待つ必要がなくなり、結果もその場で表示される。

検証に使う信号は次の3つである。

- **`wr_count`**：DUTが受理した書き込み語数
- **`rd_count`**：検証済みの読み出し語数
- **`mismatch`**：期待値と異なるデータを読み出したら1になる

## 実行方法

### 前提条件

- Rust 1.70以降とcargoがインストールされていること

### シミュレーションの実行

```bash
cd example/async_fifo/sim
./run.sh
```

引数でサイクル数を変更できる。
サイクル数は書き込みクロック（10ns周期）を基準とし、既定値は200である。

```bash
./run.sh 400
```

スクリプトを使わずに直接実行する場合は次のとおりである。

```bash
cargo run --bin iris-sim --manifest-path sim/iris-sim/Cargo.toml -- \
    -i example/async_fifo/src/async_fifo.iris \
    -i example/async_fifo/src/async_fifo_tb.iris \
    -o example/async_fifo/sim/output.vcd \
    -c 200 -v
```

### 期待される結果

`run.sh`は最後に検証結果を表示する。

```
=== Verification ===
  words written (wr_count): 40
  words verified (rd_count): 40
  data mismatch flag:        0
  RESULT: PASS - all 40 words read back in order
```

40語すべてが書き込まれ、同じ順序で読み出され、期待値との不一致がないことを示す。

読み出しデータが期待値と異なると、`assert`がソース位置と両辺の値を添えて失敗を報告し、
シミュレータは終了コード1を返す。
スクリプトもこれを受けてFAILと表示する。

### コンパイル型シミュレータでの実行

同じ設計をRustプログラムに変換して実行することもできる。

```bash
cd example/async_fifo/sim
./run_compiled.sh
```

`iris-compile`が設計を一つのRustプログラムに変換し、それをビルドして実行する。
検証の判定は`run.sh`と同じである。
最後に`output.vcd`との比較を行い、インタプリタと同じ波形になることを確認する。

```
=== Verification ===
  words written (wr_count): 40
  words verified (rd_count): 40
  data mismatch flag:        0
  RESULT: PASS - all 40 words read back in order

  waveform matches the interpreter's output.vcd
```

スクリプトを使わずに直接実行する場合は次のとおりである。

```bash
cargo run --bin iris-compile --manifest-path sim/iris-sim/Cargo.toml -- \
    -i example/async_fifo/src/async_fifo.iris \
    -i example/async_fifo/src/async_fifo_tb.iris \
    -o example/async_fifo/sim/compiled/async_fifo_sim \
    --release --runtime-path sim/iris-runtime

example/async_fifo/sim/compiled/async_fifo_sim -c 200 -o output_compiled.vcd -v
```

### 波形の確認

```bash
gtkwave output.vcd
```

波形では次の点を確認できる。

- `wr_clk`が10ns周期、`rd_clk`が25ns周期で、それぞれ独立に遷移する
- 265ns付近で`dut.full`が初めて立ち、以後は書き込みと読み出しが交互に進む
- `dut.wr_ptr`と`dut.rd_ptr`が31から0へ折り返す
- `mismatch`が最後まで0のままである

## シミュレータの複数クロック対応

iris-simは、テストモジュールに宣言されたクロックが2つ以上あるとき、イベント駆動で時刻を進める。
各クロックは`clock(period: ...)`で指定された周期から次のエッジ時刻を持ち、シミュレータは最も早いエッジ時刻へ時刻を進めてから、そのエッジで動く`sync`ブロックだけを実行する。
周期の異なるクロックがそれぞれの周期で遷移するため、本Exampleのように2つのドメインが独立に動く設計を扱える。

インスタンスの`sync`ブロックは、そのクロックポートに実際に接続されている親側クロックのエッジでのみ実行される。
リセットについても、`sync`ブロックが駆動する信号だけがリセット値に戻る。
一方のドメインのリセットが、もう一方のドメインのレジスタを巻き込むことはない。

コンパイル型（`iris-compile`）も同じ規則で動く。
どのクロックがどの`sync`ブロックを駆動するかは、インスタンスの接続をたどって
コード生成の時点で決まり、クロックごとの関数として出力される。
値の演算と波形の記録はインタプリタと共通の実装を呼ぶため、両者の結果は一致する。

## SystemVerilogへの変換

このExampleは、IRISのシミュレータで動かすだけでなく、
SystemVerilogへ変換して市販・OSSのシミュレータで動かすこともできる。
変換した結果は`example/async_fifo/sv/`にある。

| ファイル | 内容 |
|---------|------|
| `async_fifo.sv` | `async_fifo.iris`をiris2svで変換したDUT |
| `async_fifo_tb.sv` | SystemVerilogのテストベンチ（手書き） |
| `run.sh` | Verilatorでビルドして実行する |

### 実行

```bash
cd example/async_fifo/sv
./run.sh
```

IRISソースから変換をやり直す場合は`--regenerate`を付ける。

```bash
./run.sh --regenerate
```

結果はIRIS版と同じである。

```
=== Verification ===
  words written (wr_count): 40
  words verified (rd_count): 40
  data mismatch flag:        0
  RESULT: PASS - all 40 words read back in order
```

### テストベンチが手書きである理由

iris2svは`test`モジュールを変換できる。
`clock(period: 10ns)`からのクロック生成も、`$display`と`$finish`も、
`dut.full`のような階層アクセスも変換される。

ここで手書きにしてあるのは、意図してのことである。
変換したDUTを、変換に使っていない経路で検証したいからである。
トランスパイラの不具合がテストベンチ側にも同じ形で現れて
打ち消し合うことがないため、確認としてはむしろ強い。

### シミュレータの選択

Verilatorを使う。Icarus Verilog 12.0は`always_*`ブロック内のパート選択を扱えず、
次のように報告する。

```
sorry: constant selects in always_* processes are not currently supported
(all bits will be included)
```

「全ビットを含める」とは、フル判定の式が設計と別物になるということである。
コンパイル自体は通るため、この行を読み飛ばすと誤った結果が静かに出る。

### 変換で問題になった点

IRISは算術をオペランドの幅で計算し、SystemVerilogは32ビットへ広げる。
GRAY符号ポインタの更新`(wr_ptr + 1) ^ ((wr_ptr + 1) >> 1)`はこの差が出る形であり、
そのまま変換するとポインタがラップした瞬間にフル判定が壊れ、
FIFOが未読データを上書きする。

iris2svは算術結果をオペランド幅へキャストしてこれを避ける。

```systemverilog
wr_ptr_gray <= PtrWidth'(wr_ptr + 1) ^ PtrWidth'(wr_ptr + 1) >> 1;
```

この不具合はコンパイルでもlintでも見つからない。
40語が順に読み出せることを実際に確かめて初めて表に出た。

## 別のサイズで使う

インスタンス化のときにジェネリック引数を与えると、そのサイズのFIFOが生成される。

```rust
inst small = AsyncFifo[DataWidth: 4, Depth: 4] {
    wr_clk: wr_clk,
    wr_rst_n: wr_rst_n,
    wr_en: wr_en,
    wr_data: wr_data,
    rd_clk: rd_clk,
    rd_rst_n: rd_rst_n,
    rd_en: rd_en,
};
```

シミュレータはパラメータの組み合わせごとにモジュールを生成する。
既定値でインスタンス化した場合、モジュール一覧には
`AsyncFifo__DataWidth8_Depth16_AddrWidth4_PtrWidth5`が現れる。

深さは4以上の2のべき乗であることを前提とする。
GRAY符号によるフル判定が、ポインタの一周を上位2ビットの反転で表現しているためである。
4以上という条件はwhere句が検査する。

## 制限事項

- スライスの添字は定数式でなければならない。実行時に変わる位置を選ぶには
  `data[idx +: width]`の形（パート選択）を使う。
- `where`句に書けるのは比較（`>=`、`<=`、`==`、`!=`、`>`、`<`）だけである。
  「2のべき乗」のような条件は表せない。
- `match`の網羅性は、対象がポートか信号を直接指す場合にのみ検査できる。
  式を対象にした`match`では幅が決まらないため検査を省く。

## 参照

- IRIS言語仕様書: `spec/iris_spec.md`
- 第3章 型システム: `spec/03_type_system.md`
- 第5章 組み合わせ論理: `spec/05_combinational_logic.md`
- 第6章 順序論理: `spec/06_sequential_logic.md`
- 第9章 演算子: `spec/09_operators.md`
- 第10章 メモリ: `spec/10_memory.md`
- 第11章 検証: `spec/11_verification.md`
