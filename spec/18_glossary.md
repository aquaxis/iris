# 第18章 用語集

[<< サンプルコード集](./17_examples.md) | [目次](./iris_spec.md) | [FAQ >>](./19_faq.md)

---

## A

### ALU（Arithmetic Logic Unit）
算術論理演算ユニット。
加算、減算、論理演算などの基本演算を実行するハードウェアユニット。

### assert
アサーション。
設計の正しさを検証するための文。
シミュレーション時に条件が満たされない場合にエラーを報告する。

### async（非同期）
非同期リセット。
クロックエッジに依存せず、即座に効果を発揮するリセット方式。
`rst.async`で指定。

### attribute（アトリビュート）
コード要素に付加するメタデータ。
`#[...]`形式で記述。
合成ツールへの指示やコンパイラ制御に使用。

### await
テストモジュールのseqブロック内で使用する時間制御構文。
クロックエッジ待機（`await clk.posedge`）、条件待機（`await until(expr)`）、サイクル待機（`await clk.cycles(n)`）などの形式がある。

### AXI（Advanced eXtensible Interface）
ARM社が策定したオンチップバスプロトコル。
AXI4、AXI4-Lite、AXI4-Streamなどのバリエーションがある。

---

## B

### barrel shifter
バレルシフタ。
任意のビット数のシフトを1クロックで実行できる回路。

### bit slice
ビットスライス。
信号の一部ビットを抽出する操作。
`signal[7:0]`形式。

### bit
IRISの基本ビット型。
`bit[N]`でNビット幅を表す。
例：`bit[8]`は8ビット。

### block RAM
FPGAに内蔵された専用メモリリソース。
大容量メモリの実装に使用。

---

## C

### CDC（Clock Domain Crossing）
クロックドメイン交差。
異なるクロックドメイン間での信号転送。
同期化が必要。

### clock
クロック型。
タイミング信号を表す専用型。

### comb
組み合わせ論理ブロック。
クロックに依存しない論理を記述。
SystemVerilogの`always_comb`に相当。

### concatenation
連結。
複数の信号を結合する操作。
`{a, b, c}`形式。

### const
定数宣言。
コンパイル時に値が確定する不変の値。

### context-based synthesis
コンテキストベース合成。
IRISの特徴で、信号の使用場所（comb/sync/fsm）により組み合わせ回路か順序回路かを自動判定する仕組み。

---

## D

### delay
遅延。
seqブロック内でシミュレーション時間を進める構文。
`#10ns;`（10ナノ秒遅延）、`#100;`（100タイムユニット遅延）の形式。

### driver
ドライバ。
信号に値を供給する回路。
IRISでは一つの信号に対して一つのドライバのみ許可（multi drive禁止）。

### distributed RAM
FPGAのLUT（Look-Up Table）を使用して実装されるメモリ。
小容量で高速なアクセスに向く。

### DSP
Digital Signal Processor。
FPGAに内蔵された乗算と加算のための専用ハードウェアブロック。

---

## E

### EBNF（Extended Backus-Naur Form）
拡張バッカス・ナウア記法。
文法を形式的に定義するための記法。

### enum
列挙型。
有限個の名前付き値を持つ型。

### extend
ビット幅拡張。
`.extend[N]()`でNビットに拡張。
ゼロ拡張または符号拡張。

### extern mod
外部モジュール宣言。
既存のVerilog/SystemVerilogモジュールをIRISから使用するための宣言。

### extern rust
外部Rust関数宣言ブロック。
testモジュールのseqブロックから呼び出す外部Rust関数のシグネチャを明示的に宣言する。
`extern rust "module" { fn name(); }`形式。

---

## F

### fanout
ファンアウト。
一つの出力が駆動する入力の数。
高ファンアウトはタイミング問題の原因になりうる。

### flip-flop
フリップフロップ。
クロックエッジで値を保持する基本的な順序回路素子。

### FIFO（First-In First-Out）
先入れ先出しバッファ。
データを格納順に取り出すキュー構造。

### FSM（Finite State Machine）
有限状態機械。
状態と遷移で動作を記述するモデル。
IRISでは`fsm`ブロックで宣言。

---

## G

### generic（ジェネリクス）
パラメータ化。
モジュールや型を汎用化する機能。
`mod Name[P: uint = 8]`形式。

### goto
FSM内での状態遷移命令。
`goto State;`で指定状態に遷移。

### gray code
グレイコード。
隣接する値が1ビットのみ異なるエンコーディング。
CDCやFSMで使用。

---

## H

### handshake
ハンドシェイク。
valid/ready信号によるデータ転送プロトコル。

### HDL（Hardware Description Language）
ハードウェア記述言語。
デジタル回路を記述するための言語。

---

## I

### ILA（Integrated Logic Analyzer）
統合ロジックアナライザ。
FPGA内部信号をリアルタイムで観測するデバッグツール。

### initial
初期化ブロック。
testモジュール内でシミュレーション開始時に一度だけ実行される処理を記述。
`initial { ... }`形式。

### initiator
インターフェースのビュー。
トランザクションを開始する側（マスター）。

### interface
インターフェース。
関連する信号をグループ化し、方向（ビュー）を定義する構造。

### inst
インスタンス化宣言。
モジュールのインスタンスを作成。
`inst name = Module { ... };`

---

## L

### latch
ラッチ。
意図しないラッチはバグの原因。
IRISでは組み合わせ論理の不完全な代入を検出してエラー報告。

### let
信号宣言。
`let x: bit[8];`で信号を宣言。
直接代入（`let x = expr;`）は組み合わせ回路。
sync/fsm内で代入すると順序回路。

### let mut
可変信号宣言。
初期値を指定してsync/fsmで使用すると、初期値がリセット値となる。

### literal
リテラル。
ソースコード中の定数値。
`8'hFF`（8ビット16進数）、`4'b1010`（4ビット2進数）など。

---

## M

### metastability
メタステーブル状態。
フリップフロップのセットアップ/ホールド時間違反により発生する不安定状態。
CDC対策が必要。

### multi drive
マルチドライブ。
同一信号への複数箇所からの駆動。
IRISではコンパイルエラーとして検出。

### match
パターンマッチ式。
複数の条件分岐を記述。
SystemVerilogの`case`に相当。

### Mealy（ミーリ）
ミーリ型FSM。
出力が現在の状態と入力に依存。

### mem
メモリ宣言。
RAM/ROMを宣言。
`mem storage: bit[32][1024];`

### mod
モジュール宣言キーワード。
ハードウェアモジュールを定義。

### Moore（ムーア）
ムーア型FSM。
出力が現在の状態のみに依存。

### multicycle path
マルチサイクルパス。
複数クロックサイクルで安定すればよい信号パス。

---

## N

### negedge
クロックの立ち下がりエッジ。
`clk.negedge`で指定。

---

## O

### one-hot
ワンホットエンコーディング。
1ビットのみが1となる状態エンコード方式。

---

## P

### package
パッケージ。
関連する型、関数、モジュールをグループ化する名前空間。

### pipeline
パイプライン。
処理を複数段階に分割し、スループットを向上させる技術。

### port
ポート。
モジュールの外部接続点。
`in`（入力）、`out`（出力）、`inout`（双方向）。

### posedge
クロックの立ち上がりエッジ。
`clk.posedge`で指定。

### pub
公開修飾子。
パッケージ外からアクセス可能にする。

---

## R

### RAM（Random Access Memory）
ランダムアクセスメモリ。
読み書き可能なメモリ。

### reset
リセット型。
回路の初期化信号を表す専用型。

### ROM（Read-Only Memory）
読み取り専用メモリ。
書き換え不可のメモリ。

---

## S

### seq
シーケンシャル処理ブロック。
testモジュール内でのみ使用可能な手続き的記述ブロック。
Rustの制御構文（for、while、if等）を直接使用でき、信号アクセスAPIと時間制御構文でDUTと連携する。
複数のseqブロックを定義すると並列実行される。

### signal access API
信号アクセスAPI。
seqブロック内でDUTの信号を読み書きするためのメソッド。
`.value()`で信号値を読み取り、`.set(value)`で信号に値を設定する。

### sync
順序論理ブロック。
クロック同期の回路を記述。
SystemVerilogの`always_ff`に相当。

### synchronizer
同期化器。
CDCで使用される複数段フリップフロップ回路。

### struct
構造体。
複数のフィールドをグループ化した複合型。

### sync_ff
同期化フリップフロップ。
CDC対策のための複数段FFシンクロナイザ。
`sync_ff(signal, stages: 2)`形式。

### SystemVerilog
IEEE 1800規格のハードウェア記述言語。
IRISのトランスパイル先。

---

## T

### timing constraint
タイミング制約。
クロック周期やセットアップ/ホールド時間の要件を定義。

### transpile
トランスパイル。
あるプログラミング言語から別の言語への変換。
IRISはSystemVerilogにトランスパイルされる。

### target
インターフェースのビュー。
トランザクションに応答する側（スレーブ）。

### test
テストブロック。
検証コードを記述。
`#[test]`アトリビュートで宣言。

### test module
テストモジュール。
`test identifier { ... }`形式で宣言されるテストベンチ専用のモジュール。
ポートを持たず、シミュレーション専用（合成対象外）。
seqブロック、initial、inst等を含む。

### time control
時間制御。
seqブロック内でシミュレーション時間を制御する構文の総称。
`await clk.posedge`（クロックエッジ待機）、`#10ns;`（遅延）、`await until(condition)`（条件待機）などがある。

### transitions
FSMの遷移定義ブロック。
各状態からの遷移条件と遷移先を記述。

### truncate
ビット幅切り捨て。
`.truncate[N]()`でNビットに切り詰め。

---

## U

### UltraRAM
Xilinx UltraScale+デバイスの大容量内蔵メモリ。

### use rust::
Rust関数インポート構文。
testモジュールのseqブロックで使用する外部Rust関数をインポートする。
`use rust::module::func;`（単一関数）、`use rust::module::{f1, f2};`（複数関数）、`use rust::module::*;`（ワイルドカード）の形式がある。

---

## V

### union
ユニオン型。
複数のバリアントのいずれかを保持する型。
タグ付きunionはenumに類似。

### var
順序回路専用の信号宣言。
sync/fsmブロック内でのみ使用可能。
comb/直接代入で使用するとコンパイルエラー。

### view
インターフェースのビュー定義。
信号の方向を指定。
`initiator`、`target`、`monitor`など。

### VIO（Virtual I/O）
仮想I/O。
デバッグ時にFPGA内部の信号を操作し、観測するツール。

---

## W

### when
FSM遷移条件。
`when condition { goto State; }`形式。

---

## 記号と数字

### `=`
代入演算子。
IRISでは組み合わせ論理でも順序論理でも`=`を使用（統一）。

### `#[...]`
アトリビュート記法。
メタデータをコード要素に付加。

### `$clog2`
2を底とする対数の天井関数。
必要なビット幅の計算に使用。

### `::`
スコープ解決演算子。
パッケージパスやジェネリクス引数で使用。

### `#`
遅延演算子（seqブロック内）。
シミュレーション時間を進める。
`#10ns;`（10ナノ秒遅延）。

---

[<< サンプルコード集](./17_examples.md) | [目次](./iris_spec.md) | [FAQ >>](./19_faq.md)
