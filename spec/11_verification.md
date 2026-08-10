# 第11章 検証機能

[<< メモリ](./10_memory.md) | [目次](./iris_spec.md) | [パッケージシステム >>](./12_package_system.md)

---

## 11.1 テスト構文

### 11.1.1 基本テストブロック

```rust
#[test]
test check_counter() {
    // DUTのインスタンス化
    let dut = Counter[Width: 8].create();

    // クロック生成
    let clk = Clock.new(period: 10.ns);
    dut.clk = clk;

    // リセットシーケンス
    dut.rst.assert();
    await clk.cycles(5);
    dut.rst.deassert();
    await clk.cycles(1);

    // テスト刺激
    dut.enable = 1;
    await clk.cycles(10);

    // 検証
    assert dut.count == 8'h0A;
}
```

### 11.1.2 テストアトリビュート

| アトリビュート | 説明 | 例 |
|----------------|------|-----|
| `#[test]` | テストブロック宣言 | 必須 |
| `#[timeout(1.ms)]` | タイムアウト指定 | デッドロック防止 |
| `#[should_fail]` | 失敗を期待 | ネガティブテスト |
| `#[ignore]` | テストをスキップ | 一時的に無効化 |
| `#[parametric]` | パラメトリックテスト | 複数条件テスト |

```rust
#[test]
#[timeout(100.us)]
test long_running_test() {
    await some_long_operation();
}

#[test]
#[should_fail]
test invalid_input_should_fail() {
    dut.invalid_data = 8'hFF;
    await clk.cycles(1);
    assert dut.error == 1;
}

#[test]
#[ignore("Issue #123: Not implemented yet")]
test future_feature() {
    // 未実装機能のテスト
}
```

### 11.1.3 パラメトリックテスト

```rust
#[test]
#[parametric]
test counter_various_widths[Width in [4, 8, 16, 32]]() {
    let dut = Counter[Width].create();
    let clk = Clock.new(period: 10.ns);

    dut.clk = clk;
    dut.rst.assert();
    await clk.cycles(5);
    dut.rst.deassert();

    dut.enable = 1;
    let max_count = (1 << Width) - 1;
    await clk.cycles(max_count);

    assert dut.count == max_count as bit[Width];
}

// 複数パラメータ
#[test]
#[parametric]
test fifo_configurations[
    Depth in [16, 32, 64],
    Width in [8, 16, 32]
]() {
    let dut = Fifo[Depth, Width].create();
    // テスト実装
}
```

### 11.1.4 シミュレーション制御

```rust
// 時間単位
let period = 10.ns;      // ナノ秒
let delay = 1.us;        // マイクロ秒
let timeout = 100.ms;    // ミリ秒

// クロック生成
let clk = Clock.new(period: 10.ns);
let clk_fast = Clock.new(period: 5.ns, duty: 0.6);

// クロックサイクル待機
await clk.cycles(10);              // 10サイクル待機
await clk.posedge();               // 次の立ち上がりまで待機
await clk.negedge();               // 次の立ち下がりまで待機

// 時間待機
await delay(100.ns);               // 100ns待機

// 条件待機
await until(dut.ready == 1);       // 条件成立まで待機
await until(dut.done == 1, timeout: 1.ms);  // タイムアウト付き

// イベント待機
await event(dut.interrupt);        // イベント発生まで待機
```

### 11.1.5 並列実行

```rust
// 並列実行
fork {
    // タスク1
    await send_data(dut, data);
}
join {
    // タスク2
    await receive_response(dut);
}

// fork/joinバリエーション
fork {
    task1();
    task2();
    task3();
}
join;           // 全タスク完了まで待機

fork {
    task1();
    task2();
}
join_any;       // いずれか1つが完了したら続行

fork {
    task1();
    task2();
}
join_none;      // 待機せず即座に続行
```

### 11.1.6 テストフィクスチャ

```rust
fixture CounterTestFixture {
    dut: Counter[8],
    clk: Clock,

    fn setup() {
        self.dut = Counter[Width: 8].create();
        self.clk = Clock.new(period: 10.ns);
        self.dut.clk = self.clk;

        self.dut.rst.assert();
        await self.clk.cycles(5);
        self.dut.rst.deassert();
    }

    fn teardown() {
        // クリーンアップ処理
    }
}

#[test]
#[fixture(CounterTestFixture)]
test increment_test(fix: CounterTestFixture) {
    fix.dut.enable = 1;
    await fix.clk.cycles(5);
    assert fix.dut.count == 5;
}
```

---

## 11.2 アサーション

### 11.2.1 即時アサーション

```rust
// 基本アサーション
assert data != 0;
assert count < MAX_VALUE;

// エラーメッセージ付き
assert data != 0 else error("Data must be non-zero");
assert addr < MEM_SIZE else error("Address {addr} out of range");

// 警告（テスト継続）
assert latency < 10 else warning("High latency detected: {latency}");

// expect（ソフトアサーション、失敗してもテスト継続）
expect response == expected else {
    log("Mismatch: got {response}, expected {expected}");
    error_count += 1;
}
```

### 11.2.2 並行アサーション

```rust
// 基本形式
@(clk.posedge) assert req |=> ack;

// 遅延指定
@(clk.posedge) assert req |=> ##1 ack;          // 1サイクル後
@(clk.posedge) assert req |=> ##[1:3] ack;      // 1〜3サイクル後
@(clk.posedge) assert req |=> ##[1:$] ack;      // 1サイクル以上後

// 複合条件
@(clk.posedge) assert (valid && ready) |=> ##1 data_stable;

// エラーメッセージ
@(clk.posedge) assert req |=> ##[1:2] ack
    else error("Protocol violation: ack not received within 2 cycles");
```

### 11.2.3 プロパティ

```rust
// プロパティ定義
property handshake_protocol {
    valid |=> ##[0:$] ready |=> ##1 !valid
}

// プロパティの使用
@(clk.posedge) assert handshake_protocol;

// パラメトリックプロパティ
property response_time[MaxDelay: uint] {
    req |=> ##[1:MaxDelay] ack
}

@(clk.posedge) assert response_time[10];
```

### 11.2.4 シーケンス

```rust
// シーケンス定義
sequence burst_transfer {
    start ##1 data[*4] ##1 end
}

// 繰り返し演算子
// [*n]    : 正確にn回
// [*n:m]  : n〜m回
// [*n:$]  : n回以上
// [+]     : 1回以上（[*1:$]と同等）
// [*]     : 0回以上

// シーケンスの組み合わせ
sequence read_burst {
    cmd == READ ##1 addr_valid ##1 data_valid[*4] ##1 last
}
```

### 11.2.5 assume/restrict

```rust
// 入力制約（フォーマル検証用）
@(clk.posedge) assume valid |-> !$isunknown(data);
@(clk.posedge) assume $onehot(grant);

// 環境制約
@(clk.posedge) restrict reset |=> ##[1:5] !reset;
```

### 11.2.7 三つの検査の違い

`assert`、`expect`、`assume`は同じ形で書くが、違反したときの扱いが異なる。

| 文 | 違反したとき |
|----|-------------|
| `assert` | 報告し、実行の結果を失敗にする |
| `expect` | 報告するが、実行は続き、結果も失敗にしない |
| `assume` | 同上。前提が破れたことを知らせる |

```rust
assert count < 8'd200, "hard check";
expect count < 8'd200, "soft check";
assume count != 8'd255, "premise";
```

`assert`は`else`で重大度を指定できる。
`warning`は報告するが結果を失敗にせず、`fatal`はその場で実行を止める。

### 11.2.8 カバレッジ点（cover）

`cover`は条件が成立した回数を数える。
実行の最後に一覧を表示する。

```rust
cover count == 8'd5, "reached five";
cover valid && ready, "handshake";
```

名前を省くと条件式がそのまま名前になる。
設計中のすべてのカバレッジ点を実行前に登録するため、
一度も成立しなかった点も一覧に出る。
「出力がない」ことと「一度も成立しなかった」ことは区別できなければならない。

---

## 11.3 カバレッジ

### 11.3.1 カバーポイント

```rust
// 基本カバーポイント
@(clk.posedge) cover state == State::Error;
@(clk.posedge) cover valid && ready;

// 条件付きカバー
@(clk.posedge) cover (addr >= 16'h1000 && addr < 16'h2000)
    iff (valid == 1);
```

### 11.3.2 カバーグループ

```rust
covergroup TransactionCoverage(clk: clock) {
    // オプション
    option.per_instance = true;
    option.goal = 100;

    // カバーポイント: 自動ビン
    coverpoint cmd: opcode;  // 全enum値を自動カバー

    // カバーポイント: カスタムビン
    coverpoint addr_range: addr {
        bins low    = [0:255];
        bins mid    = [256:65279];
        bins high   = [65280:65535];
        bins corner = {0, 255, 65535};  // コーナーケース
        illegal_bins reserved = [16'hFF00:16'hFFFF];
    }

    // カバーポイント: 遷移
    coverpoint state_trans: state {
        bins idle_to_run   = (Idle => Run);
        bins run_to_done   = (Run => Done);
        bins any_to_error  = (any => Error);
    }

    // クロスカバレッジ
    cross cmd_addr: cmd, addr_range;
}

// カバーグループの使用
let cov = TransactionCoverage(clk);

// 明示的サンプリング
@(clk.posedge) {
    if valid {
        cov.sample();
    }
}
```

### 11.3.3 コードカバレッジ指示

```rust
// ライン/ブランチカバレッジの除外
#[coverage(exclude)]
comb {
    debug_signal = internal_state;
}

// トグルカバレッジ
#[coverage(toggle)]
let data_bus: bit[32];

// FSM カバレッジ
#[coverage(fsm)]
fsm Controller(...) {
    // 状態と遷移のカバレッジを自動で集める
}
```

---

## 11.4 ランダム化と制約

### 11.4.1 ランダム変数

```rust
// ランダム変数宣言
rand data: bit[32];
rand addr: bit[16];

// 制約付きランダム化
rand packet: Packet {
    constraint size_c {
        size >= 64 && size <= 1518
    }
    constraint addr_c {
        addr inside {[0:255], [1024:2047]}
    }
}
```

### 11.4.1a ランダム化の実行

`$randomize`で、`rand`と付けた変数すべてに新しい値を引く。
`constraint`ブロックに書いた条件をすべて満たすまで引き直す。

```rust
test T {
    rand size: bit[16];

    constraint valid_size {
        size >= 16'd64;
        size <= 16'd1518;
    }

    seq {
        $randomize;
        assert size >= 16'd64, "constraint held";
    }
}
```

**決定性:**

乱数は決まった種から作る。
同じ設計は何度実行しても同じ値を引く。
テストの再現性のために必要であり、
インタプリタとコンパイル型の結果が一致するためにも必要である。

**解き方:**

制約は棄却法で解く。
全変数を引き、全制約を試し、満たすまで繰り返す。
ソルバではないため、めったに満たせない制約は遅くなる。
一定回数（1000回）引いても満たせない場合は、
最後に引いた値を残して警告する。
黙って進めてはならない。

### 11.4.2 制約定義

```rust
constraint valid_transaction {
    // 基本制約
    size >= MIN_SIZE && size <= MAX_SIZE;

    // 条件付き制約
    if (type == BURST) {
        length inside {1, 2, 4, 8, 16};
    }

    // 分布
    data dist {
        0 := 10,            // 重み10
        [1:254] := 80,      // 重み80
        255 := 10           // 重み10
    };
}
```

---

## 11.5 テストモジュール

テストベンチ専用のモジュール定義として`test`キーワードを使用できる。
`test`モジュールはSystemVerilogのテストベンチのトップ階層と同等の役割を持つ。

### 11.5.1 testモジュールの特徴

| 項目 | 内容 |
|------|------|
| キーワード | `test` |
| ポート宣言 | なし（ポートレス） |
| 合成対象 | いいえ（シミュレーション専用） |
| インスタンス化 | 不可（トップレベルのみ） |

### 11.5.2 modとtestの比較

| 項目 | mod | test |
|------|-----|------|
| ポート宣言 | 必須（入出力定義） | なし |
| インスタンス化 | 可能 | 不可（トップレベルのみ） |
| 合成 | 可能 | 不可 |
| 用途 | RTL設計 | テストベンチ |

### 11.5.3 構文

```ebnf
test_mod_def = "test" identifier "{" { test_item } "}" ;

test_item = signal_decl | const_decl | inst_decl | mem_decl | fsm_block
          | comb_block | sync_block | initial_block | seq_block
          | constraint_block
          | use_rust_decl | extern_rust_block | test_stmt ;
```

この文法は`tools/iris.ebnf`および第16章と同一である。

`let`と`var`は`signal_decl`にまとまる。
テストモジュールにはメモリ、FSM、制約ブロックも置ける。

### 11.5.4 基本的なtestモジュール

```rust
test CounterTest {
    // クロック生成
    let clk = Clock.new(period: 10.ns);

    // リセット信号
    let rst: bit = 0;

    // DUTインスタンス化
    let dut = Counter8(
        clk: clk,
        rst: rst,
        enable: 1,
    );

    // テストシーケンス
    initial {
        rst = 1;
        await clk.cycles(5);
        rst = 0;

        await clk.cycles(100);

        assert dut.count == 8'd100
            else error("Counter mismatch");
    }
}
```

### 11.5.5 複数DUTを持つtestモジュール

```rust
test FifoIntegrationTest {
    // クロック生成
    let clk = Clock.new(period: 10.ns);
    let rst: bit = 0;

    // 複数DUTのインスタンス化
    let producer = DataProducer(clk: clk, rst: rst);
    let fifo = SyncFifo[Depth: 16, Width: 8](clk: clk, rst: rst);
    let consumer = DataConsumer(clk: clk, rst: rst);

    // 接続
    comb {
        fifo.wr_en = producer.valid;
        fifo.wr_data = producer.data;
        producer.ready = !fifo.full;

        consumer.valid = !fifo.empty;
        consumer.data = fifo.rd_data;
        fifo.rd_en = consumer.ready && !fifo.empty;
    }

    // テストシーケンス
    initial {
        rst = 1;
        await clk.cycles(5);
        rst = 0;

        // テスト実行
        await until(consumer.done == 1, timeout: 1.ms);

        assert consumer.error_count == 0
            else error("Data integrity check failed");
    }
}
```

### 11.5.6 testモジュールと#[test]アトリビュートの違い

| 項目 | test モジュール | #[test] アトリビュート |
|------|----------------|----------------------|
| 構文 | `test name { }` | `#[test] test name() { }` |
| スコープ | トップレベルモジュール | テストケース（関数相当） |
| 複数DUT | 可能 | 単一DUT想定 |
| 用途 | 統合テスト、大規模テストベンチ | 単体テスト、ユニットテスト |

既存の`#[test]`アトリビュートは単体テスト用途として維持し、新しい`test`モジュールは統合テストや複雑なテストベンチ向けとして使い分ける。

### 11.5.7 SystemVerilog出力

IRISの`test`モジュールは、SystemVerilogのテストベンチトップ階層として出力される。

**IRIS入力**:
```rust
test SimpleTest {
    let clk = Clock.new(period: 10.ns);
    let rst: bit = 0;

    let dut = Counter8(clk: clk, rst: rst, enable: 1);

    initial {
        rst = 1;
        #50;
        rst = 0;
        #1000;
        $finish;
    }
}
```

**SystemVerilog出力**:
```systemverilog
// Generated from IRIS test module
module SimpleTest;  // ポート宣言なし
    // Clock generation
    logic clk;
    initial begin
        clk = 0;
        forever #5 clk = ~clk;  // 10ns period
    end

    // Reset signal
    logic rst;

    // DUT instantiation
    Counter8 dut (
        .clk(clk),
        .rst(rst),
        .enable(1'b1)
    );

    // Test sequence
    initial begin
        rst = 1'b1;
        #50;
        rst = 1'b0;
        #1000;
        $finish;
    end
endmodule
```

---

## 11.6 シーケンシャル処理ブロック（seq）

`seq`ブロックは、テストモジュール内でシーケンシャル（順次）処理を記述するための特殊なブロックである。
`seq`ブロック内ではRust言語の制御構文を直接使用でき、複雑なテストシーケンスを記述できる。

### 11.6.1 seqブロックの特徴

| 項目 | 内容 |
|------|------|
| キーワード | `seq` |
| 使用可能場所 | `test`モジュール内のみ |
| 合成対象 | いいえ（シミュレーション専用） |
| 実行モデル | シーケンシャル（手続き的） |
| Rust統合 | Rustの制御構文を直接使用可能 |

### 11.6.2 構文定義

```ebnf
seq_block = "seq" [ identifier ] "{" { seq_statement } "}" ;

seq_statement = rust_statement | signal_access | time_control
              | assert_stmt | cover_stmt
              | seq_if_stmt | seq_for_stmt | seq_while_stmt
              | break_stmt | continue_stmt | assign_stmt ;

signal_access = signal_read | signal_write ;
signal_read = signal_path ".value()" ;
signal_write = signal_path ".set(" expr ")" ;
signal_path = identifier { "." identifier } ;

time_control = await_stmt | delay_stmt ;
await_stmt = "await" await_expr ";" ;
delay_stmt = "#" ( number | duration ) ";" ;
```

この文法は`tools/iris.ebnf`および第16章と同一である。

`seq`ブロックには分岐と繰り返し、カバレッジも書ける。
遅延は`#10;`のように単位を省いても書ける。

### 11.6.3 基本的なseqブロック

```rust
test CounterVerification {
    let clk = Clock.new(period: 10.ns);
    let rst: bit = 0;
    let dut = Counter8(clk: clk, rst: rst, enable: 1);

    seq main {
        // リセットシーケンス
        rst.set(1);
        #50;  // 50ns待機
        rst.set(0);

        // Rustのfor文を使用したテストシーケンス
        for cycle in 0..100 {
            await clk.posedge;
            let count_val = dut.count.value();

            if count_val != (cycle as u8) {
                panic!("Counter mismatch at cycle {}: expected {}, got {}",
                       cycle, cycle, count_val);
            }
        }

        println!("Counter test passed!");
    }
}
```

### 11.6.4 信号アクセスAPI

seqブロック内では、DUTの信号に対して以下のAPIを使用してアクセスする。

| API | 説明 | 例 |
|-----|------|-----|
| `.value()` | 信号の現在値を読み取り | `let v = dut.count.value();` |
| `.set(val)` | 信号に値を設定 | `dut.data.set(0xFF);` |
| `.posedge()` | 立ち上がりエッジまで待機 | `await clk.posedge();` |
| `.negedge()` | 立ち下がりエッジまで待機 | `await clk.negedge();` |
| `.changed()` | 信号変化まで待機 | `await dut.ready.changed();` |

### 11.6.5 時間制御

```rust
seq timing_test {
    // 絶対時間待機
    #10;          // 10単位時間（デフォルトns）待機
    #100.ns;      // 100ナノ秒待機
    #1.us;        // 1マイクロ秒待機

    // クロックサイクル待機
    await clk.posedge;              // 次の立ち上がりエッジまで
    await clk.negedge;              // 次の立ち下がりエッジまで
    await clk.cycles(10);           // 10クロックサイクル待機

    // 条件待機
    await until(dut.ready.value() == 1);
    await until(dut.done.value() == 1, timeout: 1.ms);

    // イベント待機
    await event(dut.interrupt);
}
```

### 11.6.6 Rust制御構文の使用

seqブロック内ではRustの全ての制御構文が使用可能。

```rust
seq complex_test {
    // for文
    for i in 0..256 {
        dut.data_in.set(i as u8);
        await clk.posedge;
    }

    // while文
    let mut timeout_count = 0;
    while dut.busy.value() == 1 && timeout_count < 1000 {
        await clk.posedge;
        timeout_count += 1;
    }

    // if文
    if dut.error.value() == 1 {
        println!("Error detected!");
        return;
    }

    // match文
    match dut.state.value() {
        0 => println!("Idle"),
        1 => println!("Running"),
        2 => println!("Done"),
        _ => println!("Unknown state"),
    }

    // loop文
    loop {
        await clk.posedge;
        if dut.done.value() == 1 {
            break;
        }
    }
}
```

### 11.6.7 複数seqブロックの並列実行

複数のseqブロックを定義すると並列に実行される。

```rust
test ParallelTest {
    let clk = Clock.new(period: 10.ns);
    let dut = DualPortMemory(clk: clk);

    // 書き込みポートのシーケンス
    seq writer {
        for addr in 0..256 {
            dut.wr_addr.set(addr as u16);
            dut.wr_data.set((addr * 2) as u8);
            dut.wr_en.set(1);
            await clk.posedge;
        }
        dut.wr_en.set(0);
    }

    // 読み出しポートのシーケンス（遅延して開始）
    seq reader {
        #100.ns;  // 書き込みが進んでから開始
        for addr in 0..256 {
            dut.rd_addr.set(addr as u16);
            await clk.posedge;
            let expected = (addr * 2) as u8;
            let actual = dut.rd_data.value();
            assert!(actual == expected,
                    "Read mismatch at addr {}: expected {}, got {}",
                    addr, expected, actual);
        }
    }
}
```

### 11.6.8 シミュレーション時間とseqブロックの関係

| 操作 | シミュレーション時間 |
|------|---------------------|
| Rustコード実行 | ゼロ時間（進まない） |
| `#delay` | 指定時間分進む |
| `await clk.posedge` | 次のエッジまで進む |
| `await until(...)` | 条件成立まで進む |
| `.set(val)` | 即座に反映（デルタサイクル） |
| `.value()` | 現在値を読み取り |

### 11.6.9 seqブロックとinitialブロックの比較

| 項目 | seq | initial |
|------|-----|---------|
| Rust構文 | 完全サポート | 限定的 |
| 並列実行 | 複数定義で並列 | 単一 |
| 外部Rust関数 | 呼び出し可能 | 不可 |
| 用途 | 複雑なテストシーケンス | シンプルなテスト |

---

## 11.7 外部Rust関数の直接呼び出し

`seq`ブロック内から外部の`.rs`ファイルで定義されたRust関数を直接呼び出すことができる。
これにより、テストヘルパー関数、データ生成、検証ロジックなどをRustで実装し、テストベンチから利用できる。

### 11.7.1 概要

| 項目 | 内容 |
|------|------|
| 使用可能場所 | `seq`ブロック内 |
| インポート方法 | `use rust::` または `extern rust` |
| Rustファイル | 標準的な`.rs`ファイル |
| 機能 | Rustの完全な機能を利用可能 |

### 11.7.2 インポート構文

#### use rust:: 宣言

```rust
// 単一関数のインポート
use rust::test_utils::expected_count;

// 複数関数のインポート
use rust::test_utils::{expected_count, verify_counter, generate_stimulus};

// ワイルドカードインポート
use rust::test_utils::*;

// モジュール全体のインポート（完全修飾名で使用）
use rust::test_utils;
```

#### extern rust ブロック

**この構文は基準実装がまだ読めない。**

関数シグネチャを明示的に宣言する方法。

```rust
extern rust "test_utils" {
    fn expected_count(cycles: u32) -> u8;
    fn verify_counter(dut_count: u8, expected: u8, cycle: u32);
    fn generate_random_data(seed: u64) -> Vec<u8>;
}
```

### 11.7.3 Rust側の実装

外部Rust関数は、プロジェクトの`rust/`ディレクトリに配置する。

**ファイル構造:**
```
project/
├── iris.toml
├── src/
│   └── design.iris
├── test/
│   └── counter_test.iris
└── rust/
    ├── mod.rs              # ルートモジュール
    └── test_utils.rs       # テストユーティリティ
```

**rust/test_utils.rs:**
```rust
//! テストユーティリティ関数

/// 期待されるカウンタ値を計算
pub fn expected_count(cycles: u32) -> u8 {
    (cycles % 256) as u8
}

/// カウンタ値を検証
pub fn verify_counter(dut_count: u8, expected: u8, cycle: u32) {
    if dut_count != expected {
        panic!("Counter mismatch at cycle {}: expected {}, got {}",
               cycle, expected, dut_count);
    }
}

/// ランダムデータを生成
pub fn generate_random_data(seed: u64) -> Vec<u8> {
    use rand::{SeedableRng, Rng};
    let mut rng = rand::rngs::StdRng::seed_from_u64(seed);
    (0..256).map(|_| rng.gen()).collect()
}
```

**rust/mod.rs:**
```rust
pub mod test_utils;
```

### 11.7.4 使用例

```rust
// test/counter_test.iris
use rust::test_utils::{expected_count, verify_counter};

test CounterVerification {
    let clk = Clock.new(period: 10.ns);
    let rst: bit = 0;
    let dut = Counter8(clk: clk, rst: rst, enable: 1);

    seq main {
        // リセット
        rst.set(1);
        #50;
        rst.set(0);

        // 外部Rust関数を使用したテスト
        for cycle in 0..100u32 {
            await clk.posedge;

            // 期待値を外部関数で計算
            let expected = expected_count(cycle);

            // 検証も外部関数で実行
            verify_counter(dut.count.value(), expected, cycle);
        }

        println!("All {} cycles verified successfully!", 100);
    }
}
```

### 11.7.5 非同期関数のサポート

Rust側で`async fn`として定義した関数は、`seq`ブロック内で`await`を使用して呼び出す。

**rust/async_utils.rs:**
```rust
use std::time::Duration;

/// 非同期でタイムアウト付き待機
pub async fn wait_with_timeout(timeout_ms: u64) -> bool {
    tokio::time::sleep(Duration::from_millis(timeout_ms)).await;
    true
}

/// 非同期でデータをフェッチ
pub async fn fetch_test_vectors(url: &str) -> Vec<u8> {
    // 外部リソースからテストベクタを取得
    // ...
    vec![]
}
```

**IRIS側での使用:**
```rust
use rust::async_utils::{wait_with_timeout, fetch_test_vectors};

test AsyncTest {
    seq main {
        // 非同期関数の呼び出し
        let success = wait_with_timeout(1000).await;

        // テストベクタの非同期取得
        let vectors = fetch_test_vectors("https://example.com/vectors").await;

        for data in vectors {
            dut.input.set(data);
            await clk.posedge;
        }
    }
}
```

### 11.7.6 IRIS-Rust型マッピング

| IRIS型 | Rust型 | 備考 |
|--------|--------|------|
| `bit` | `bool` | 単一ビット |
| `bit[8]` | `u8` | 8ビット符号なし |
| `bit[16]` | `u16` | 16ビット符号なし |
| `bit[32]` | `u32` | 32ビット符号なし |
| `bit[64]` | `u64` | 64ビット符号なし |
| `bit[N]` (N > 64) | `[u8; (N+7)/8]` | バイト配列 |
| `i8`, `i16`, `i32`, `i64` | `i8`, `i16`, `i32`, `i64` | 符号付き整数 |
| `bool` | `bool` | 論理型 |
| `Signal<T>` | `iris_runtime::Signal<T>` | 信号ハンドル |

### 11.7.7 エラーハンドリング

外部Rust関数でのエラーは、Rustの標準的なエラーハンドリング機構を使用する。

```rust
// rust/validators.rs
use std::result::Result;

#[derive(Debug)]
pub struct ValidationError {
    pub message: String,
    pub cycle: u32,
}

pub fn validate_protocol(
    valid: bool,
    ready: bool,
    data: u8,
    cycle: u32
) -> Result<(), ValidationError> {
    if valid && !ready {
        return Err(ValidationError {
            message: format!("Valid asserted without ready at cycle {}", cycle),
            cycle,
        });
    }
    Ok(())
}
```

**IRIS側:**
```rust
use rust::validators::validate_protocol;

test ProtocolTest {
    seq main {
        for cycle in 0..1000u32 {
            await clk.posedge;

            // Result型を処理
            match validate_protocol(
                dut.valid.value(),
                dut.ready.value(),
                dut.data.value(),
                cycle
            ) {
                Ok(()) => {},
                Err(e) => {
                    println!("Protocol violation: {:?}", e);
                    break;
                }
            }
        }
    }
}
```

### 11.7.8 セキュリティに関する注意

外部Rust関数は任意のRustコードを実行できるため、以下の点に注意が必要:

- 信頼できるソースからのコードのみを使用する
- ファイルI/Oやネットワークアクセスは意図した場合のみ使用する
- 本番環境のシミュレーション時は外部関数の動作を確認する

---

[<< メモリ](./10_memory.md) | [目次](./iris_spec.md) | [パッケージシステム >>](./12_package_system.md)
