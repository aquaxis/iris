# tools/formal — 形式的等価性検証

IRISで書いた設計と、`iris2sv`がそれを変換したSystemVerilogが、
同じ回路であることを証明します。

```bash
tools/formal/run.sh              # 全設計
tools/formal/run.sh alu counter  # 設計を指定
tools/formal/run.sh -v           # 詳細
```

仕組みの説明は[`doc/formal_verification.md`](../../doc/formal_verification.md)にあります
（英語版は[`_en`](../../doc/formal_verification_en.md)）。

## 何を返すか

3つの判定しか返しません。

| 判定 | 意味 |
|---|---|
| `proven` | すべての入力、到達しうるすべての状態で一致する。段数の記載が無ければ段数無し |
| `disproven` | 一致しない。反例が出る |
| `skipped` | 試していない。理由が出る |

**`skipped`は合格ではありません。**
何も言えなかった設計として、失敗と同じ大きさで報告します。
終了ステータスは`disproven`と`skipped`のどちらでも非ゼロです。

**エラーが無いことを成功と読みません。**
`sat`に`-prove-asserts`が無ければ証明が終わらなくても終了0、
`equiv_status`に`-assert`が無ければ未証明のセルが残っても終了0になります。
どちらも成功のように読める出力を出すので、両方の指定を必須にしています。

## 段

| 段 | 何を見るか |
|---|---|
| 1. readable | yosysが忠実なモデルを作れるか |
| 2. mutations | 証明器が誤った設計を棄却するか |
| 3. equivalence | IRISの設計と`iris2sv`の出力（読み方A） |
| 4. round trip | `sv2iris`を経由した往復の前後（読み方B） |

段1は番人です。
yosysは名前を解決できないとき、線を発明して警告し、先へ進みます。
そのモデルに対する証明は別の回路についての証明になり、
正しいモデルに対する証明と見分けが付きません。
`implicitly declared`が1件でも出た設計は、以降の段に進みません。

段2は証明器そのものの検査です。
何を入れてもSUCCESSと言う流れは、正しい流れと出力から区別できません。
`designs.sh`の変異は**すべて棄却されなければなりません**。
通ってしまう変異は、設計ではなくこの流れの不具合です。

## 前提条件

| 道具 | 用途 |
|---|---|
| `yosys` 0.52以降 | `miter`、`sat`、`equiv_*`、`async2sync`が要る |
| `node` | `iris2sv`と`sv2iris`の実行 |
| `iris2sv` | `make -C tools iris2sv` |
| `sv2iris` | `make -C tools sv2iris`（段4のみ） |
| `iris-formal` | `cargo build --release --manifest-path sim/iris-sim/Cargo.toml` |

SymbiYosysは使いません。
この環境に無いため、yosysを直に叩いて書いてあります。

## 時間

証明が終わらないのは証明ではなく、
待ち続ける駆動部は何も報告しないのと同じです。
既定の予算は240秒で、超過は理由と予算を添えた`skipped`になります。

`riscv_core`は1024語×32ビットのメモリを持ち、
`memory_map`の後は両側で65,536個のフロップになります。
既定では届きません。

```bash
FORMAL_TIMEOUT=9000 tools/formal/run.sh riscv_core
```

等価性におよそ80分、往復におよそ73分かかります。

## 設計を足すには

`designs.sh`に1行足します。

```
"<名前>|<最上位モジュール>|<IRISのソース。依存を先に、最上位を最後に>"
```

変異も同じファイルに足します。
**変異のない設計は、証明器が働いていることを誰も確かめていない設計です。**

## ファイル

| | |
|---|---|
| `run.sh` | 駆動部 |
| `designs.sh` | 対象の設計と変異の一式 |
