# 第16章 サンプルコード集

[<< 文法定義](./15_grammar.md) | [目次](./iris_spec_0.1.0.md) | [用語集 >>](./17_glossary.md)

---

## 16.1 基本的なカウンタ

```rust
/// 8ビットカウンタ
mod Counter8 {
    in  clk: clock,
    in  rst: reset,
    in  enable: bit,
    out count: bit[8],

    let counter: bit[8] = 0;
    let count: bit[8];

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

## 16.2 パラメータ化カウンタ

```rust
/// パラメータ化されたカウンタ
mod Counter[Width: uint = 8] {
    in  clk: clock,
    in  rst: reset,
    in  enable: bit,
    in  load: bit,
    in  data: bit[Width],
    out count: bit[Width],
    out overflow: bit,

    let counter: bit[Width] = 0;
    let count: bit[Width];
    let overflow: bit;

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

## 16.3 パラメータ化FIFO

```rust
/// 同期FIFO
mod SyncFifo[Width: uint = 8, Depth: uint = 16] {
    in  clk: clock,
    in  rst: reset,
    in  push: bit,
    in  pop: bit,
    in  din: bit[Width],
    out dout: bit[Width],
    out full: bit,
    out empty: bit,

    const ADDR_WIDTH: uint = $clog2(Depth);

    mem buffer: bit[Width][Depth];
    let wr_ptr: bit[ADDR_WIDTH] = 0;
    let rd_ptr: bit[ADDR_WIDTH] = 0;
    let count: bit[ADDR_WIDTH + 1] = 0;
    let dout: bit[Width];
    let full: bit;
    let empty: bit;

    sync(clk.posedge, rst.async) {
        if push && !full {
            buffer[wr_ptr] = din;
            wr_ptr = wr_ptr + 1;
            count = count + 1;
        }
        if pop && !empty {
            rd_ptr = rd_ptr + 1;
            count = count - 1;
        }
    }

    comb {
        dout = buffer[rd_ptr];
        full = count == Depth;
        empty = count == 0;
    }
}
```

---

## 16.4 ALU（算術論理演算ユニット）

```rust
/// 4機能ALU
mod Alu[Width: uint = 8] {
    in  a: bit[Width],
    in  b: bit[Width],
    in  op: bit[2],
    out result: bit[Width],
    out zero: bit,
    out carry: bit,

    let result: bit[Width];
    let zero: bit;
    let carry: bit;
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

## 16.5 シフトレジスタ

```rust
/// パラメータ化シフトレジスタ
mod ShiftRegister[Width: uint = 8, Depth: uint = 4] {
    in  clk: clock,
    in  rst: reset,
    in  enable: bit,
    in  din: bit[Width],
    out dout: bit[Width],
    out parallel_out: bit[Width][Depth],

    let stages: bit[Width][Depth] = [0; Depth];
    let dout: bit[Width];
    let parallel_out: bit[Width][Depth];

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

## 16.6 FSM例：UARTトランスミッタ制御

```rust
mod UartTxFsm {
    in  clk: clock,
    in  rst: reset,
    in  start: bit,
    in  bit_done: bit,
    in  byte_done: bit,
    out tx_en: bit,
    out shift_en: bit,
    out busy: bit,

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

## 16.7 AXI-Lite スレーブ

```rust
import iris_std::axi::AxiLite;

mod AxiLiteRegs[NumRegs: uint = 4] {
    in clk: clock,
    in rst: reset,
    target axi: AxiLite,
    out regs: bit[32][NumRegs],

    let registers: bit[32][NumRegs] = [0; NumRegs];
    let aw_ready: bit = 1;
    let w_ready: bit = 1;
    let b_valid: bit = 0;
    let ar_ready: bit = 1;
    let r_valid: bit = 0;
    let r_data: bit[32] = 0;
    let regs: bit[32][NumRegs];

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

## 16.8 優先度エンコーダ

```rust
/// パラメータ化優先度エンコーダ
mod PriorityEncoder[Width: uint = 8] {
    in  request: bit[Width],
    out grant: bit[$clog2(Width)],
    out valid: bit,

    let grant: bit[$clog2(Width)];
    let valid: bit;

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

## 16.9 デュアルポートRAM

```rust
mod DualPortRam[Width: uint = 32, Depth: uint = 1024] {
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

    #[synthesis(ram_style = "block")]
    mem storage: bit[Width][Depth] {
        ports: 2,
        type: true_dual_port,
        read_mode: read_first
    };

    let a_rdata: bit[Width];
    let b_rdata: bit[Width];

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

## 16.10 パイプライン乗算器

```rust
/// 3段パイプライン乗算器
mod PipelinedMultiplier[Width: uint = 16] {
    in  clk: clock,
    in  rst: reset,
    in  valid_in: bit,
    in  a: bit[Width],
    in  b: bit[Width],
    out valid_out: bit,
    out product: bit[Width * 2],

    // パイプラインレジスタ
    let stage1_a: bit[Width] = 0;
    let stage1_b: bit[Width] = 0;
    let stage1_valid: bit = 0;

    let stage2_partial: bit[Width * 2] = 0;
    let stage2_valid: bit = 0;

    let stage3_product: bit[Width * 2] = 0;
    let stage3_valid: bit = 0;

    let valid_out: bit;
    let product: bit[Width * 2];

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

## 16.11 クロックドメイン交差（CDC）

```rust
/// 2段フリップフロップ同期化器
mod Synchronizer[Width: uint = 1] {
    in  clk_dst: clock,
    in  rst: reset,
    in  async_in: bit[Width],
    out sync_out: bit[Width],

    let sync_ff1: bit[Width] = 0;
    let sync_ff2: bit[Width] = 0;
    let sync_out: bit[Width];

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

## 16.12 テストベンチ例

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

[<< 文法定義](./15_grammar.md) | [目次](./iris_spec_0.1.0.md) | [用語集 >>](./17_glossary.md)
