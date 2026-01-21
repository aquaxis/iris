# IRIS サンプル集

実践的なRTL設計パターンのサンプル集です。各サンプルは即座にシミュレーション可能なコードとして提供されます。

## 目次

1. [基本回路](#1-基本回路)
2. [演算回路](#2-演算回路)
3. [カウンタ・タイマー](#3-カウンタタイマー)
4. [シフトレジスタ](#4-シフトレジスタ)
5. [FIFO](#5-fifo)
6. [状態機械（FSM）](#6-状態機械fsm)
7. [通信プロトコル](#7-通信プロトコル)
8. [メモリ](#8-メモリ)
9. [算術演算ユニット](#9-算術演算ユニット)
10. [テストベンチパターン](#10-テストベンチパターン)

---

## 1. 基本回路

### 1.1 インバータ

```iris
// 最もシンプルな組み合わせ回路
mod Inverter(
    in  a: bit,
    out y: bit,
) {
    comb {
        y = !a;
    }
}
```

### 1.2 2入力ANDゲート

```iris
mod And2(
    in  a: bit,
    in  b: bit,
    out y: bit,
) {
    comb {
        y = a & b;
    }
}
```

### 1.3 4入力マルチプレクサ

```iris
mod Mux4(
    in  d0: bit[8],
    in  d1: bit[8],
    in  d2: bit[8],
    in  d3: bit[8],
    in  sel: bit[2],
    out y: bit[8],
) {
    comb {
        if sel == 2'b00 {
            y = d0;
        } else if sel == 2'b01 {
            y = d1;
        } else if sel == 2'b10 {
            y = d2;
        } else {
            y = d3;
        }
    }
}
```

### 1.4 デマルチプレクサ

```iris
mod Demux4(
    in  d: bit[8],
    in  sel: bit[2],
    out y0: bit[8],
    out y1: bit[8],
    out y2: bit[8],
    out y3: bit[8],
) {
    comb {
        y0 = 8'd0;
        y1 = 8'd0;
        y2 = 8'd0;
        y3 = 8'd0;

        if sel == 2'b00 {
            y0 = d;
        } else if sel == 2'b01 {
            y1 = d;
        } else if sel == 2'b10 {
            y2 = d;
        } else {
            y3 = d;
        }
    }
}
```

### 1.5 プライオリティエンコーダ

```iris
mod PriorityEncoder8(
    in  req: bit[8],
    out grant: bit[3],
    out valid: bit,
) {
    comb {
        if req[7] {
            grant = 3'd7;
            valid = 1;
        } else if req[6] {
            grant = 3'd6;
            valid = 1;
        } else if req[5] {
            grant = 3'd5;
            valid = 1;
        } else if req[4] {
            grant = 3'd4;
            valid = 1;
        } else if req[3] {
            grant = 3'd3;
            valid = 1;
        } else if req[2] {
            grant = 3'd2;
            valid = 1;
        } else if req[1] {
            grant = 3'd1;
            valid = 1;
        } else if req[0] {
            grant = 3'd0;
            valid = 1;
        } else {
            grant = 3'd0;
            valid = 0;
        }
    }
}
```

### 1.6 デコーダ

```iris
mod Decoder3to8(
    in  sel: bit[3],
    in  enable: bit,
    out y: bit[8],
) {
    comb {
        if !enable {
            y = 8'b00000000;
        } else {
            if sel == 3'd0 { y = 8'b00000001; }
            else if sel == 3'd1 { y = 8'b00000010; }
            else if sel == 3'd2 { y = 8'b00000100; }
            else if sel == 3'd3 { y = 8'b00001000; }
            else if sel == 3'd4 { y = 8'b00010000; }
            else if sel == 3'd5 { y = 8'b00100000; }
            else if sel == 3'd6 { y = 8'b01000000; }
            else { y = 8'b10000000; }
        }
    }
}
```

---

## 2. 演算回路

### 2.1 全加算器

```iris
mod FullAdder(
    in  a: bit,
    in  b: bit,
    in  cin: bit,
    out sum: bit,
    out cout: bit,
) {
    let ab_xor: bit;

    comb {
        ab_xor = a ^ b;
        sum = ab_xor ^ cin;
        cout = (a & b) | (ab_xor & cin);
    }
}
```

### 2.2 リップルキャリー加算器（8ビット）

```iris
mod RippleCarryAdder8(
    in  a: bit[8],
    in  b: bit[8],
    in  cin: bit,
    out sum: bit[8],
    out cout: bit,
) {
    let carry: bit[9];

    inst fa0 = FullAdder { a: a[0], b: b[0], cin: cin };
    inst fa1 = FullAdder { a: a[1], b: b[1], cin: fa0.cout };
    inst fa2 = FullAdder { a: a[2], b: b[2], cin: fa1.cout };
    inst fa3 = FullAdder { a: a[3], b: b[3], cin: fa2.cout };
    inst fa4 = FullAdder { a: a[4], b: b[4], cin: fa3.cout };
    inst fa5 = FullAdder { a: a[5], b: b[5], cin: fa4.cout };
    inst fa6 = FullAdder { a: a[6], b: b[6], cin: fa5.cout };
    inst fa7 = FullAdder { a: a[7], b: b[7], cin: fa6.cout };

    comb {
        sum = {fa7.sum, fa6.sum, fa5.sum, fa4.sum,
               fa3.sum, fa2.sum, fa1.sum, fa0.sum};
        cout = fa7.cout;
    }
}
```

### 2.3 比較器

```iris
mod Comparator8(
    in  a: bit[8],
    in  b: bit[8],
    out eq: bit,     // a == b
    out lt: bit,     // a < b
    out gt: bit,     // a > b
) {
    comb {
        eq = (a == b);
        lt = (a < b);
        gt = (a > b);
    }
}
```

### 2.4 バレルシフタ

```iris
mod BarrelShifter8(
    in  din: bit[8],
    in  shamt: bit[3],    // シフト量
    in  dir: bit,         // 0: 左, 1: 右
    out dout: bit[8],
) {
    let stage1: bit[8];
    let stage2: bit[8];

    comb {
        // ステージ1: 1ビットシフト
        if shamt[0] {
            if dir {
                stage1 = {1'b0, din[7:1]};
            } else {
                stage1 = {din[6:0], 1'b0};
            }
        } else {
            stage1 = din;
        }

        // ステージ2: 2ビットシフト
        if shamt[1] {
            if dir {
                stage2 = {2'b00, stage1[7:2]};
            } else {
                stage2 = {stage1[5:0], 2'b00};
            }
        } else {
            stage2 = stage1;
        }

        // ステージ3: 4ビットシフト
        if shamt[2] {
            if dir {
                dout = {4'b0000, stage2[7:4]};
            } else {
                dout = {stage2[3:0], 4'b0000};
            }
        } else {
            dout = stage2;
        }
    }
}
```

### 2.5 乗算器（シフト加算方式）

```iris
mod Multiplier8(
    in  clk: clock,
    in  rst: reset,
    in  start: bit,
    in  a: bit[8],
    in  b: bit[8],
    out product: bit[16],
    out done: bit,
) {
    var multiplicand: bit[16] = 0;
    var multiplier: bit[8] = 0;
    var accumulator: bit[16] = 0;
    var count: bit[4] = 0;
    var busy: bit = 0;

    sync(clk.posedge, rst.async) {
        if start && !busy {
            multiplicand = {8'd0, a};
            multiplier = b;
            accumulator = 16'd0;
            count = 4'd0;
            busy = 1;
        } else if busy {
            if multiplier[0] {
                accumulator = accumulator + multiplicand;
            }
            multiplicand = multiplicand << 1;
            multiplier = multiplier >> 1;
            count = count + 1;

            if count == 4'd7 {
                busy = 0;
            }
        }
    }

    comb {
        product = accumulator;
        done = !busy && (count == 4'd8);
    }
}
```

---

## 3. カウンタ・タイマー

### 3.1 基本カウンタ

```iris
mod Counter8(
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

### 3.2 アップダウンカウンタ

```iris
mod UpDownCounter8(
    in  clk: clock,
    in  rst: reset,
    in  enable: bit,
    in  up: bit,          // 1: アップ, 0: ダウン
    in  load: bit,
    in  load_val: bit[8],
    out count: bit[8],
    out zero: bit,
    out max: bit,
) {
    var counter: bit[8] = 0;

    sync(clk.posedge, rst.async) {
        if load {
            counter = load_val;
        } else if enable {
            if up {
                counter = counter + 1;
            } else {
                counter = counter - 1;
            }
        }
    }

    comb {
        count = counter;
        zero = (counter == 8'd0);
        max = (counter == 8'hFF);
    }
}
```

### 3.3 リングカウンタ

```iris
mod RingCounter8(
    in  clk: clock,
    in  rst: reset,
    in  enable: bit,
    out count: bit[8],
) {
    var counter: bit[8] = 8'b00000001;

    sync(clk.posedge, rst.async) {
        if enable {
            counter = {counter[6:0], counter[7]};
        }
    }

    comb {
        count = counter;
    }
}
```

### 3.4 ジョンソンカウンタ

```iris
mod JohnsonCounter8(
    in  clk: clock,
    in  rst: reset,
    in  enable: bit,
    out count: bit[8],
) {
    var counter: bit[8] = 0;

    sync(clk.posedge, rst.async) {
        if enable {
            counter = {counter[6:0], !counter[7]};
        }
    }

    comb {
        count = counter;
    }
}
```

### 3.5 プログラマブルタイマー

```iris
mod Timer(
    in  clk: clock,
    in  rst: reset,
    in  start: bit,
    in  period: bit[16],
    out expired: bit,
    out running: bit,
) {
    var counter: bit[16] = 0;
    var active: bit = 0;
    var target: bit[16] = 0;

    sync(clk.posedge, rst.async) {
        if start && !active {
            counter = 16'd0;
            target = period;
            active = 1;
        } else if active {
            if counter >= target {
                active = 0;
            } else {
                counter = counter + 1;
            }
        }
    }

    comb {
        expired = !active && (counter >= target) && (target != 16'd0);
        running = active;
    }
}
```

### 3.6 PWM生成器

```iris
mod PWMGenerator(
    in  clk: clock,
    in  rst: reset,
    in  duty: bit[8],     // デューティ比 (0-255)
    in  period: bit[8],   // 周期
    out pwm: bit,
) {
    var counter: bit[8] = 0;

    sync(clk.posedge, rst.async) {
        if counter >= period {
            counter = 8'd0;
        } else {
            counter = counter + 1;
        }
    }

    comb {
        pwm = (counter < duty);
    }
}
```

---

## 4. シフトレジスタ

### 4.1 シリアル入力パラレル出力（SIPO）

```iris
mod SIPO8(
    in  clk: clock,
    in  rst: reset,
    in  din: bit,
    out dout: bit[8],
) {
    var reg: bit[8] = 0;

    sync(clk.posedge, rst.async) {
        reg = {reg[6:0], din};
    }

    comb {
        dout = reg;
    }
}
```

### 4.2 パラレル入力シリアル出力（PISO）

```iris
mod PISO8(
    in  clk: clock,
    in  rst: reset,
    in  load: bit,
    in  din: bit[8],
    in  shift: bit,
    out dout: bit,
) {
    var reg: bit[8] = 0;

    sync(clk.posedge, rst.async) {
        if load {
            reg = din;
        } else if shift {
            reg = {1'b0, reg[7:1]};
        }
    }

    comb {
        dout = reg[0];
    }
}
```

### 4.3 双方向シフトレジスタ

```iris
mod BiDirShiftReg8(
    in  clk: clock,
    in  rst: reset,
    in  load: bit,
    in  din: bit[8],
    in  shift_left: bit,
    in  shift_right: bit,
    in  sin_left: bit,
    in  sin_right: bit,
    out dout: bit[8],
) {
    var reg: bit[8] = 0;

    sync(clk.posedge, rst.async) {
        if load {
            reg = din;
        } else if shift_left {
            reg = {reg[6:0], sin_right};
        } else if shift_right {
            reg = {sin_left, reg[7:1]};
        }
    }

    comb {
        dout = reg;
    }
}
```

### 4.4 LFSR（線形帰還シフトレジスタ）

```iris
// 8ビットLFSR（擬似乱数生成器）
// 多項式: x^8 + x^6 + x^5 + x^4 + 1
mod LFSR8(
    in  clk: clock,
    in  rst: reset,
    in  enable: bit,
    in  seed: bit[8],
    in  load_seed: bit,
    out rand: bit[8],
) {
    var reg: bit[8] = 8'b00000001;  // 非ゼロ初期値
    let feedback: bit;

    comb {
        feedback = reg[7] ^ reg[5] ^ reg[4] ^ reg[3];
    }

    sync(clk.posedge, rst.async) {
        if load_seed {
            if seed != 8'd0 {
                reg = seed;
            } else {
                reg = 8'b00000001;  // ゼロは禁止
            }
        } else if enable {
            reg = {reg[6:0], feedback};
        }
    }

    comb {
        rand = reg;
    }
}
```

---

## 5. FIFO

### 5.1 同期FIFO

```iris
mod SyncFIFO(
    in  clk: clock,
    in  rst: reset,
    in  wr_en: bit,
    in  rd_en: bit,
    in  din: bit[8],
    out dout: bit[8],
    out full: bit,
    out empty: bit,
    out count: bit[4],
) {
    // 16エントリのFIFO
    mem buffer: bit[8][16] { type: ram, read_mode: async };

    var wr_ptr: bit[4] = 0;
    var rd_ptr: bit[4] = 0;
    var fifo_count: bit[5] = 0;  // 0-16をカウント

    sync(clk.posedge, rst.async) {
        // 書き込み
        if wr_en && (fifo_count < 5'd16) {
            buffer[wr_ptr] = din;
            wr_ptr = wr_ptr + 1;
            fifo_count = fifo_count + 1;
        }

        // 読み出し
        if rd_en && (fifo_count > 5'd0) {
            rd_ptr = rd_ptr + 1;
            fifo_count = fifo_count - 1;
        }

        // 同時読み書き
        if wr_en && rd_en && (fifo_count > 5'd0) && (fifo_count < 5'd16) {
            // fifo_countは変わらない
            fifo_count = fifo_count;
        }
    }

    comb {
        dout = buffer[rd_ptr];
        full = (fifo_count == 5'd16);
        empty = (fifo_count == 5'd0);
        count = fifo_count[3:0];
    }
}
```

### 5.2 FIFOテストベンチ

```iris
test FIFOTest {
    let clk: clock;
    let rst: reset;

    var wr_en: bit = 0;
    var rd_en: bit = 0;
    var din: bit[8] = 0;
    var cycle: bit[8] = 0;

    inst fifo = SyncFIFO {
        clk: clk,
        rst: rst,
        wr_en: wr_en,
        rd_en: rd_en,
        din: din,
    };

    sync(clk.posedge, rst.async) {
        cycle = cycle + 1;

        // サイクル10-20: 書き込み
        if cycle >= 8'd10 && cycle < 8'd20 {
            wr_en = 1;
            din = cycle;
        } else {
            wr_en = 0;
        }

        // サイクル25-35: 読み出し
        if cycle >= 8'd25 && cycle < 8'd35 {
            rd_en = 1;
        } else {
            rd_en = 0;
        }
    }
}
```

---

## 6. 状態機械（FSM）

### 6.1 信号機コントローラ

```iris
mod TrafficLight(
    in  clk: clock,
    in  rst: reset,
    in  pedestrian_btn: bit,
    out red: bit,
    out yellow: bit,
    out green: bit,
    out walk: bit,
) {
    var timer: bit[8] = 0;
    var ped_request: bit = 0;

    fsm controller(clk.posedge, rst.async) {
        state Red[red=1, yellow=0, green=0, walk=0];
        state Green[red=0, yellow=0, green=1, walk=0];
        state Yellow[red=0, yellow=1, green=0, walk=0];
        state Walk[red=1, yellow=0, green=0, walk=1];

        transitions {
            Red => {
                when timer >= 8'd50 { goto Green; timer = 0; }
            }
            Green => {
                when ped_request && timer >= 8'd30 { goto Yellow; timer = 0; }
                when timer >= 8'd60 { goto Yellow; timer = 0; }
            }
            Yellow => {
                when timer >= 8'd10 {
                    if ped_request {
                        goto Walk;
                    } else {
                        goto Red;
                    }
                    timer = 0;
                    ped_request = 0;
                }
            }
            Walk => {
                when timer >= 8'd20 { goto Red; timer = 0; }
            }
        }
    }

    sync(clk.posedge, rst.async) {
        timer = timer + 1;
        if pedestrian_btn {
            ped_request = 1;
        }
    }
}
```

### 6.2 UARTトランスミッタ

```iris
mod UartTx(
    in  clk: clock,
    in  rst: reset,
    in  data: bit[8],
    in  start: bit,
    out tx: bit,
    out busy: bit,
) {
    var shift_reg: bit[10] = 10'h3FF;  // 全てHigh
    var bit_count: bit[4] = 0;
    var baud_count: bit[8] = 0;

    // ボーレート分周比（クロック/ボーレート）
    let BAUD_DIV: bit[8] = 8'd104;  // 例: 10MHz / 9600bps

    fsm tx_fsm(clk.posedge, rst.async) {
        state Idle[busy=0];
        state Transmit[busy=1];

        transitions {
            Idle => {
                when start {
                    goto Transmit;
                    // スタートビット(0) + データ + ストップビット(1)
                    shift_reg = {1'b1, data, 1'b0};
                    bit_count = 4'd0;
                    baud_count = 8'd0;
                }
            }
            Transmit => {
                when bit_count >= 4'd10 {
                    goto Idle;
                }
            }
        }
    }

    sync(clk.posedge, rst.async) {
        if busy {
            if baud_count >= BAUD_DIV {
                baud_count = 8'd0;
                shift_reg = {1'b1, shift_reg[9:1]};
                bit_count = bit_count + 1;
            } else {
                baud_count = baud_count + 1;
            }
        }
    }

    comb {
        tx = shift_reg[0];
    }
}
```

### 6.3 自動販売機コントローラ

```iris
mod VendingMachine(
    in  clk: clock,
    in  rst: reset,
    in  coin_10: bit,     // 10円投入
    in  coin_50: bit,     // 50円投入
    in  coin_100: bit,    // 100円投入
    in  select: bit,      // 商品選択
    out total: bit[8],    // 投入金額
    out dispense: bit,    // 商品排出
    out change: bit[8],   // お釣り
) {
    var balance: bit[8] = 0;
    let PRICE: bit[8] = 8'd120;

    fsm controller(clk.posedge, rst.async) {
        state Idle[dispense=0, change=0];
        state Accepting[dispense=0, change=0];
        state Dispensing[dispense=1, change=0];
        state ReturnChange[dispense=0];

        transitions {
            Idle => {
                when coin_10 || coin_50 || coin_100 {
                    goto Accepting;
                }
            }
            Accepting => {
                when select && balance >= PRICE {
                    goto Dispensing;
                    balance = balance - PRICE;
                }
            }
            Dispensing => {
                // 1サイクル後に遷移
                goto ReturnChange;
            }
            ReturnChange => {
                when balance == 8'd0 {
                    goto Idle;
                }
            }
        }
    }

    sync(clk.posedge, rst.async) {
        // 硬貨投入処理
        if coin_10 {
            balance = balance + 8'd10;
        }
        if coin_50 {
            balance = balance + 8'd50;
        }
        if coin_100 {
            balance = balance + 8'd100;
        }
    }

    comb {
        total = balance;
    }
}
```

---

## 7. 通信プロトコル

### 7.1 SPIマスター

```iris
mod SPIMaster(
    in  clk: clock,
    in  rst: reset,
    in  start: bit,
    in  data_in: bit[8],
    in  miso: bit,
    out sclk: bit,
    out mosi: bit,
    out cs_n: bit,
    out data_out: bit[8],
    out done: bit,
) {
    var shift_tx: bit[8] = 0;
    var shift_rx: bit[8] = 0;
    var bit_cnt: bit[4] = 0;
    var sclk_reg: bit = 0;
    var busy: bit = 0;

    sync(clk.posedge, rst.async) {
        if start && !busy {
            shift_tx = data_in;
            shift_rx = 8'd0;
            bit_cnt = 4'd0;
            busy = 1;
            sclk_reg = 0;
        } else if busy {
            sclk_reg = !sclk_reg;

            if sclk_reg {
                // 立ち上がりエッジ: MISOサンプリング
                shift_rx = {shift_rx[6:0], miso};
            } else {
                // 立ち下がりエッジ: MOSIシフト
                shift_tx = {shift_tx[6:0], 1'b0};
                bit_cnt = bit_cnt + 1;

                if bit_cnt >= 4'd8 {
                    busy = 0;
                }
            }
        }
    }

    comb {
        sclk = sclk_reg;
        mosi = shift_tx[7];
        cs_n = !busy;
        data_out = shift_rx;
        done = !busy && (bit_cnt == 4'd8);
    }
}
```

### 7.2 I2Cマスター（簡易版）

```iris
mod I2CMaster(
    in  clk: clock,
    in  rst: reset,
    in  start: bit,
    in  addr: bit[7],
    in  rw: bit,          // 0: write, 1: read
    in  data_in: bit[8],
    out scl: bit,
    out sda_out: bit,
    out sda_oe: bit,      // SDA出力イネーブル
    in  sda_in: bit,
    out data_out: bit[8],
    out done: bit,
    out ack: bit,
) {
    var state: bit[4] = 0;
    var bit_cnt: bit[4] = 0;
    var shift_reg: bit[8] = 0;
    var scl_reg: bit = 1;
    var sda_reg: bit = 1;
    var clk_div: bit[4] = 0;

    // 状態定数
    let ST_IDLE: bit[4] = 4'd0;
    let ST_START: bit[4] = 4'd1;
    let ST_ADDR: bit[4] = 4'd2;
    let ST_ACK1: bit[4] = 4'd3;
    let ST_DATA: bit[4] = 4'd4;
    let ST_ACK2: bit[4] = 4'd5;
    let ST_STOP: bit[4] = 4'd6;

    sync(clk.posedge, rst.async) {
        clk_div = clk_div + 1;

        if clk_div == 4'd0 {
            // SCLトグル
            if state != ST_IDLE {
                scl_reg = !scl_reg;
            }
        }

        // 状態遷移（簡略化）
        if state == ST_IDLE && start {
            state = ST_START;
            shift_reg = {addr, rw};
        }
        // ... (省略: 完全な実装は長くなる)
    }

    comb {
        scl = scl_reg;
        sda_out = sda_reg;
        sda_oe = (state != ST_ACK1) && (state != ST_ACK2);
        data_out = shift_reg;
        done = (state == ST_IDLE);
        ack = !sda_in;
    }
}
```

---

## 8. メモリ

### 8.1 デュアルポートRAM

```iris
mod DualPortRAM(
    in  clk: clock,
    in  rst: reset,
    // ポートA（読み書き）
    in  addr_a: bit[8],
    in  din_a: bit[8],
    in  we_a: bit,
    out dout_a: bit[8],
    // ポートB（読み書き）
    in  addr_b: bit[8],
    in  din_b: bit[8],
    in  we_b: bit,
    out dout_b: bit[8],
) {
    mem ram: bit[8][256] { type: ram, read_mode: sync };

    var dout_a_reg: bit[8] = 0;
    var dout_b_reg: bit[8] = 0;

    sync(clk.posedge, rst.async) {
        // ポートA
        if we_a {
            ram[addr_a] = din_a;
        }
        dout_a_reg = ram[addr_a];

        // ポートB
        if we_b {
            ram[addr_b] = din_b;
        }
        dout_b_reg = ram[addr_b];
    }

    comb {
        dout_a = dout_a_reg;
        dout_b = dout_b_reg;
    }
}
```

### 8.2 キャッシュメモリ（ダイレクトマップ）

```iris
mod DirectMapCache(
    in  clk: clock,
    in  rst: reset,
    in  addr: bit[16],
    in  din: bit[8],
    in  we: bit,
    in  re: bit,
    out dout: bit[8],
    out hit: bit,
) {
    // 256エントリ、各エントリ: tag(8bit) + data(8bit) + valid(1bit)
    mem cache_data: bit[8][256] { type: ram, read_mode: async };
    mem cache_tag: bit[8][256] { type: ram, read_mode: async };
    mem cache_valid: bit[256] { type: ram, read_mode: async };

    let index: bit[8];
    let tag: bit[8];
    let cached_tag: bit[8];
    let valid: bit;

    comb {
        index = addr[7:0];
        tag = addr[15:8];
        cached_tag = cache_tag[index];
        valid = cache_valid[index];
        hit = valid && (cached_tag == tag);
        dout = cache_data[index];
    }

    sync(clk.posedge, rst.async) {
        if we {
            cache_data[index] = din;
            cache_tag[index] = tag;
            cache_valid[index] = 1;
        }
    }
}
```

### 8.3 ルックアップテーブル（LUT）

```iris
mod SineLUT(
    in  phase: bit[6],    // 0-63 (90度を64分割)
    out sine: bit[8],     // 0-255 (0.0-1.0を8ビットで表現)
) {
    mem lut: bit[8][64] { type: rom } = {
        8'd0,   8'd6,   8'd13,  8'd19,  8'd25,  8'd31,  8'd37,  8'd44,
        8'd50,  8'd56,  8'd62,  8'd68,  8'd74,  8'd80,  8'd86,  8'd92,
        8'd98,  8'd103, 8'd109, 8'd115, 8'd120, 8'd126, 8'd131, 8'd136,
        8'd142, 8'd147, 8'd152, 8'd157, 8'd162, 8'd167, 8'd171, 8'd176,
        8'd181, 8'd185, 8'd189, 8'd193, 8'd197, 8'd201, 8'd205, 8'd209,
        8'd212, 8'd216, 8'd219, 8'd222, 8'd225, 8'd228, 8'd231, 8'd234,
        8'd236, 8'd238, 8'd241, 8'd243, 8'd245, 8'd246, 8'd248, 8'd250,
        8'd251, 8'd252, 8'd253, 8'd254, 8'd255, 8'd255, 8'd255, 8'd255
    };

    comb {
        sine = lut[phase];
    }
}
```

---

## 9. 算術演算ユニット

### 9.1 ALU（算術論理演算ユニット）

```iris
mod ALU8(
    in  a: bit[8],
    in  b: bit[8],
    in  op: bit[4],
    out result: bit[8],
    out zero: bit,
    out carry: bit,
    out overflow: bit,
) {
    let result_wide: bit[9];

    // 演算コード
    let OP_ADD: bit[4] = 4'd0;
    let OP_SUB: bit[4] = 4'd1;
    let OP_AND: bit[4] = 4'd2;
    let OP_OR: bit[4] = 4'd3;
    let OP_XOR: bit[4] = 4'd4;
    let OP_NOT: bit[4] = 4'd5;
    let OP_SHL: bit[4] = 4'd6;
    let OP_SHR: bit[4] = 4'd7;
    let OP_INC: bit[4] = 4'd8;
    let OP_DEC: bit[4] = 4'd9;

    comb {
        result_wide = 9'd0;

        if op == OP_ADD {
            result_wide = {1'b0, a} + {1'b0, b};
        } else if op == OP_SUB {
            result_wide = {1'b0, a} - {1'b0, b};
        } else if op == OP_AND {
            result_wide = {1'b0, a & b};
        } else if op == OP_OR {
            result_wide = {1'b0, a | b};
        } else if op == OP_XOR {
            result_wide = {1'b0, a ^ b};
        } else if op == OP_NOT {
            result_wide = {1'b0, ~a};
        } else if op == OP_SHL {
            result_wide = {a, 1'b0};
        } else if op == OP_SHR {
            result_wide = {1'b0, 1'b0, a[7:1]};
        } else if op == OP_INC {
            result_wide = {1'b0, a} + 9'd1;
        } else if op == OP_DEC {
            result_wide = {1'b0, a} - 9'd1;
        }

        result = result_wide[7:0];
        carry = result_wide[8];
        zero = (result_wide[7:0] == 8'd0);

        // 符号付きオーバーフロー（加算/減算時）
        if op == OP_ADD {
            overflow = (a[7] == b[7]) && (result_wide[7] != a[7]);
        } else if op == OP_SUB {
            overflow = (a[7] != b[7]) && (result_wide[7] != a[7]);
        } else {
            overflow = 0;
        }
    }
}
```

### 9.2 除算器

```iris
mod Divider8(
    in  clk: clock,
    in  rst: reset,
    in  start: bit,
    in  dividend: bit[8],
    in  divisor: bit[8],
    out quotient: bit[8],
    out remainder: bit[8],
    out done: bit,
    out div_by_zero: bit,
) {
    var dividend_reg: bit[16] = 0;
    var divisor_reg: bit[8] = 0;
    var quotient_reg: bit[8] = 0;
    var count: bit[4] = 0;
    var busy: bit = 0;
    var error: bit = 0;

    sync(clk.posedge, rst.async) {
        if start && !busy {
            if divisor == 8'd0 {
                error = 1;
            } else {
                dividend_reg = {8'd0, dividend};
                divisor_reg = divisor;
                quotient_reg = 8'd0;
                count = 4'd0;
                busy = 1;
                error = 0;
            }
        } else if busy {
            // 復元法除算
            dividend_reg = dividend_reg << 1;

            if dividend_reg[15:8] >= divisor_reg {
                dividend_reg[15:8] = dividend_reg[15:8] - divisor_reg;
                quotient_reg = {quotient_reg[6:0], 1'b1};
            } else {
                quotient_reg = {quotient_reg[6:0], 1'b0};
            }

            count = count + 1;
            if count >= 4'd8 {
                busy = 0;
            }
        }
    }

    comb {
        quotient = quotient_reg;
        remainder = dividend_reg[7:0];
        done = !busy && !error && (count == 4'd8);
        div_by_zero = error;
    }
}
```

---

## 10. テストベンチパターン

### 10.1 基本的なテストベンチ構造

```iris
test BasicTestbench {
    let clk: clock;
    let rst: reset;

    var test_input: bit[8] = 0;
    var cycle_count: bit[16] = 0;
    var test_phase: bit[4] = 0;

    // DUTのインスタンス化
    inst dut = MyModule {
        clk: clk,
        rst: rst,
        input: test_input,
    };

    // テストシーケンス
    sync(clk.posedge, rst.async) {
        cycle_count = cycle_count + 1;

        // フェーズベースのテスト
        if test_phase == 4'd0 {
            // 初期化フェーズ
            if cycle_count > 16'd10 {
                test_phase = 4'd1;
                test_input = 8'hAA;
            }
        } else if test_phase == 4'd1 {
            // テストフェーズ1
            if cycle_count > 16'd20 {
                test_phase = 4'd2;
                test_input = 8'h55;
            }
        } else if test_phase == 4'd2 {
            // テストフェーズ2
            if cycle_count > 16'd30 {
                test_phase = 4'd3;
            }
        }
    }
}
```

### 10.2 アサーション付きテスト

```iris
test AssertionTest {
    let clk: clock;
    let rst: reset;

    var input_val: bit[8] = 0;
    var expected: bit[8] = 0;

    inst dut = Counter8 {
        clk: clk,
        rst: rst,
        enable: 1'b1,
    };

    sync(clk.posedge, rst.async) {
        expected = expected + 1;
    }

    // シーケンシャルテスト
    seq {
        // リセット解除を待つ
        await clk.cycles(5);

        // 10サイクル後にカウント値を確認
        await clk.cycles(10);
        assert dut.count == 8'd10, "Count should be 10";

        // さらに10サイクル後
        await clk.cycles(10);
        assert dut.count == 8'd20, "Count should be 20";
    }
}
```

### 10.3 ランダムテスト

```iris
test RandomTest {
    let clk: clock;
    let rst: reset;

    var seed: bit[8] = 8'hA5;
    var random_input: bit[8] = 0;

    inst lfsr = LFSR8 {
        clk: clk,
        rst: rst,
        enable: 1'b1,
        seed: seed,
        load_seed: 1'b0,
    };

    inst dut = MyModule {
        clk: clk,
        rst: rst,
        input: random_input,
    };

    sync(clk.posedge, rst.async) {
        // LFSRからランダム値を取得
        random_input = lfsr.rand;
    }
}
```

### 10.4 カバレッジ収集パターン

```iris
test CoverageTest {
    let clk: clock;
    let rst: reset;

    var test_vec: bit[8] = 0;
    var all_ones_seen: bit = 0;
    var all_zeros_seen: bit = 0;
    var pattern_count: bit[16] = 0;

    inst dut = MyModule {
        clk: clk,
        rst: rst,
        input: test_vec,
    };

    sync(clk.posedge, rst.async) {
        // 全パターンを順番にテスト
        test_vec = test_vec + 1;
        pattern_count = pattern_count + 1;

        // カバレッジ追跡
        if dut.output == 8'hFF {
            all_ones_seen = 1;
        }
        if dut.output == 8'h00 {
            all_zeros_seen = 1;
        }
    }

    seq {
        // 256パターン全てをテスト
        await clk.cycles(260);
        assert pattern_count >= 16'd256, "All patterns tested";
    }
}
```

---

## シミュレーション実行例

```bash
# 単一モジュールのテスト
iris-sim -i counter.iris -i counter_test.iris -o output.vcd -c 1000 -v

# 複数モジュールの階層設計
iris-sim -i alu.iris -i cpu.iris -i memory.iris -i top.iris -i testbench.iris \
         -o simulation.vcd -c 10000

# 高速シミュレーション（大規模設計向け）
iris-compile -i design.iris -o compiled_sim --release -v
./compiled_sim/target/release/compiled-sim 1000000 output.vcd
```

---

## 関連ドキュメント

- [チュートリアル](tutorial.md) - 基本的な使い方
- [言語リファレンス](reference.md) - 詳細な文法仕様
- [開発者ガイド](developer-guide.md) - iris-simの内部構造
