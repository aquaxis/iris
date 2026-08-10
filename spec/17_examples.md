# 第17章 サンプルコード集

[<< 文法定義](./16_grammar.md) | [目次](./iris_spec.md) | [用語集 >>](./18_glossary.md)

---

## 17.1 基本的なカウンタ

```rust
/// 8ビットカウンタ
mod Counter8(
    in  clk: clock,
    in  rst: reset,
    in  enable: bit,
    out count: bit[8],
) {
    let counter: bit[8] = 0;

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

---

## 17.2 パラメータ化カウンタ

```rust
/// パラメータ化されたカウンタ
mod Counter[Width: uint = 8](
    in  clk: clock,
    in  rst: reset,
    in  enable: bit,
    in  load: bit,
    in  data: bit[Width],
    out count: bit[Width],
    out overflow: bit,
) {
    let counter: bit[Width] = 0;

    sync(clk.posedge, rst.async) {
        if load {
            counter = data;
        } else if enable {
            counter = counter + 1;
        }
    }

    comb {
        count = counter;
        overflow = enable && (counter == {Width{1'b1}});
    }
}
```

---

## 17.3 パラメータ化FIFO

```rust
/// 同期FIFO
mod SyncFifo[Width: uint = 8, Depth: uint = 16](
    in  clk: clock,
    in  rst: reset,
    in  push: bit,
    in  pop: bit,
    in  din: bit[Width],
    out dout: bit[Width],
    out full: bit,
    out empty: bit,
) {
    const ADDR_WIDTH: uint = $clog2(Depth);

    mem buffer: bit[Width][Depth];
    let wr_ptr: bit[ADDR_WIDTH] = 0;
    let rd_ptr: bit[ADDR_WIDTH] = 0;
    let fifo_count: bit[ADDR_WIDTH + 1] = 0;

    sync(clk.posedge, rst.async) {
        if push && !full {
            buffer[wr_ptr] = din;
            wr_ptr = wr_ptr + 1;
            fifo_count = fifo_count + 1;
        }
        if pop && !empty {
            rd_ptr = rd_ptr + 1;
            fifo_count = fifo_count - 1;
        }
    }

    comb {
        dout = buffer[rd_ptr];
        full = fifo_count == Depth;
        empty = fifo_count == 0;
    }
}
```

---

## 17.4 ALU（算術論理演算ユニット）

```rust
/// 4機能ALU
mod Alu[Width: uint = 8](
    in  a: bit[Width],
    in  b: bit[Width],
    in  op: bit[2],
    out result: bit[Width],
    out zero: bit,
    out carry: bit,
) {
    let extended: bit[Width + 1];

    comb {
        extended = match op {
            2'b00 => a.extend[Width + 1]() + b.extend[Width + 1](),  // ADD
            2'b01 => a.extend[Width + 1]() - b.extend[Width + 1](),  // SUB
            2'b10 => {1'b0, a & b},                                   // AND
            2'b11 => {1'b0, a | b},                                   // OR
        };
        result = extended[Width - 1:0];
        carry = extended[Width];
        zero = result == 0;
    }
}
```

---

## 17.5 シフトレジスタ

```rust
/// パラメータ化シフトレジスタ
mod ShiftRegister[Width: uint = 8, Depth: uint = 4](
    in  clk: clock,
    in  rst: reset,
    in  enable: bit,
    in  din: bit[Width],
    out dout: bit[Width],
    out parallel_out: bit[Width][Depth],
) {
    let stages: bit[Width][Depth] = [0; Depth];

    sync(clk.posedge, rst.async) {
        if enable {
            stages[0] = din;
            for i in 1..Depth {
                stages[i] = stages[i - 1];
            }
        }
    }

    comb {
        dout = stages[Depth - 1];
        parallel_out = stages;
    }
}
```

---

## 17.6 FSM例：UARTトランスミッタ制御

```rust
mod UartTxFsm(
    in  clk: clock,
    in  rst: reset,
    in  start: bit,
    in  bit_done: bit,
    in  byte_done: bit,
    out tx_en: bit,
    out shift_en: bit,
    out busy: bit,
) {
    fsm Controller(clk.posedge, rst.async) {
        state enum {
            Idle    [tx_en = 0, shift_en = 0, busy = 0],
            Start   [tx_en = 1, shift_en = 0, busy = 1],
            Data    [tx_en = 1, shift_en = 1, busy = 1],
            Stop    [tx_en = 1, shift_en = 0, busy = 1]
        }

        transitions {
            Idle => {
                when start { goto Start; }
            }
            Start => {
                when bit_done { goto Data; }
            }
            Data => {
                when byte_done { goto Stop; }
            }
            Stop => {
                when bit_done { goto Idle; }
            }
        }
    }
}
```

---

## 17.7 AXI-Lite スレーブ

```rust
import iris_std::axi::AxiLite;

mod AxiLiteRegs[NumRegs: uint = 4](
    in clk: clock,
    in rst: reset,
    target axi: AxiLite,
    out regs: bit[32][NumRegs],
) {
    let registers: bit[32][NumRegs] = [0; NumRegs];
    let aw_ready: bit = 1;
    let w_ready: bit = 1;
    let b_valid: bit = 0;
    let ar_ready: bit = 1;
    let r_valid: bit = 0;
    let r_data: bit[32] = 0;

    // 書き込みロジック
    sync(clk.posedge, rst.async) {
        if axi.awvalid && aw_ready && axi.wvalid && w_ready {
            let addr: bit[2] = axi.awaddr[3:2];
            registers[addr] = axi.wdata;
            b_valid = 1;
        }
        if axi.bready && b_valid {
            b_valid = 0;
        }
    }

    // 読み出しロジック
    sync(clk.posedge, rst.async) {
        if axi.arvalid && ar_ready {
            let addr: bit[2] = axi.araddr[3:2];
            r_data = registers[addr];
            r_valid = 1;
        }
        if axi.rready && r_valid {
            r_valid = 0;
        }
    }

    // 出力接続（組み合わせ論理）
    comb {
        axi.awready = aw_ready;
        axi.wready = w_ready;
        axi.bvalid = b_valid;
        axi.bresp = 2'b00;
        axi.arready = ar_ready;
        axi.rvalid = r_valid;
        axi.rdata = r_data;
        axi.rresp = 2'b00;
        regs = registers;
    }
}
```

---

## 17.8 優先度エンコーダ

```rust
/// パラメータ化優先度エンコーダ
mod PriorityEncoder[Width: uint = 8](
    in  request: bit[Width],
    out grant: bit[$clog2(Width)],
    out valid: bit,
) {
    comb {
        valid = request.or_reduce();
        grant = 0;
        for i in 0..Width {
            if request[i] {
                grant = i as bit[$clog2(Width)];
            }
        }
    }
}
```

---

## 17.9 デュアルポートRAM

```rust
mod DualPortRam[Width: uint = 32, Depth: uint = 1024](
    in  clk: clock,
    // ポートA
    in  a_we: bit,
    in  a_addr: bit[$clog2(Depth)],
    in  a_wdata: bit[Width],
    out a_rdata: bit[Width],
    // ポートB
    in  b_we: bit,
    in  b_addr: bit[$clog2(Depth)],
    in  b_wdata: bit[Width],
    out b_rdata: bit[Width],
) {
    #[synthesis(ram_style = "block")]
    mem storage: bit[Width][Depth] {
        ports: 2,
        type: true_dual_port,
        read_mode: read_first
    };

    sync(clk.posedge) {
        // ポートA
        if a_we {
            storage[a_addr] = a_wdata;
        }
        a_rdata = storage[a_addr];

        // ポートB
        if b_we {
            storage[b_addr] = b_wdata;
        }
        b_rdata = storage[b_addr];
    }
}
```

---

## 17.10 パイプライン乗算器

```rust
/// 3段パイプライン乗算器
mod PipelinedMultiplier[Width: uint = 16](
    in  clk: clock,
    in  rst: reset,
    in  valid_in: bit,
    in  a: bit[Width],
    in  b: bit[Width],
    out valid_out: bit,
    out product: bit[Width * 2],
) {
    // パイプラインレジスタ
    let stage1_a: bit[Width] = 0;
    let stage1_b: bit[Width] = 0;
    let stage1_valid: bit = 0;

    let stage2_partial: bit[Width * 2] = 0;
    let stage2_valid: bit = 0;

    let stage3_product: bit[Width * 2] = 0;
    let stage3_valid: bit = 0;

    sync(clk.posedge, rst.async) {
        // ステージ1: 入力ラッチ
        stage1_a = a;
        stage1_b = b;
        stage1_valid = valid_in;

        // ステージ2: 乗算実行
        stage2_partial = stage1_a * stage1_b;
        stage2_valid = stage1_valid;

        // ステージ3: 出力ラッチ
        stage3_product = stage2_partial;
        stage3_valid = stage2_valid;
    }

    comb {
        valid_out = stage3_valid;
        product = stage3_product;
    }
}
```

---

## 17.11 クロックドメイン交差（CDC）

```rust
/// 2段フリップフロップ同期化器
mod Synchronizer[Width: uint = 1](
    in  clk_dst: clock,
    in  rst: reset,
    in  async_in: bit[Width],
    out sync_out: bit[Width],
) {
    let sync_ff1: bit[Width] = 0;
    let sync_ff2: bit[Width] = 0;

    #[allow(cdc_crossing)]
    sync(clk_dst.posedge, rst.async) {
        sync_ff1 = async_in;
        sync_ff2 = sync_ff1;
    }

    comb {
        sync_out = sync_ff2;
    }
}
```

---

## 17.12 PWMジェネレータ

```rust
/// パルス幅変調（PWM）ジェネレータ
mod PwmGenerator[Width: uint = 8](
    in  clk: clock,
    in  rst: reset,
    in  enable: bit,
    in  duty: bit[Width],       // デューティ比（0〜2^Width-1）
    in  period: bit[Width],     // 周期（カウント値）
    out pwm_out: bit,
    out cycle_done: bit,
) {
    var counter: bit[Width] = 0;
    var pwm_reg: bit = 0;
    var done_reg: bit = 0;

    sync(clk.posedge, rst.async) {
        done_reg = 0;

        if enable {
            if counter >= period {
                counter = 0;
                done_reg = 1;
            } else {
                counter = counter + 1;
            }

            // デューティ比に基づいてPWM出力を設定
            pwm_reg = (counter < duty) ? 1'b1 : 1'b0;
        } else {
            counter = 0;
            pwm_reg = 0;
        }
    }

    comb {
        pwm_out = pwm_reg;
        cycle_done = done_reg;
    }
}
```

---

## 17.13 タイマーモジュール

```rust
/// プログラマブルタイマー
mod Timer[Width: uint = 32](
    in  clk: clock,
    in  rst: reset,
    in  enable: bit,
    in  mode: bit[2],           // 00: ワンショット, 01: 連続, 10: カウントアップ
    in  load: bit,
    in  load_value: bit[Width],
    out count: bit[Width],
    out timeout: bit,
    out running: bit,
) {

    const MODE_ONESHOT: bit[2] = 2'b00;
    const MODE_CONTINUOUS: bit[2] = 2'b01;
    const MODE_COUNTUP: bit[2] = 2'b10;

    var counter: bit[Width] = 0;
    var timeout_reg: bit = 0;
    var running_reg: bit = 0;

    sync(clk.posedge, rst.async) {
        timeout_reg = 0;

        if load {
            counter = load_value;
            running_reg = 1;
        } else if enable && running_reg {
            match mode {
                MODE_COUNTUP => {
                    if counter == load_value {
                        timeout_reg = 1;
                        counter = 0;
                    } else {
                        counter = counter + 1;
                    }
                }
                _ => {
                    // カウントダウンモード
                    if counter == 0 {
                        timeout_reg = 1;
                        if mode == MODE_CONTINUOUS {
                            counter = load_value;
                        } else {
                            running_reg = 0;
                        }
                    } else {
                        counter = counter - 1;
                    }
                }
            }
        }
    }

    comb {
        count = counter;
        timeout = timeout_reg;
        running = running_reg;
    }
}
```

---

## 17.14 SPIマスターコントローラ

```rust
/// SPI マスターコントローラ（Mode 0: CPOL=0, CPHA=0）
mod SpiMaster[DataWidth: uint = 8](
    in  clk: clock,
    in  rst: reset,
    // 制御インターフェース
    in  start: bit,
    in  tx_data: bit[DataWidth],
    out rx_data: bit[DataWidth],
    out busy: bit,
    out done: bit,
    // SPI インターフェース
    out sclk: bit,
    out mosi: bit,
    in  miso: bit,
    out cs_n: bit,
    // クロック分周設定
    in  clk_div: bit[8],
) {
    var spi_state: bit[2] = 0;
    var bit_count: bit[$clog2(DataWidth)] = 0;
    var clk_count: bit[8] = 0;
    var shift_reg: bit[DataWidth] = 0;
    var rx_reg: bit[DataWidth] = 0;
    var sclk_reg: bit = 0;
    var done_reg: bit = 0;

    const STATE_IDLE: bit[2] = 2'b00;
    const STATE_LOAD: bit[2] = 2'b01;
    const STATE_SHIFT: bit[2] = 2'b10;
    const STATE_DONE: bit[2] = 2'b11;

    sync(clk.posedge, rst.async) {
        done_reg = 0;

        match spi_state {
            STATE_IDLE => {
                sclk_reg = 0;
                if start {
                    shift_reg = tx_data;
                    bit_count = DataWidth - 1;
                    clk_count = 0;
                    spi_state = STATE_LOAD;
                }
            }
            STATE_LOAD => {
                // データをMOSIにセット
                spi_state = STATE_SHIFT;
            }
            STATE_SHIFT => {
                if clk_count == clk_div {
                    clk_count = 0;
                    if sclk_reg == 0 {
                        // 立ち上がりエッジ：MISOをサンプル
                        sclk_reg = 1;
                        rx_reg = {rx_reg[DataWidth-2:0], miso};
                    } else {
                        // 立ち下がりエッジ：次のビットをシフト
                        sclk_reg = 0;
                        if bit_count == 0 {
                            spi_state = STATE_DONE;
                        } else {
                            bit_count = bit_count - 1;
                            shift_reg = {shift_reg[DataWidth-2:0], 1'b0};
                        }
                    }
                } else {
                    clk_count = clk_count + 1;
                }
            }
            STATE_DONE => {
                done_reg = 1;
                spi_state = STATE_IDLE;
            }
        }
    }

    comb {
        sclk = sclk_reg;
        mosi = shift_reg[DataWidth - 1];
        cs_n = (spi_state == STATE_IDLE) ? 1'b1 : 1'b0;
        rx_data = rx_reg;
        busy = (spi_state != STATE_IDLE);
        done = done_reg;
    }
}
```

---

## 17.15 I2Cマスターコントローラ

```rust
/// I2C マスターコントローラ（簡易版）
mod I2cMaster(
    in  clk: clock,
    in  rst: reset,
    // 制御インターフェース
    in  start: bit,
    in  stop: bit,
    in  write: bit,
    in  tx_data: bit[8],
    out rx_data: bit[8],
    out ack: bit,
    out busy: bit,
    out done: bit,
    // I2C インターフェース
    inout sda: bit,
    out scl: bit,
    // クロック分周設定
    in  clk_div: bit[8],
) {
    // 状態定義
    enum State {
        Idle,
        StartBit,
        SendBit,
        ReadAck,
        RecvBit,
        SendAck,
        StopBit,
        Complete
    }

    var i2c_state: State = State::Idle;
    var bit_count: bit[3] = 0;
    var clk_count: bit[8] = 0;
    var phase: bit[2] = 0;  // SCLサイクル内のフェーズ
    var shift_reg: bit[8] = 0;
    var rx_reg: bit[8] = 0;
    var ack_reg: bit = 0;
    var scl_reg: bit = 1;
    var sda_out: bit = 1;
    var sda_oe: bit = 0;
    var done_reg: bit = 0;

    sync(clk.posedge, rst.async) {
        done_reg = 0;

        if clk_count < clk_div {
            clk_count = clk_count + 1;
        } else {
            clk_count = 0;
            phase = phase + 1;

            match i2c_state {
                State::Idle => {
                    scl_reg = 1;
                    sda_out = 1;
                    sda_oe = 0;
                    if start {
                        i2c_state = State::StartBit;
                        phase = 0;
                    }
                }
                State::StartBit => {
                    sda_oe = 1;
                    match phase {
                        2'b00 => { sda_out = 1; scl_reg = 1; }
                        2'b01 => { sda_out = 0; }  // START条件
                        2'b10 => { scl_reg = 0; }
                        2'b11 => {
                            if write {
                                shift_reg = tx_data;
                                bit_count = 7;
                                i2c_state = State::SendBit;
                            } else {
                                bit_count = 7;
                                i2c_state = State::RecvBit;
                            }
                            phase = 0;
                        }
                    }
                }
                State::SendBit => {
                    sda_oe = 1;
                    match phase {
                        2'b00 => { sda_out = shift_reg[7]; }
                        2'b01 => { scl_reg = 1; }
                        2'b10 => { scl_reg = 0; }
                        2'b11 => {
                            shift_reg = {shift_reg[6:0], 1'b0};
                            if bit_count == 0 {
                                i2c_state = State::ReadAck;
                            } else {
                                bit_count = bit_count - 1;
                            }
                            phase = 0;
                        }
                    }
                }
                State::ReadAck => {
                    sda_oe = 0;  // SDAを解放
                    match phase {
                        2'b01 => { scl_reg = 1; }
                        2'b10 => { ack_reg = !sda; }  // ACK=0はACK
                        2'b11 => {
                            scl_reg = 0;
                            if stop {
                                i2c_state = State::StopBit;
                            } else {
                                i2c_state = State::Complete;
                            }
                            phase = 0;
                        }
                        _ => {}
                    }
                }
                State::StopBit => {
                    sda_oe = 1;
                    match phase {
                        2'b00 => { sda_out = 0; }
                        2'b01 => { scl_reg = 1; }
                        2'b10 => { sda_out = 1; }  // STOP条件
                        2'b11 => {
                            sda_oe = 0;
                            i2c_state = State::Complete;
                            phase = 0;
                        }
                    }
                }
                State::Complete => {
                    done_reg = 1;
                    i2c_state = State::Idle;
                }
                _ => {
                    i2c_state = State::Idle;
                }
            }
        }
    }

    comb {
        scl = scl_reg;
        sda = sda_oe ? sda_out : 1'bz;  // トライステート
        rx_data = rx_reg;
        ack = ack_reg;
        busy = (i2c_state != State::Idle);
        done = done_reg;
    }
}
```

---

## 17.16 信号宣言パターン集

このセクションでは、`let`、`let mut`、`var`宣言を各コンテキスト（comb、sync、fsm）で使用するパターンを示します。

### 17.16.1 let宣言のパターン

#### combでの使用（組み合わせ回路）

```rust
/// let + 直接代入による組み合わせ回路
mod LetCombExample(
    in  a: bit[8],
    in  b: bit[8],
    in  sel: bit,
    out sum: bit[8],
    out mux_out: bit[8],
) {
    // let + 直接代入 → 組み合わせ回路
    let temp = a + b;

    comb {
        sum = temp;
        // comb内でのlet（ローカル変数として使用）
        let selected = if sel { a } else { b };
        mux_out = selected;
    }
}
```

#### syncでの使用（順序回路）

```rust
/// let（宣言のみ）+ sync内代入による順序回路
mod LetSyncExample(
    in  clk: clock,
    in  rst: reset,
    in  data_in: bit[8],
    out data_out: bit[8],
) {
    // let（宣言のみ）→ syncで使用すると順序回路
    let reg_data: bit[8];

    sync(clk.posedge, rst.async) {
        reg_data = data_in;
    }

    comb {
        data_out = reg_data;
    }
}
```

#### fsmでの使用（順序回路）

```rust
/// let（宣言のみ）+ fsm内代入による順序回路
mod LetFsmExample(
    in  clk: clock,
    in  rst: reset,
    in  start: bit,
    out busy: bit,
    out count: bit[4],
) {
    // let（宣言のみ）→ fsmで使用すると順序回路
    let counter: bit[4];

    fsm Controller(clk.posedge, rst.async) {
        state enum {
            Idle  [busy = 0],
            Active[busy = 1]
        }

        transitions {
            Idle => {
                when start {
                    counter = 0;
                    goto Active;
                }
            }
            Active => {
                counter = counter + 1;
                when counter == 15 { goto Idle; }
            }
        }
    }

    comb {
        count = counter;
    }
}
```

### 17.16.2 let mut宣言のパターン

#### combでの使用（累積計算用ローカル変数）

```rust
/// comb内でのlet mut（累積計算用）
mod LetMutCombExample(
    in  values: bit[8][4],
    out max_value: bit[8],
    out sum_value: bit[10],
) {
    comb {
        // let mutを累積計算に使用
        let mut max: bit[8] = values[0];
        let mut sum: bit[10] = 0;

        for i in 0..4 {
            if values[i] > max {
                max = values[i];
            }
            sum = sum + values[i].extend[10]();
        }

        max_value = max;
        sum_value = sum;
    }
}
```

#### syncでの使用（順序回路 + リセット値）

```rust
/// let mut + 初期値 → sync使用で順序回路（初期値がリセット値）
mod LetMutSyncExample(
    in  clk: clock,
    in  rst: reset,
    in  enable: bit,
    in  load: bit,
    in  data: bit[8],
    out count: bit[8],
) {
    // let mut + 初期値 → 順序回路（0がリセット値）
    let mut counter: bit[8] = 0;

    sync(clk.posedge, rst.async) {
        if load {
            counter = data;
        } else if enable {
            counter = counter + 1;
        }
    }

    comb {
        count = counter;
    }
}
```

#### fsmでの使用（順序回路 + リセット値）

```rust
/// let mut + 初期値 → fsm使用で順序回路（初期値がリセット値）
mod LetMutFsmExample(
    in  clk: clock,
    in  rst: reset,
    in  start: bit,
    in  threshold: bit[8],
    out done: bit,
    out result: bit[8],
) {
    // let mut + 初期値 → 順序回路（0がリセット値）
    let mut accumulator: bit[8] = 0;

    fsm Processor(clk.posedge, rst.async) {
        state enum {
            Idle    [done = 0],
            Compute [done = 0],
            Done    [done = 1]
        }

        transitions {
            Idle => {
                when start {
                    accumulator = 0;
                    goto Compute;
                }
            }
            Compute => {
                accumulator = accumulator + 1;
                when accumulator >= threshold { goto Done; }
            }
            Done => {
                result = accumulator;
                when !start { goto Idle; }
            }
        }
    }
}
```

### 17.16.3 var宣言のパターン

**注意**: `var`宣言は`sync`または`fsm`ブロックでのみ使用可能です。

#### syncでの使用（順序回路専用）

```rust
/// var → sync/fsmでのみ使用可能（順序回路専用）
mod VarSyncExample(
    in  clk: clock,
    in  rst: reset,
    in  load: bit,
    in  shift: bit,
    in  data: bit[8],
    out q: bit[8],
    out serial_out: bit,
) {
    // var → 順序回路専用（sync/fsmでのみ使用可能）
    var reg: bit[8] = 0;

    sync(clk.posedge, rst.async) {
        if load {
            reg = data;
        } else if shift {
            reg = {reg[6:0], 1'b0};
        }
    }

    comb {
        q = reg;
        serial_out = reg[7];
    }
}
```

#### fsmでの使用（順序回路専用）

```rust
/// var → fsmで使用（順序回路専用）
mod VarFsmExample(
    in  clk: clock,
    in  rst: reset,
    in  start: bit,
    in  data_in: bit[8],
    out data_out: bit[8],
    out valid: bit,
) {
    // var → fsmで使用（順序回路専用）
    var buffer: bit[8] = 0;
    var cycle_count: bit[4] = 0;

    fsm Pipeline(clk.posedge, rst.async) {
        state enum {
            Idle    [valid = 0],
            Load    [valid = 0],
            Process [valid = 0],
            Output  [valid = 1]
        }

        transitions {
            Idle => {
                when start {
                    goto Load;
                }
            }
            Load => {
                buffer = data_in;
                cycle_count = 0;
                goto Process;
            }
            Process => {
                cycle_count = cycle_count + 1;
                when cycle_count == 3 { goto Output; }
            }
            Output => {
                data_out = buffer;
                when !start { goto Idle; }
            }
        }
    }
}
```

### 17.16.4 使用禁止パターン（エラー例）

以下のパターンはコンパイルエラーになります。

```rust
// ❌ エラー: varはcombで使用不可
mod InvalidVarComb(
    in a: bit[8],
    out b: bit[8],
) {
    var temp: bit[8];  // varを宣言

    comb {
        temp = a;  // エラー O0002: varはsync/fsm外で代入不可
        b = temp;
    }
}
```

```rust
// ❌ エラー: varは直接代入（組み合わせ回路）不可
mod InvalidVarDirect(
    in a: bit[8],
    in b: bit[8],
) {
    var result: bit[8] = a + b;  // エラー: varは直接代入不可
}
```

```rust
// ❌ エラー: varはモジュールレベルの組み合わせ論理で使用不可
mod InvalidVarModuleLevel(
    in a: bit[8],
    out b: bit[8],
) {
    var temp: bit[8] = 0;
    let sum = temp + a;  // エラー: varは組み合わせ論理の右辺として使用不可（sync/fsm外）
}
```

### 17.16.5 宣言パターン比較表

| 宣言 | comb | sync | fsm | 回路種別 | 備考 |
|------|------|------|-----|----------|------|
| `let x = expr;` | ✅ | ✅ | ✅ | 組み合わせ | 直接代入は常に組み合わせ回路 |
| `let x: T;` (comb使用) | ✅ | - | - | 組み合わせ | comb内で代入 |
| `let x: T;` (sync使用) | - | ✅ | - | 順序 | sync内で代入 |
| `let x: T;` (fsm使用) | - | - | ✅ | 順序 | fsm内で代入 |
| `let mut x = v;` (comb) | ✅ | - | - | 組み合わせ | 累積計算用 |
| `let mut x = v;` (sync) | - | ✅ | - | 順序 | vがリセット値 |
| `let mut x = v;` (fsm) | - | - | ✅ | 順序 | vがリセット値 |
| `var x: T;` | ❌ | ✅ | ✅ | 順序 | sync/fsmでのみ使用可 |
| `var x = v;` | ❌ | ✅ | ✅ | 順序 | sync/fsmでのみ使用可、vがリセット値 |

---

## 17.17 テストベンチ例

```rust
#[test]
#[timeout(1.ms)]
test counter_basic() {
    let dut = Counter[Width: 8].create();
    let clk = Clock.new(period: 10.ns);

    dut.clk = clk;
    dut.rst.assert();
    await clk.cycles(5);
    dut.rst.deassert();

    // カウンタが0から始まることを確認
    assert dut.count == 0;

    // イネーブルをアサート
    dut.enable = 1;
    await clk.cycles(10);

    // 10カウントされたことを確認
    assert dut.count == 10;

    // イネーブルをデアサート
    dut.enable = 0;
    await clk.cycles(5);

    // カウントが変わらないことを確認
    assert dut.count == 10;
}

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
```

---

## 17.18 testモジュール例

`test`モジュールはテストベンチ専用のモジュール定義である。
ポート宣言を持たず、SystemVerilogのテストベンチトップ階層と同等の役割を持つ。

### 17.18.1 基本的なtestモジュール

```rust
/// 基本的なカウンタテスト
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
        // リセットアサート
        rst = 1;
        await clk.cycles(5);
        rst = 0;

        // カウント動作を確認
        await clk.cycles(100);

        assert dut.count == 8'd100
            else error("Counter mismatch: expected 100, got {dut.count}");

        $display("Test passed!");
        $finish;
    }
}
```

### 17.18.2 複数DUTの統合テスト

```rust
/// FIFOを使用した統合テスト
test FifoIntegrationTest {
    // クロック生成
    let clk = Clock.new(period: 10.ns);
    let rst: bit = 0;

    // テスト用信号
    let wr_data: bit[8] = 0;
    let wr_en: bit = 0;
    let rd_en: bit = 0;

    // DUTインスタンス化
    let fifo = SyncFifo[Width: 8, Depth: 16](
        clk: clk,
        rst: rst,
        push: wr_en,
        din: wr_data,
        pop: rd_en,
    );

    // テストシーケンス
    initial {
        // リセット
        rst = 1;
        await clk.cycles(5);
        rst = 0;

        // FIFOに書き込み
        for i in 0..10 {
            wr_data = i as bit[8];
            wr_en = 1;
            await clk.cycles(1);
        }
        wr_en = 0;

        // FIFOから読み出し
        for i in 0..10 {
            rd_en = 1;
            await clk.cycles(1);
            assert fifo.dout == i as bit[8]
                else error("Data mismatch at {i}");
        }
        rd_en = 0;

        assert fifo.empty == 1
            else error("FIFO should be empty");

        $display("Integration test passed!");
        $finish;
    }
}
```

### 17.18.3 複数クロックドメインのテスト

```rust
/// 非同期FIFOのテスト（複数クロックドメイン）
test AsyncFifoTest {
    // 異なる周波数のクロック生成
    let clk_wr = Clock.new(period: 10.ns);   // 100MHz
    let clk_rd = Clock.new(period: 15.ns);   // 約66.7MHz
    let rst: bit = 0;

    // テスト用信号
    let wr_data: bit[8] = 0;
    let wr_en: bit = 0;
    let rd_en: bit = 0;

    // DUTインスタンス化
    let dut = AsyncFifo[Width: 8, Depth: 16](
        clk_wr: clk_wr,
        clk_rd: clk_rd,
        rst: rst,
        push: wr_en,
        din: wr_data,
        pop: rd_en,
    );

    // ライター側の動作
    initial {
        await clk_wr.cycles(10);  // リセット待ち

        for i in 0..20 {
            await until(!dut.full);
            wr_data = i as bit[8];
            wr_en = 1;
            await clk_wr.cycles(1);
            wr_en = 0;
        }
    }

    // リーダー側の動作
    initial {
        await clk_rd.cycles(15);  // リセット待ち + データ到着待ち

        for i in 0..20 {
            await until(!dut.empty);
            rd_en = 1;
            await clk_rd.cycles(1);
            rd_en = 0;
            assert dut.dout == i as bit[8]
                else error("Async FIFO data mismatch");
        }

        $display("Async FIFO test passed!");
        $finish;
    }

    // リセットシーケンス
    initial {
        rst = 1;
        await clk_wr.cycles(5);
        rst = 0;
    }
}
```

### 17.18.4 testモジュールとtest関数の使い分け

| 用途 | 推奨 | 理由 |
|------|------|------|
| 単一モジュールの単体テスト | `#[test] test name() { }` | シンプルで簡潔 |
| 複数モジュールの統合テスト | `test name { }` | 複数DUTの接続が容易 |
| 複数クロックドメイン | `test name { }` | 複数initialブロックが使用可能 |
| パラメトリックテスト | `#[test] #[parametric]` | パラメータ展開が容易 |

---

## 17.19 seqブロック例

### 17.19.1 基本的なseqブロック

```rust
/// seqブロックを使用したカウンタテスト
test CounterSeqTest {
    let clk = Clock.new(period: 10.ns);
    let rst: bit = 0;
    let enable: bit = 0;

    let dut = Counter8(clk: clk, rst: rst, enable: enable);

    seq main {
        // リセットシーケンス
        rst.set(1);
        #50;
        rst.set(0);

        // Rustのfor文を使用したテスト
        enable.set(1);
        for cycle in 0u32..256 {
            await clk.posedge;
            let expected = (cycle % 256) as u8;
            let actual = dut.count.value();

            if actual != expected {
                panic!("Counter mismatch at cycle {}: expected {}, got {}",
                       cycle, expected, actual);
            }
        }

        println!("Counter verification passed: 256 cycles");
    }
}
```

### 17.19.2 複数seqブロックの並列実行

```rust
/// 並列seqブロックを使用したプロデューサーとコンシューマーのテスト
test FifoParallelTest {
    let clk = Clock.new(period: 10.ns);
    let rst: bit = 0;

    let dut = SyncFifo[Width: 8, Depth: 16](clk: clk, rst: rst);

    // 共有カウンタ（Rust変数）
    static WRITE_COUNT: AtomicU32 = AtomicU32::new(0);
    static READ_COUNT: AtomicU32 = AtomicU32::new(0);

    // リセットシーケンス
    seq reset_seq {
        rst.set(1);
        #100;
        rst.set(0);
    }

    // プロデューサー（書き込み側）
    seq producer {
        #150;  // リセット完了待ち

        for i in 0u8..100 {
            // FIFOがフルでなくなるまで待機
            while dut.full.value() == 1 {
                await clk.posedge;
            }

            dut.din.set(i);
            dut.push.set(1);
            await clk.posedge;
            dut.push.set(0);

            WRITE_COUNT.fetch_add(1, Ordering::SeqCst);
        }

        println!("Producer finished: {} items written", 100);
    }

    // コンシューマー（読み出し側）
    seq consumer {
        #200;  // データが溜まるまで待機

        let mut errors = 0u32;
        for expected in 0u8..100 {
            // FIFOが空でなくなるまで待機
            while dut.empty.value() == 1 {
                await clk.posedge;
            }

            dut.pop.set(1);
            await clk.posedge;
            dut.pop.set(0);

            let actual = dut.dout.value();
            if actual != expected {
                println!("Error: expected {}, got {}", expected, actual);
                errors += 1;
            }

            READ_COUNT.fetch_add(1, Ordering::SeqCst);
        }

        if errors == 0 {
            println!("Consumer finished: {} items verified successfully", 100);
        } else {
            panic!("{} errors detected", errors);
        }
    }
}
```

### 17.19.3 条件待機とタイムアウト

```rust
/// 条件待機とタイムアウトを使用したテスト
test ProtocolTest {
    let clk = Clock.new(period: 10.ns);
    let rst: bit = 0;

    let dut = ProtocolHandler(clk: clk, rst: rst);

    seq main {
        // リセット
        rst.set(1);
        #100;
        rst.set(0);

        // リクエスト送信
        dut.req.set(1);
        await clk.posedge;
        dut.req.set(0);

        // ACK待機（タイムアウト付き）
        let start_time = std::time::Instant::now();

        match await until(dut.ack.value() == 1, timeout: 1.us) {
            Ok(()) => {
                println!("ACK received in {:?}", start_time.elapsed());
            }
            Err(Timeout) => {
                panic!("ACK timeout: no response within 1us");
            }
        }

        // データ転送
        for i in 0..16u8 {
            dut.data.set(i);
            dut.valid.set(1);
            await clk.posedge;

            // ready待機
            await until(dut.ready.value() == 1);
            dut.valid.set(0);
            await clk.posedge;
        }

        // 完了待機
        await until(dut.done.value() == 1, timeout: 10.us);
        println!("Transfer complete");
    }
}
```

---

## 17.20 外部Rust関数呼び出し例

### 17.20.1 基本的な外部Rust関数の使用

**rust/test_utils.rs:**
```rust
//! テストユーティリティ関数

/// 期待されるカウンタ値を計算
pub fn expected_count(cycles: u32, width: u32) -> u64 {
    cycles as u64 % (1u64 << width)
}

/// カウンタ値を検証し、エラーがあればパニック
pub fn verify_count(actual: u64, expected: u64, cycle: u32) {
    if actual != expected {
        panic!("Counter mismatch at cycle {}: expected {}, got {}",
               cycle, expected, actual);
    }
}

/// ランダムテストベクタを生成
pub fn generate_test_vectors(seed: u64, count: usize) -> Vec<u8> {
    use rand::{SeedableRng, Rng};
    let mut rng = rand::rngs::StdRng::seed_from_u64(seed);
    (0..count).map(|_| rng.gen()).collect()
}
```

**test/counter_test.iris:**
```rust
use rust::test_utils::{expected_count, verify_count};

test CounterWithRust {
    let clk = Clock.new(period: 10.ns);
    let rst: bit = 0;

    let dut = Counter[Width: 16](clk: clk, rst: rst, enable: 1);

    seq main {
        rst.set(1);
        #50;
        rst.set(0);

        for cycle in 0u32..1000 {
            await clk.posedge;

            // 外部Rust関数で期待値を計算
            let expected = expected_count(cycle, 16);
            let actual = dut.count.value() as u64;

            // 外部Rust関数で検証
            verify_count(actual, expected, cycle);
        }

        println!("1000 cycles verified using external Rust functions");
    }
}
```

### 17.20.2 テストデータ生成器の使用

**rust/generators.rs:**
```rust
//! スティミュラス生成器

use rand::{SeedableRng, Rng, distributions::Standard};

/// AXIトランザクション
#[derive(Debug, Clone)]
pub struct AxiTransaction {
    pub addr: u32,
    pub data: Vec<u8>,
    pub burst_len: u8,
    pub is_write: bool,
}

/// AXIトランザクション生成器
pub struct AxiGenerator {
    rng: rand::rngs::StdRng,
}

impl AxiGenerator {
    pub fn new(seed: u64) -> Self {
        Self {
            rng: rand::rngs::StdRng::seed_from_u64(seed),
        }
    }

    pub fn generate_transaction(&mut self) -> AxiTransaction {
        let burst_len = self.rng.gen_range(1..=16);
        AxiTransaction {
            addr: self.rng.gen::<u32>() & 0xFFFF_FFF0,  // 16バイトアライン
            data: (0..burst_len as usize * 4)
                  .map(|_| self.rng.gen())
                  .collect(),
            burst_len,
            is_write: self.rng.gen(),
        }
    }
}
```

**test/axi_test.iris:**
```rust
use rust::generators::{AxiGenerator, AxiTransaction};

test AxiMasterTest {
    let clk = Clock.new(period: 5.ns);  // 200MHz
    let rst: bit = 0;

    let dut = AxiMaster(clk: clk, rst: rst);

    seq main {
        // リセット
        rst.set(1);
        #100;
        rst.set(0);

        // Rust側で生成器を作成
        let mut gen = AxiGenerator::new(12345);

        // 100トランザクションをテスト
        for i in 0..100 {
            let txn = gen.generate_transaction();

            if txn.is_write {
                // 書き込みトランザクション
                dut.awaddr.set(txn.addr);
                dut.awlen.set(txn.burst_len - 1);
                dut.awvalid.set(1);
                await until(dut.awready.value() == 1);
                await clk.posedge;
                dut.awvalid.set(0);

                // データ転送
                for (j, chunk) in txn.data.chunks(4).enumerate() {
                    let data = u32::from_le_bytes(chunk.try_into().unwrap());
                    dut.wdata.set(data);
                    dut.wlast.set(if j == txn.burst_len as usize - 1 { 1 } else { 0 });
                    dut.wvalid.set(1);
                    await until(dut.wready.value() == 1);
                    await clk.posedge;
                }
                dut.wvalid.set(0);

                // 応答待ち
                await until(dut.bvalid.value() == 1);
                dut.bready.set(1);
                await clk.posedge;
                dut.bready.set(0);
            }

            if i % 10 == 0 {
                println!("Transaction {} completed", i);
            }
        }

        println!("All 100 transactions completed successfully");
    }
}
```

### 17.20.3 非同期Rust関数の使用

**rust/async_helpers.rs:**
```rust
//! 非同期テストヘルパー

use tokio::time::{Duration, sleep};

/// 非同期でテストベクタをファイルから読み込み
pub async fn load_test_vectors(filename: &str) -> Result<Vec<u8>, std::io::Error> {
    tokio::fs::read(filename).await
}

/// 非同期で結果をファイルに保存
pub async fn save_results(filename: &str, data: &[u8]) -> Result<(), std::io::Error> {
    tokio::fs::write(filename, data).await
}

/// 非同期タイムアウト付き条件待機
pub async fn wait_with_timeout<F>(
    mut condition: F,
    timeout_ms: u64
) -> Result<(), &'static str>
where
    F: FnMut() -> bool
{
    let deadline = std::time::Instant::now() + Duration::from_millis(timeout_ms);

    while !condition() {
        if std::time::Instant::now() > deadline {
            return Err("Timeout");
        }
        sleep(Duration::from_micros(1)).await;
    }
    Ok(())
}
```

**test/async_test.iris:**
```rust
use rust::async_helpers::{load_test_vectors, save_results};

test MemoryAsyncTest {
    let clk = Clock.new(period: 10.ns);
    let rst: bit = 0;

    let dut = MemoryController(clk: clk, rst: rst);

    seq main {
        // リセット
        rst.set(1);
        #100;
        rst.set(0);

        // 非同期でテストベクタを読み込み
        let test_data = match load_test_vectors("test_vectors.bin").await {
            Ok(data) => data,
            Err(e) => {
                println!("Failed to load test vectors: {}", e);
                return;
            }
        };

        println!("Loaded {} bytes of test data", test_data.len());

        // メモリに書き込み
        for (addr, byte) in test_data.iter().enumerate() {
            dut.addr.set(addr as u32);
            dut.wdata.set(*byte as u32);
            dut.wen.set(1);
            await clk.posedge;
        }
        dut.wen.set(0);

        // 読み戻して検証
        let mut results = Vec::new();
        for addr in 0..test_data.len() {
            dut.addr.set(addr as u32);
            dut.ren.set(1);
            await clk.posedge;
            await clk.posedge;  // 読み出しレイテンシ
            results.push(dut.rdata.value() as u8);
        }
        dut.ren.set(0);

        // 結果を非同期で保存
        save_results("test_results.bin", &results).await.unwrap();

        // 検証
        if results == test_data {
            println!("Memory test passed");
        } else {
            panic!("Memory verification failed");
        }
    }
}
```

### 17.20.4 extern rustブロックの使用

```rust
// 明示的にRust関数シグネチャを宣言
extern rust "test_utils" {
    fn expected_count(cycles: u32, width: u32) -> u64;
    fn verify_count(actual: u64, expected: u64, cycle: u32);
}

extern rust "generators" {
    fn generate_random_bytes(seed: u64, count: usize) -> Vec<u8>;
}

test ExternRustTest {
    let clk = Clock.new(period: 10.ns);
    let rst: bit = 0;

    let dut = Counter8(clk: clk, rst: rst, enable: 1);

    seq main {
        rst.set(1);
        #50;
        rst.set(0);

        // extern宣言した関数を使用
        for cycle in 0u32..100 {
            await clk.posedge;
            let expected = expected_count(cycle, 8);
            verify_count(dut.count.value() as u64, expected, cycle);
        }

        // ランダムテスト
        let random_data = generate_random_bytes(42, 256);
        println!("Generated {} random bytes", random_data.len());
    }
}
```

---

[<< 文法定義](./16_grammar.md) | [目次](./iris_spec.md) | [用語集 >>](./18_glossary.md)
