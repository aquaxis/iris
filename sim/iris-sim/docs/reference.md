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
11. [キーワード一覧](#11-キーワード一覧)

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

### 2.3 リセット型のオプション

```iris
reset              // アクティブハイリセット（デフォルト）
reset(active_low)  // アクティブローリセット
```

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

### 3.3 ポート宣言

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

- シミュレーション開始時に1回だけ実行
- 初期化やアサーションに使用

### 5.4 seq ブロック

```iris
seq {
    シーケンシャル文...
}
```

- 順次実行されるテストシーケンス
- `await` や `#delay` を使用可能

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

### 6.3 ビット演算子

| 演算子 | 説明 | 例 |
|--------|------|-----|
| `&` | AND | `a & b` |
| `\|` | OR | `a \| b` |
| `^` | XOR | `a ^ b` |
| `~` | NOT | `~a` |
| `<<` | 左シフト | `a << 2` |
| `>>` | 右シフト | `a >> 2` |

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

### 6.7 連結演算子

```iris
{expr1, expr2, ...}
```

#### 例

```iris
{a, b}              // aとbを連結
{4'b0, data[3:0]}   // 0埋めして8ビットに
{carry, sum}        // キャリーと和を連結
```

### 6.8 条件式（三項演算子）

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

### 7.7 await文（seqブロック内）

```iris
await clk.posedge;           // 1クロック待機
await clk.negedge;           // 立ち下がりエッジ待機
await clk.cycles(N);         // Nサイクル待機
```

### 7.8 delay文（seqブロック内）

```iris
#10ns;   // 10ナノ秒待機
#1us;    // 1マイクロ秒待機
```

---

## 8. FSM構文

### 8.1 fsm宣言

```iris
fsm 名前(クロック指定, リセット指定) {
    state定義...
    transitions { ... }
    output { ... }  // オプション（Mealy出力）
}
```

### 8.2 state定義

```iris
state 状態名;
state 状態名[出力1=値1, 出力2=値2, ...];  // Moore出力付き
```

#### 例

```iris
state Idle;
state Running[busy=1, done=0];
state Complete[busy=0, done=1];
```

### 8.3 transitions定義

```iris
transitions {
    状態名 => {
        when 条件 { アクション }
        when 条件 { アクション }
    }
    ...
}
```

### 8.4 FSMアクション

| アクション | 説明 |
|-----------|------|
| `goto 状態名;` | 状態遷移 |
| `変数 = 式;` | 変数代入 |

#### 完全な例

```iris
fsm controller(clk.posedge, rst.async) {
    state Idle[busy=0];
    state Processing[busy=1];
    state Done[busy=0];

    transitions {
        Idle => {
            when start { goto Processing; }
        }
        Processing => {
            when count >= 8'd100 { goto Done; }
        }
        Done => {
            when ack { goto Idle; }
        }
    }
}
```

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

```iris
logic 名前: 型;    // ロジック信号
名前: 型;          // 通常の信号
```

### 10.3 view定義

```iris
view ビュー名 {
    in 信号名;
    out 信号名;
    inout 信号名;
}
```

### 10.4 例

```iris
interface AXILite {
    logic awaddr: bit[32];
    logic awvalid: bit;
    logic awready: bit;
    logic wdata: bit[32];
    logic wvalid: bit;
    logic wready: bit;
    logic bresp: bit[2];
    logic bvalid: bit;
    logic bready: bit;

    view master {
        out awaddr;
        out awvalid;
        in  awready;
        out wdata;
        out wvalid;
        in  wready;
        in  bresp;
        in  bvalid;
        out bready;
    }

    view slave {
        in  awaddr;
        in  awvalid;
        out awready;
        in  wdata;
        in  wvalid;
        out wready;
        out bresp;
        out bvalid;
        in  bready;
    }
}
```

---

## 11. キーワード一覧

### 予約語

| キーワード | 説明 |
|-----------|------|
| `mod` | モジュール宣言 |
| `test` | テストベンチ宣言 |
| `interface` | インターフェース宣言 |
| `in` | 入力ポート |
| `out` | 出力ポート |
| `inout` | 双方向ポート |
| `let` | 組み合わせ信号宣言 |
| `var` | レジスタ宣言 |
| `inst` | インスタンス宣言 |
| `mem` | メモリ宣言 |
| `comb` | 組み合わせ論理ブロック |
| `sync` | 順序論理ブロック |
| `fsm` | 状態機械宣言 |
| `state` | FSM状態定義 |
| `transitions` | FSM遷移定義 |
| `when` | FSM遷移条件 |
| `goto` | FSM状態遷移 |
| `initial` | 初期化ブロック |
| `seq` | シーケンシャルブロック |
| `if` | 条件分岐 |
| `else` | else節 |
| `match` | パターンマッチ |
| `for` | forループ |
| `while` | whileループ |
| `await` | 待機 |
| `assert` | アサーション |
| `bit` | ビット型 |
| `clock` | クロック型 |
| `reset` | リセット型 |
| `logic` | ロジック信号 |
| `view` | インターフェースビュー |
| `ram` | RAMタイプ |
| `rom` | ROMタイプ |
| `async` | 非同期 |
| `posedge` | 立ち上がりエッジ |
| `negedge` | 立ち下がりエッジ |

---

## 関連ドキュメント

- [チュートリアル](tutorial.md) - 入門ガイド
- [サンプル集](examples.md) - 実践的なコード例
- [開発者ガイド](developer-guide.md) - iris-simの拡張方法
