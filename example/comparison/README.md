# IRIS / SystemVerilog / Veryl の比較

リポジトリ直下の`README.md`「SystemVerilogとの比較」に載っている数字は、
すべてここで作っています。

```bash
./run.sh
```

## 何を比べているか

| | 出どころ |
|---|---|
| IRIS | `example/riscv/src/alu.iris`、`example/counter/src/counter.iris`（手書き） |
| SystemVerilog | 上のIRISから`iris2sv`が生成したもの |
| Veryl | `veryl/`に置いた手書きのもの |

## 等価性を先に確かめる

行数と速度を測る前に、3者が同じ動作をすることを確かめます。
違う回路の行数を比べても意味がなく、
速い方が正しいとも限らないためです。

`equiv/`のテストベンチが、IRIS由来のモジュールとVeryl由来のモジュールを
並べて同じ入力を与え、出力を突き合わせます。

| 対象 | 内容 |
|---|---|
| `alu_equiv.sv` | 16通りの演算 × 境界値64組、および演算ごとに乱数2000組 |
| `ctr_equiv.sv` | 500サイクル分のクロック動作と、リセットパルス |

ALUの境界値には`0x8000_0000`と`0x7FFF_FFFF`を入れています。
SLTとSLTU、SRAとSRLは取り違えても中間的な値では一致してしまい、
符号の境界でしか差が出ないためです。

## Veryl版を手で書いた理由

`veryl translate`はSystemVerilogからVerylを生成します。
これを使えば手書きは要りませんが、今回の設計では使えませんでした。

`--strict`を付けてもエラーにならないまま、代入が落ちます。

| 設計 | SystemVerilogの代入 | 変換後に残った数 |
|---|---|---|
| alu | 5 | 1 |
| decoder | 27 | 1 |
| regfile | 4 | 2 |
| riscv_core | 33 | 9 |
| async_fifo | 19 | 17 |

落ちた分だけVerylが短く見えるため、行数の比較には使えません。
動作も違うので、速度の比較にも使えません。

手書きにすると、今度は書いた側が結果を決めてしまいます。
そのため`equiv/`で等価性を確かめる手順を先に置いています。

## 前提条件

- `veryl` — [リリース](https://github.com/veryl-lang/veryl/releases)から取得
- `verilator`
- `cargo`（`iris-sim`と`iris-compile`のビルドに使用）
- `node`（`iris2sv`の実行に使用）

`iris-sim`が未ビルドの場合は速度の該当行が飛びます。

```bash
cargo build --release --manifest-path ../../sim/iris-sim/Cargo.toml
```
