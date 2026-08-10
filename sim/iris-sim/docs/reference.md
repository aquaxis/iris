# IRIS言語リファレンス

IRIS言語の完全な構文仕様とキーワードリファレンスです。

## 目次

1. [字句構造](#1-字句構造)
2. [型システム](#2-型システム)
3. [モジュール宣言](#3-モジュール宣言)
4. [信号宣言](#4-信号宣言)
5. [ロジックブロック](#5-ロジックブロック)
6. [式](#6-式)
7. [文](#7-文)
8. [FSM構文](#8-fsm構文)
9. [メモリ宣言](#9-メモリ宣言)
10. [インターフェース](#10-インターフェース)
11. [パッケージ](#11-パッケージ)
12. [キーワード一覧](#12-キーワード一覧)
13. [仕様との差異](#13-仕様との差異)

---

## 1. 字句構造

### 1.1 コメント

```iris
// 単一行コメント

/*
   複数行コメント
*/
```

### 1.2 識別子

```
identifier = [a-zA-Z_][a-zA-Z0-9_]*
```

有効な識別子の例：
- `counter`
- `data_out`
- `_internal`
- `Signal123`

### 1.3 数値リテラル

#### 形式

```
ビット幅'基数 値
```

#### 基数

| 基数 | プレフィックス | 例 |
|------|---------------|-----|
| 2進数 | `b` | `8'b10101010` |
| 16進数 | `h` | `8'hAB` |
| 10進数 | `d` | `8'd170` |

#### 例

```iris
1'b0           // 1ビット、値0
1'b1           // 1ビット、値1
4'b1010        // 4ビット、2進数
8'hFF          // 8ビット、16進数 (255)
8'd100         // 8ビット、10進数
16'h1234       // 16ビット、16進数
32'd1000000    // 32ビット、10進数
```

### 1.4 文字列リテラル

```iris
"Hello, World!"
"init_file.hex"
```

---

## 2. 型システム

### 2.1 基本型

| 型 | 説明 | 例 |
|---|------|-----|
| `bit` | 1ビット信号 | `let a: bit;` |
| `bit[N]` | Nビットベクタ | `let data: bit[8];` |
| `clock` | クロック信号 | `in clk: clock` |
| `reset` | リセット信号 | `in rst: reset` |

### 2.2 配列型

```iris
bit[8][16]     // 8ビット x 16エントリの配列
bit[32][1024]  // 32ビット x 1024エントリの配列
```

### 2.3 列挙型（enum）

```iris
enum Colour { Red, Green, Blue }          // 基底型は自動（2ビット）

enum State: bit[2] {
    Idle = 2'b00,
    Run  = 2'b01,
    Stop = 2'b11
}
```

値を書かない場合は0から順に振られる。
基底型を書かない場合は、最大値を表せる幅が選ばれる。

変数の型として使い、値は`型名::バリアント名`で書く。

```iris
var c: Colour = Colour::Red;

match c {
    Colour::Red => { out_v = 10; },
    Colour::Green => { out_v = 20; },
    Colour::Blue => { out_v = 30; },
}
```

`match`の網羅性は宣言したバリアントで判定する（2^N通りではない）。
上の例は3バリアントすべてを覆っているので`_`は要らない。

#### ペイロード付き（タグ付きユニオン）

バリアントは値を1つ持てる。

```iris
enum Packet {
    Header,
    Payload(bit[8]),
    Footer
}
```

タグは下位ビット、ペイロードはその上に置かれる。
上の例は2ビットのタグと8ビットのペイロードで、全体は10ビットになる。

```iris
var pkt: Packet = Packet::Payload(8'hab);   // (0xab << 2) | 1 = 0x2ad
```

`match`の文形式では、ペイロードに名前を付けて取り出せる。

```iris
match pkt {
    Packet::Header => { k = 1; },
    Packet::Payload(data) => { k = 2; b = data; },
    Packet::Footer => { k = 3; },
}
```

式形式の`match`でも取り出せる。束縛した名前はそのアームの中だけで見える。

```iris
y = match pkt {
    Packet::Header => 1,
    Packet::Payload(data) => data,
    Packet::Footer => 3,
};
```

### 2.4 構造体（struct）と共用体（union）

構造体のフィールドはそれぞれ独立した信号になる。

```iris
struct Header {
    dst: bit[16],
    src: bit[16],
    kind: bit[8]
}

mod Probe(out o: bit[16]) {
    var hdr: Header;

    comb {
        hdr.dst = 16'hbeef;      // 波形には hdr.dst として現れる
        hdr.src = 16'h0000;
        hdr.kind = 8'h00;
        o = hdr.dst;
    }
}
```

共用体のフィールドは同じビットを共有する。
全体は最も広いフィールドの幅を持ち、各フィールドはその下位ビットである。

```iris
union DataView {
    as_byte: bit[8],
    as_word: bit[32]
}

mod LowByte(out low: bit[8]) {
    var dv: DataView;

    comb {
        dv.as_word = 32'h11223344;
        low = dv.as_byte;         // 0x44
    }
}
```

### 2.5 整数型

| 型 | 説明 | 例 |
|---|------|-----|
| `uint[N]` | Nビット符号なし整数 | `var c: uint[16] = 1000;` |
| `int[N]` | Nビット符号付き整数（2の補数） | `var d: int[8] = -50;` |
| `bool` | 真偽値（1ビット） | `var f: bool = 0;` |

別名も使える。`u8`は`uint[8]`、`i16`は`int[16]`と同じである。

```iris
var a: i8  = -50;    // int[8]
var b: u16 = 1000;   // uint[16]
```

### 2.6 符号の扱い

符号は宣言だけでなく値の性質である。
`bit[N]`の値も`.signed()`で符号付きとして解釈できる。

演算が符号付きになるのは**両方のオペランドが符号付きのとき**だけである。
ただしシフトは例外で、シフト量は大きさであり、シフトされる側だけが決める。

加算、減算、乗算、ビット演算はどちらの読み方でも同じビットになる。
符号を見るのは比較、除算、剰余、算術右シフト`>>>`だけである。

```iris
var a: i8 = -50;
var b: i8 = 30;
var raw: bit[8] = 8'hce;   // -50 と同じビット列

less   = a < b;            // 1（符号付きの比較）
less2  = a < raw.unsigned();  // 0（片方が符号なしなので符号なしの比較）
quot   = a / b;            // -1
ash    = a >>> 2;          // -13（符号ビットを複製する）
```

### 2.7 リセット型のオプション

```iris
reset                        // アクティブハイリセット（デフォルト）
reset(active_low: true)      // アクティブローリセット
reset(active_low: true, assert_cycles: 5)
reset(active_low: false, assert_time: 50ns)
```

負論理かどうかは宣言から判定する。
`_n`で終わる名前は、素の`reset`と宣言した場合のフォールバックとして負論理とみなす。

---

## 3. モジュール宣言

### 3.1 mod宣言（通常モジュール）

```iris
mod モジュール名(
    ポート宣言,
    ...
) {
    内部宣言
    ロジックブロック
}
```

#### 例

```iris
mod Counter(
    in  clk: clock,
    in  rst: reset,
    in  enable: bit,
    out count: bit[8],
) {
    var counter: bit[8] = 0;

    sync(clk.posedge, rst.async) {
        if enable {
            counter = counter + 1;
        }
    }

    comb {
        count = counter;
    }
}
```

### 3.2 test宣言（テストベンチ）

```iris
test テスト名 {
    内部宣言
    ロジックブロック
    テストブロック
}
```

#### 例

```iris
test CounterTest {
    let clk: clock;
    let rst: reset;
    var enable_sig: bit = 0;

    inst dut = Counter {
        clk: clk,
        rst: rst,
        enable: enable_sig,
    };

    sync(clk.posedge, rst.async) {
        // テストロジック
    }
}
```

### 3.3 ジェネリックパラメータとwhere句

モジュール名のあとに角括弧でパラメータを宣言する。
`where`句はパラメータの制約で、ジェネリックリストとポートリストの間に置く。

```iris
mod Buf[
    DataWidth: uint = 8,
    Depth: uint = 16,
    AddrWidth: uint = $clog2(Depth),
] where DataWidth >= 1, Depth >= 4 (
    in  clk: clock,
    in  d: bit[DataWidth],
    out q: bit[DataWidth],
) {
    mem storage: bit[DataWidth][Depth];
}
```

インスタンス化のときに引数を与える。省略したものは既定値になる。

```iris
inst small = Buf[DataWidth: 4, Depth: 8] { clk: clk, d: d };
```

既定値はインスタンス引数を適用したあとに宣言順で埋める。
そのため`Depth`を上書きすると、そこから導かれる`AddrWidth`も追従する。

パラメータは型だけでなく、信号の初期値、文中の式、メモリの深さにも代入される。
パラメータの組み合わせごとにモジュールが生成され、
波形には`Buf__DataWidth4_Depth8_AddrWidth3`のような名前で現れる。

`where`句に書けるのは`識別子 比較演算子 定数式`の形だけである。
違反するとO1005で拒否され、シミュレーションは始まらない。
制約はインスタンスごとに検査される。

### 3.4 関数（fn）

関数は`let`で中間の値に名前を付け、最後に`return`を1つ書く。
呼び出しはエラボレーションで展開される。

```iris
pub fn add(a: bit[8], b: bit[8]) -> bit[8] {
    return a + b;
}

fn mix(a: bit[8], b: bit[8]) -> bit[8] {
    let sum = a + b;
    let doubled = sum + sum;
    return doubled ^ a;
}

comb { y = add(c, 8'd10); }
```

関数どうしの呼び出しも展開される。
存在しない関数を呼ぶとO1006で報告される。

### 3.5 外部モジュール（extern）

IRISの外で実装されたモジュールを宣言する。本体は書かない。

```iris
extern mod legacy_uart(
    in  clk: clock,
    in  rst_n: reset(active_low: true),
    in  tx_data: bit[8],
    out tx: bit,
);
```

シミュレータはこれを実行できない。
インスタンス化するとO1007で警告し、出力は初期値のままになる。
実行は止まらない。

### 3.6 ポート宣言

| キーワード | 方向 | 説明 |
|-----------|------|------|
| `in` | 入力 | モジュールへの入力 |
| `out` | 出力 | モジュールからの出力 |
| `inout` | 双方向 | 入出力（トライステート） |

---

## 4. 信号宣言

### 4.1 let宣言（組み合わせ信号/定数）

```iris
let 名前: 型;
let 名前: 型 = 初期値;
```

- 組み合わせ論理の中間信号
- `comb` ブロックで値を代入

### 4.2 var宣言（レジスタ）

```iris
var 名前: 型 = 初期値;
```

- フリップフロップを生成
- `sync` ブロックで値を更新
- 初期値はリセット時の値

### 4.3 inst宣言（インスタンス）

```iris
inst インスタンス名 = モジュール名 {
    ポート名: 信号,
    ...
};
```

#### 例

```iris
inst counter1 = Counter {
    clk: clk,
    rst: rst,
    enable: enable_sig,
};
```

---

## 5. ロジックブロック

### 5.1 combブロック（組み合わせ論理）

```iris
comb {
    文...
}
```

- 組み合わせ論理を記述
- 全ての `let` 信号は `comb` 内で代入
- 出力ポートへの代入

### 5.2 syncブロック（順序論理）

```iris
sync(クロック指定, リセット指定) {
    文...
}
```

#### クロック指定

| 指定 | 説明 |
|------|------|
| `clk.posedge` | 立ち上がりエッジ |
| `clk.negedge` | 立ち下がりエッジ |

#### リセット指定

| 指定 | 説明 |
|------|------|
| `rst.async` | 非同期リセット |
| `rst.sync` | 同期リセット |

#### 例

```iris
sync(clk.posedge, rst.async) {
    // リセット時: 変数は初期値にリセット
    // 通常時: 以下を実行
    counter = counter + 1;
}
```

### 5.3 initial ブロック

```iris
initial {
    文...
}
```

- リセットが解除された**あと**、最初のクロックエッジを1回処理してから実行する
- したがって`initial`の中で見えるのは、1サイクル進んだあとの値である
- 初期化や、その時点の値を見るアサーションに使う

### 5.4 seq ブロック

```iris
seq {
    シーケンシャル文...
}
```

- リセット解除後、上から順に実行する
- `await`や`#10ns`で中断でき、その間も設計は動き続ける
- 中断から再開するのはクロックエッジのときである

`initial`ブロックと`seq`ブロックは1つの流れとして扱う。
`initial`が先、`seq`が後である。複数書いた場合は書いた順につながる。

```iris
seq {
    await clk.cycles(10);
    assert dut.count == 8'd10;   // 10サイクル進んだあとの値を見る
}
```

`await`や`#delay`を含まないループは設計を進める機会がない。
そのようなループが10万命令を超えると、警告を出してそのブロックを打ち切る。

---

## 6. 式

### 6.1 演算子優先順位

| 優先度 | 演算子 | 説明 |
|--------|--------|------|
| 1（最高）| `!` `~` `-` | 単項演算子 |
| 2 | `*` `/` `%` | 乗除算 |
| 3 | `+` `-` | 加減算 |
| 4 | `<<` `>>` | シフト |
| 5 | `<` `<=` `>` `>=` | 比較 |
| 6 | `==` `!=` | 等価比較 |
| 7 | `&` | ビットAND |
| 8 | `^` | ビットXOR |
| 9 | `\|` | ビットOR |
| 10 | `&&` | 論理AND |
| 11（最低）| `\|\|` | 論理OR |

### 6.2 算術演算子

| 演算子 | 説明 | 例 |
|--------|------|-----|
| `+` | 加算 | `a + b` |
| `-` | 減算 | `a - b` |
| `*` | 乗算 | `a * b` |
| `/` | 除算 | `a / b` |
| `%` | 剰余 | `a % b` |

除算と剰余は、両方のオペランドが符号付きのときだけ符号付きで行う。
0で割った結果は0である。

### 6.3 ビット演算子

| 演算子 | 説明 | 例 |
|--------|------|-----|
| `&` | AND | `a & b` |
| `\|` | OR | `a \| b` |
| `^` | XOR | `a ^ b` |
| `~` | NOT | `~a` |
| `<<` | 左シフト | `a << 2` |
| `>>` | 右シフト（0を詰める） | `a >> 2` |
| `>>>` | 算術右シフト（符号ビットを複製する） | `a >>> 2` |

### 6.4 比較演算子

| 演算子 | 説明 | 例 |
|--------|------|-----|
| `==` | 等しい | `a == b` |
| `!=` | 等しくない | `a != b` |
| `<` | 小なり | `a < b` |
| `<=` | 以下 | `a <= b` |
| `>` | 大なり | `a > b` |
| `>=` | 以上 | `a >= b` |

### 6.5 論理演算子

| 演算子 | 説明 | 例 |
|--------|------|-----|
| `&&` | 論理AND | `a && b` |
| `\|\|` | 論理OR | `a \|\| b` |
| `!` | 論理NOT | `!a` |

### 6.6 ビット選択・スライス

```iris
signal[index]       // 単一ビット選択
signal[high:low]    // ビットスライス（範囲選択）
```

#### 例

```iris
data[7]        // 8ビット信号の最上位ビット
data[3:0]      // 下位4ビット
data[7:4]      // 上位4ビット
```

スライスの上限と下限は**定数式**でなければならない。
定数式なので、パラメータや`$clog2`から導いてよい。

```iris
ptr[AddrWidth - 1 : 0]     // 定数式なので書ける
c[i + 3 : i]               // i が実行時に変わるならO2007で拒否される
```

### 6.7 パート選択

位置が実行時に変わる選択にはこの形を使う。幅は定数でなければならない。
両端が動くスライスは幅が定まらず、合成できないためである。

```iris
signal[index +: width]   // index から上へ width ビット
signal[index -: width]   // index から下へ width ビット
```

#### 例

```iris
var src: u16 = 16'hbeef;
part = src[4 +: 4];      // 4'he
part = src[7 -: 4];      // ビット7から下へ4ビット
```

### 6.8 メソッド

同じビット列の読み方を変える、あるいは幅を変えるメソッドである（仕様第3.4.2節）。

| メソッド | 説明 |
|---------|------|
| `.signed()` | 以後、2の補数として読む |
| `.unsigned()` | 以後、符号なしとして読む |
| `.sign_extend[N]()` | 符号ビットを複製してNビットへ広げる |
| `.extend[N]()` | 0を詰めてNビットへ広げる |

```iris
var a: i8 = -50;
wide = a.sign_extend[16]();   // 16'hffce
back = raw.signed().unsigned();
```

### 6.9 連結演算子

```iris
{expr1, expr2, ...}
```

#### 例

```iris
{a, b}              // aとbを連結
{4'b0, data[3:0]}   // 0埋めして8ビットに
{carry, sum}        // キャリーと和を連結
```

### 6.10 条件式（三項演算子）

```iris
if 条件 { 真の値 } else { 偽の値 }
```

#### 例

```iris
let max: bit[8];
comb {
    max = if a > b { a } else { b };
}
```

### 6.11 システム関数

| 関数 | 説明 | 合成可能 |
|------|------|---------|
| `$clog2(n)` | nを表すのに必要なビット数（切り上げ） | はい |
| `$bits(型)` | 型のビット幅 | はい |
| `$size(メモリ名)` | メモリの深さ | はい |
| `$display(書式, ...)` | 値の表示 | いいえ |
| `$finish` | シミュレーションの終了 | いいえ |
| `$isunknown(式)` | X/Zを含むなら1 | いいえ |
| `$onehot(式)` | 立っているビットが1つだけなら1 | いいえ |

「合成可能でない」ものを`comb` / `sync`ブロックに書くとO7009で拒否される。
検証コンテキストは`test`モジュール、`seq`ブロック、`initial`ブロックである。

`$clog2`と`$bits`は型の中でも式の中でも使える。
エラボレーション時に定数へ畳み込まれる。

```iris
mem storage: bit[8][Depth];
var addr: bit[$clog2(Depth)] = 0;

seq {
    $display("depth = %0d, width = %0d", $size(storage), $bits(bit[12]));
    $finish;
}
```

`$size`はメモリ名を直接書いた場合にだけ深さを返す。
`$size(inst.mem)`のような階層参照は解決できず、0になる。

#### $displayの書式

| 変換 | 意味 |
|------|------|
| `%d` | 10進 |
| `%h` / `%x` | 16進 |
| `%b` | 2進 |
| `%s` | 文字列 |
| `%%` | パーセント記号 |

`%0d`のような幅指定は受理して無視する。

---

## 7. 文

### 7.1 代入文

```iris
変数 = 式;
```

### 7.2 if文

```iris
if 条件 {
    文...
}

if 条件 {
    文...
} else {
    文...
}

if 条件1 {
    文...
} else if 条件2 {
    文...
} else {
    文...
}
```

### 7.3 match文

```iris
match 式 {
    パターン1 => 結果1,
    パターン2 => 結果2,
    _ => デフォルト,
}
```

#### 例

```iris
match op {
    2'b00 => result = a + b,
    2'b01 => result = a - b,
    2'b10 => result = a & b,
    _ => result = a | b,
}
```

### 7.4 for文

```iris
for 変数 in 開始..終了 {
    文...
}

for 変数 in 開始..=終了 {  // 終了を含む
    文...
}
```

#### 例

```iris
for i in 0..8 {
    data[i] = 0;
}
```

### 7.5 while文

```iris
while 条件 {
    文...
}
```

### 7.6 assert文

```iris
assert 条件;
assert 条件, "メッセージ";
```

#### 例

```iris
assert count == 8'd10, "Count should be 10";
```

### 7.7 break文・continue文

`for`と`while`の中で使う。`break`はループを抜け、`continue`は次の周回へ進む。
`comb`、`sync`、`seq`のいずれのループでも使える。

```iris
for i in 0..10 {
    if i == 8'd2 { continue; }
    if i == 8'd5 { break; }
    acc = acc + i;
}
```

### 7.8 expect文・assume文

どちらも`assert`と同じ形で書くが、違反しても実行は続き、終了コードも0のままである。

```iris
expect count < 8'd200, "soft check";
assume count != 8'd255, "premise";
```

| 文 | 違反したとき |
|----|-------------|
| `assert` | 報告し、終了コードを1にする |
| `expect` | 報告するが実行は続く |
| `assume` | 同上 |

### 7.9 ランダム化（rand・constraint・$randomize）

`rand`を付けて宣言した変数は、`$randomize`で新しい値を引く。
`constraint`ブロックに書いた条件をすべて満たすまで引き直す。

```iris
test RandTB {
    let clk: clock;
    let rst: reset;

    rand size: bit[16];
    rand kind: bit[4];

    constraint valid_size {
        size >= 16'd64;
        size <= 16'd1518;
    }
    constraint valid_kind {
        kind < 4'd8;
    }

    seq {
        $randomize;
        assert size >= 16'd64, "constraint held";
    }
}
```

乱数は決まった種から作るため、同じ設計は何度実行しても同じ値を引く。
インタプリタとコンパイル型でも同じである。

1000回引いても条件を満たせない場合は、最後に引いた値を残して警告する。

### 7.10 cover文

条件が成立した回数を数える。実行の最後に一覧を表示する。

```iris
cover count == 8'd5, "reached five";
cover valid && ready, "handshake";
```

名前を省くと条件式がそのまま名前になる。
一度も成立しなかった点も一覧に出る。

```
=== Coverage ===
  reached five: 1
  over a hundred: 0
coverage summary: 1 of 2 points reached
```

### 7.11 await文（seqブロック内）

```iris
await clk.posedge;               // 1クロック待つ
await clk.negedge;               // 同上
await clk.cycles(N);             // Nクロック待つ
await until(条件);                // 条件が成立するまで待つ
await until(条件, timeout: 1us);  // 待つ上限を指定する
```

待っている間も設計は動く。
`await until`は毎エッジで条件を調べ、成立するか上限に達したところで先へ進む。
上限を書かない場合は1000クロックである。

### 7.12 delay文（seqブロック内）

```iris
#10ns;   // 10ナノ秒待機
#1us;    // 1マイクロ秒待機
```

---

## 8. FSM構文

### 8.1 fsm宣言

```iris
fsm 名前(クロック指定, リセット指定) {
    state enum { ... }       // 必須
    initial: 状態名          // 省略可（既定は最初の状態）
    信号宣言...              // 省略可
    transitions { ... }      // 必須
    output 信号名 { ... }    // 省略可、複数可
}
```

### 8.2 state定義

状態は`state enum { ... }`で列挙する。この形以外は受け付けない。
角括弧はその状態にいる間の出力（Moore出力）である。

```iris
state enum {
    Idle[busy = 0],
    Running[busy = 1, done = 0],
    Complete[busy = 0, done = 1],
}
```

### 8.3 初期状態

`initial:`を書くと、その状態から始まる。省略すると最初の状態から始まる。
リセットがアサートされている間は初期状態を保つ。

```iris
initial: Idle
```

### 8.4 FSMローカル信号

FSM本体に信号を宣言できる。
ただし宣言された信号はモジュールのスコープに置かれ、独立したスコープを持たない。

```iris
var ticks: bit[8] = 0;
```

### 8.5 transitions定義

`_`はどの状態にも当てはまるワイルドカードである。
最初に条件が成立した`when`節だけが実行され、最初に成立した遷移だけが採られる。

```iris
transitions {
    状態名 => {
        when 条件 { アクション... }
        when 条件 { アクション... }
    }
    _ => {
        when 条件 { アクション... }
    }
}
```

### 8.6 FSMアクション

| アクション | 説明 |
|-----------|------|
| `goto 状態名;` | 状態遷移 |
| `変数 = 式;` | 変数代入 |
| `if 条件 { ... } else { ... }` | 条件による分岐（中身も同じアクション） |

```iris
Yellow => {
    when timer >= 8'd10 {
        if ped_request {
            goto Walk;
        } else {
            goto Red;
        }
        timer = 0;
    }
}
```

同じことは、条件を分けた複数の`when`でも書ける。最初に成立した節が採られる。

### 8.7 output定義（Mealy出力）

`output`には出力先の信号名を書く。各行は`状態名 => 式,`で、末尾のカンマが要る。

```iris
output phase {
    Idle => 8'd0,
    Processing => 8'd1,
    Done => 8'd2,
}
```

### 8.8 完全な例

```iris
mod Controller(
    in  clk: clock,
    in  rst_n: reset(active_low: true),
    in  start: bit,
    in  ack: bit,
    out busy: bit,
    out phase: bit[8],
) {
    var count: bit[8] = 0;

    fsm controller(clk.posedge, rst_n.async) {
        state enum {
            Idle[busy = 0],
            Processing[busy = 1],
            Done[busy = 0],
        }
        initial: Idle
        var ticks: bit[8] = 0;

        transitions {
            Idle => {
                when start { goto Processing; ticks = 0; }
            }
            Processing => {
                when count >= 8'd4 { goto Done; }
            }
            _ => {
                when ack { goto Idle; }
            }
        }

        output phase {
            Idle => 8'd0,
            Processing => 8'd1,
            Done => 8'd2,
        }
    }

    sync(clk.posedge, rst_n.async) { count = count + 1; }
}
```

現在の状態は`{fsm名}_state`という信号として波形に出る。
上の例では`controller_state`である。
インスタンス内のFSMは階層名になる（`c.controller_state`）。

---

## 9. メモリ宣言

### 9.1 基本構文

```iris
mem 名前: 要素型[深さ] { 設定 } = 初期値;
```

### 9.2 設定オプション

| オプション | 値 | 説明 |
|-----------|-----|------|
| `type` | `ram`, `rom` | メモリタイプ |
| `read_mode` | `sync`, `async` | 読み出しモード |
| `write_mode` | `sync` | 書き込みモード |
| `ports` | 数値 | ポート数 |
| `init_file` | 文字列 | 初期化ファイル |

### 9.3 例

```iris
// 非同期読み出しRAM
mem data_ram: bit[8][256] { type: ram, read_mode: async };

// 同期読み出しRAM
mem data_ram: bit[32][1024] { type: ram, read_mode: sync };

// 初期値付きROM
mem lookup: bit[8][16] { type: rom } = {
    8'h00, 8'h01, 8'h04, 8'h09,
    8'h10, 8'h19, 8'h24, 8'h31,
    8'h40, 8'h51, 8'h64, 8'h79,
    8'h90, 8'hA9, 8'hC4, 8'hE1
};

// ファイルから初期化
mem program: bit[32][4096] { type: rom, init_file: "program.hex" };
```

### 9.4 メモリアクセス

```iris
// 読み出し
let data: bit[8] = memory[addr];

// 書き込み（RAMのみ）
memory[addr] = data;
```

---

## 10. インターフェース

### 10.1 interface宣言

```iris
interface インターフェース名 {
    信号宣言...
    view定義...
}
```

### 10.2 信号宣言

信号はカンマ区切りで並べる。末尾のカンマは省略できる。

```iris
名前: 型,
```

### 10.3 view定義

方向ごとに信号をまとめて書く。方向のあとにコロンを置く。
方向はそのビューで接続する側から見たものである。

```iris
view ビュー名 {
    in: 信号名, 信号名
    out: 信号名
    inout: 信号名
}
```

ビュー名には`initiator`、`target`、`monitor`と任意の名前を書ける。

### 10.4 継承（extends）

`extends`で別のインターフェースを取り込む。単一継承のみである。

```iris
interface StreamBase {
    valid: bit,
    ready: bit,
    view initiator { out: valid
                     in: ready }
}

interface AxiStream extends StreamBase {
    data: bit[32],
    view initiator { out: valid, data
                     in: ready }
}
```

信号は継承元と継承先を合わせた1つの集合になる。
同名のビューを書き直した場合は継承先が優先する。

### 10.5 インターフェース型のポート

ポートの方向にビュー名を書く。
そのビューが`out`とした信号はこのモジュールが駆動し、`in`とした信号は受け取る。
`monitor`はすべてを受け取る。

```iris
mod Producer(
    in clk: clock,
    in rst_n: reset(active_low: true),
    initiator bus: Simple,
) {
    comb {
        bus.valid = 1;
        bus.data = count;
    }
}
```

### 10.6 接続

バスは信号として宣言し、両側のインスタンスに同じものを渡す。

```iris
test IfaceTB {
    let clk: clock(period: 10ns);
    let rst_n: reset(active_low: true);
    let link: Simple;

    inst p = Producer { clk: clk, rst_n: rst_n, bus: link };
    inst c = Consumer { clk: clk, rst_n: rst_n, bus: link };
}
```

インターフェースはメンバごとの信号に展開される。
波形には`link.valid`、`p.bus.valid`のような名前で現れる。

### 10.7 例

```iris
interface Simple {
    valid: bit,
    data: bit[8],
    ready: bit,

    view initiator {
        out: valid, data
        in: ready
    }
    view target {
        in: valid, data
        out: ready
    }
}

mod Producer(
    in clk: clock,
    in rst_n: reset(active_low: true),
    initiator bus: Simple,
) {
    var count: bit[8] = 0;
    sync(clk.posedge, rst_n.async) { count = count + 1; }
    comb {
        bus.valid = 1;
        bus.data = count;
    }
}

mod Consumer(
    in clk: clock,
    in rst_n: reset(active_low: true),
    target bus: Simple,
    out seen: bit[8],
) {
    var last: bit[8] = 0;
    sync(clk.posedge, rst_n.async) {
        if bus.valid { last = bus.data; }
    }
    comb {
        bus.ready = 1;
        seen = last;
    }
}

test IfaceTB {
    let clk: clock(period: 10ns);
    let rst_n: reset(active_low: true);
    let link: Simple;
    var observed: bit[8] = 0;

    inst p = Producer { clk: clk, rst_n: rst_n, bus: link };
    inst c = Consumer { clk: clk, rst_n: rst_n, bus: link };

    comb { observed = c.seen; }
}
```

## 11. パッケージ

### 11.1 package宣言

ファイルの先頭に書く。そのファイルの宣言はすべてそのパッケージに属する。

**common.iris**

```iris
package common;

pub enum OpCode: bit[4] {
    Add = 4'h0,
    Sub = 4'h1,
}

pub fn parity(data: bit[8]) -> bit {
    return data[0] ^ data[1];
}

pub mod Doubler(
    in  clk: clock,
    in  rst_n: reset(active_low: true),
    in  d: bit[8],
    out q: bit[8],
) {
    comb { q = d + d; }
}

// pub がないので他のパッケージからは見えない
mod Hidden(
    in  clk: clock,
    in  rst_n: reset(active_low: true),
    out q: bit,
) {
    comb { q = 1; }
}
```

**top.iris**

```iris
package app;

import common::{OpCode, Doubler, parity};

test AppTB {
    let clk: clock(period: 10ns);
    let rst_n: reset(active_low: true);
    var v: bit[8] = 8'h05;
    var op: OpCode = OpCode::Sub;
    var par: bit = 0;

    inst dbl = Doubler { clk: clk, rst_n: rst_n, d: v };

    comb { par = parity(v); }
}
```

### 11.2 import宣言

```iris
import common::{OpCode, Doubler, parity};   // 名前を選ぶ
import common::*;                            // すべて取り込む
import common::Word;                         // 1つだけ
```

### 11.3 export宣言

取り込んだ名前を、自分のパッケージを取り込む側へそのまま渡す。

```iris
package facade;

import common::{Doubler};
export Doubler;
```

これで`import facade::{Doubler}`と書ける。

### 11.4 可視性

`pub`を付けた宣言だけが他のパッケージから取り込める。
付けない宣言は同じパッケージの中でだけ見える。

パッケージに属する宣言は`パッケージ名::名前`という名前になる。
トップモジュールを指定するときもこの名前を使う。

```bash
iris-sim -i common.iris -i top.iris -t app::AppTB -c 100
```

---

## 12. キーワード一覧

### 12.1 予約語（58語）

仕様第2.4節が定める予約語である。識別子として使えない。

| 分類 | 予約語 |
|------|--------|
| モジュール構造（12） | `mod` `extern` `inst` `in` `out` `inout` `const` `type` `import` `export` `pub` `package` |
| 制御構造（8） | `if` `else` `match` `for` `while` `break` `continue` `return` |
| 型関連（13） | `bit` `int` `uint` `bool` `enum` `struct` `union` `clock` `reset` `let` `var` `mut` `mem` |
| 論理ブロック（9） | `comb` `sync` `fsm` `state` `when` `goto` `initial` `transitions` `default` |
| 検証（8） | `test` `assert` `expect` `cover` `assume` `constraint` `await` `seq` |
| インターフェース（6） | `interface` `initiator` `target` `view` `extends` `monitor` |
| その他（2） | `where` `fn` |

58語すべてに意味がある。

### 12.2 文脈で意味を持つ語

次の語は特定の位置でのみ意味を持ち、識別子としても使える。

| 語 | 使われる位置 |
|----|-------------|
| `posedge` / `negedge` | `sync(clk.posedge, ...)`、`fsm f(clk.posedge, ...)` |
| `async` / `sync` | リセットの指定（`rst.async`） |
| `period` / `duty_cycle` | `clock(period: 10ns)` |
| `active_low` / `assert_cycles` / `assert_time` | `reset(active_low: true)` |
| `ram` / `rom` | `mem`の`type:`指定 |
| `set` / `value` | `signal.set(value)` |
| `error` / `warning` / `fatal` | `assert ... else error(...)` |
| `logic` | 仕様上のインターフェース信号修飾子（文法は受け付けない） |

```iris
// いずれも識別子として使える
mod M(in clk: clock, in rst: reset, in period: bit[8], out y: bit[8]) {
    var value: bit[8] = 0;
    var ram: bit = 0;
    sync(clk.posedge, rst.async) { value = value + period; }
    comb { y = value; }
}
```

---

## 13. 仕様との差異

仕様書が定めていて、iris-simがまだ受け付けない構文である。34件ある。

以前ここに挙げていた4件は修正済みで、いまは受け付ける。
モジュール直下の`let`、インスタンス出力のスライス、
インスタンス内`mem`の階層読み、未知のメソッドの診断、
型注釈のない`let`の幅推論である。
`example/riscv`を書く過程で見つかったもので、経緯は
[RV32Iプロセッサのドキュメント](../../../example/riscv/doc/riscv.md)にある。
仕様の側が正しく、欠けているのは実装である。

仕様書とツールのドキュメント37ファイルからコードブロックを抽出して
すべて実行し、通らなかったものを構文ごとに最小の例へ落として確かめた。
その手順で見つかった範囲であり、網羅を保証するものではない。

### 13.1 定数と型

| 構文 | 例 |
|------|-----|
| `const`宣言 | `const W: uint = 8;` |
| `type`エイリアス | `type Byte = bit[8];` |
| 型パラメータ | `mod M[T: type = bit[8]](...)` |

`const`の代わりにジェネリックパラメータの既定値を使う。
`mod M[W: uint = 8](...)`は受け付ける。

### 13.2 式

| 構文 | 例 |
|------|-----|
| キャスト | `hdr as bit[112]` |
| 反復 | `{8{1'b1}}` |
| 三項演算子 | `a == 0 ? x : y` |
| 4値比較 | `a === b`、`a !== b` |
| べき乗 | `a ** 2` |
| 集合所属 | `a inside {1, 2}` |
| 配列展開 | `enable: enables[..]` |

三項演算子の代わりに`if`式を使う。
`o = if a == 0 { x } else { y };`は受け付ける。
ただし`else if`でつなぐ形は受け付けない。

### 13.3 文とブロック

| 構文 | 例 |
|------|-----|
| `if`式の`else if` | `if a { x } else if b { y } else { z }` |
| `comb`の既定値 | `comb { default: o = 0; ... }` |
| `wait` | `wait(10);` |
| 構造体パターン | `match s { S { x: 1, y: _ } => ... }` |

### 13.4 FSM

| 構文 | 例 |
|------|-----|
| 状態符号化の指定 | `output encoding: onehot` |

仕様第7章とEBNFの双方が定めているが、実装は受け付けない。
状態は宣言順の二進符号になる。

### 13.5 メモリ

| 構文 | 例 |
|------|-----|
| 初期化子 | `mem m: bit[8][2] = [8'd1, 8'd2];` |
| 属性 | `mem m: bit[8][4] { ports: 2 };` |

### 13.6 インターフェース

| 構文 | 例 |
|------|-----|
| ポート配列 | `initiator ports[4]: AxiLite` |
| パラメータ付きインスタンス | `let b: AxiLite[AddrWidth: 16];` |
| ビューの委譲 | `view initiator { c: initiator }` |

`extends`による継承は受け付ける。

### 13.7 パッケージ

| 構文 | 例 |
|------|-----|
| 公開型エイリアス | `pub type Byte = bit[8];` |
| 再エクスポート | `pub import common::Word;` |
| ファイル単位のモジュール宣言 | `pub mod common;` |

### 13.8 検証

| 構文 | 例 |
|------|-----|
| プロパティ定義 | `property p { ... }` |
| シーケンス定義 | `sequence s { ... }` |
| カバーグループ | `covergroup C(clk) { ... }` |
| フィクスチャ | `fixture F { ... }` |
| 並列実行 | `fork { ... } join;` |
| 静的変数 | `static c: bit[8] = 0;` |
| 含意演算子 | `expect(req \|-> ack);` |
| クロック生成API | `Clock.new(period: 10.ns)` |

`assert`、`expect`、`assume`、`cover`、`rand`、`constraint`ブロックは受け付ける。

### 13.9 外部連携

| 構文 | 例 |
|------|-----|
| Rust関数宣言 | `extern rust "m" { fn f(); }` |
| Rust関数の取り込み | `use rust::m::f;` |

`extern mod`は宣言だけ受け付ける。実行はできない（O1007）。

### 13.10 属性

`#[synthesis(...)]`、`#[test]`、`#[allow(...)]`などのアトリビュートは受け付けない。

---

## 関連ドキュメント

- [チュートリアル](tutorial.md) - 入門ガイド
- [サンプル集](examples.md) - 実践的なコード例
- [開発者ガイド](developer-guide.md) - iris-simの拡張方法
