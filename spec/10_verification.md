# 第10章 検証機能

[<< メモリ](./09_memory.md) | [目次](./iris_spec_0.1.0.md) | [パッケージシステム >>](./11_package_system.md)

---

## 10.1 テスト構文

### 10.1.1 基本テストブロック

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

### 10.1.2 テストアトリビュート

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

### 10.1.3 パラメトリックテスト

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

### 10.1.4 シミュレーション制御

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

### 10.1.5 並列実行

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

### 10.1.6 テストフィクスチャ

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

## 10.2 アサーション

### 10.2.1 即時アサーション

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

### 10.2.2 並行アサーション

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

### 10.2.3 プロパティ

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

### 10.2.4 シーケンス

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

### 10.2.5 assume/restrict

```rust
// 入力制約（フォーマル検証用）
@(clk.posedge) assume valid |-> !$isunknown(data);
@(clk.posedge) assume $onehot(grant);

// 環境制約
@(clk.posedge) restrict reset |=> ##[1:5] !reset;
```

---

## 10.3 カバレッジ

### 10.3.1 カバーポイント

```rust
// 基本カバーポイント
@(clk.posedge) cover state == State::Error;
@(clk.posedge) cover valid && ready;

// 条件付きカバー
@(clk.posedge) cover (addr >= 16'h1000 && addr < 16'h2000)
    iff (valid == 1);
```

### 10.3.2 カバーグループ

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

### 10.3.3 コードカバレッジ指示

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
    // 状態・遷移カバレッジ自動収集
}
```

---

## 10.4 ランダム化と制約

### 10.4.1 ランダム変数

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

### 10.4.2 制約定義

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

[<< メモリ](./09_memory.md) | [目次](./iris_spec_0.1.0.md) | [パッケージシステム >>](./11_package_system.md)
