// AsyncFifo テストベンチ（SystemVerilog）
//
// example/async_fifo/src/async_fifo_tb.iris と同じ検証を行う。
// IRIS版から機械変換したものではなく、同じ意味を持つように書いたものである。
// iris2svはテストモジュール（test）をまだ変換できない。
//
// 変換したDUTを、変換に使ったのとは別の経路で検証することになるため、
// トランスパイラの不具合がテストベンチ側にも同じ形で現れて
// 打ち消し合うことがない。
//
// 書き込みクロック10ns周期、読み出しクロック25ns周期。
// 読み出し側が2.5倍遅いため、FIFOは途中でフルに達し、書き込みが止まる。
//
// 期待する結果はIRIS版と同じである。
//   wr_count = 40、rd_count = 40、mismatch = 0

`timescale 1ns / 1ps

module AsyncFifoTB;

  localparam int DataWidth = 8;
  localparam int Depth     = 16;
  localparam int Words     = 40;

  // ===== クロック・リセット =====
  logic wr_clk = 1'b0;
  logic rd_clk = 1'b0;
  logic wr_rst_n = 1'b0;
  logic rd_rst_n = 1'b0;

  always #5.0  wr_clk = ~wr_clk;   // 10ns周期
  always #12.5 rd_clk = ~rd_clk;   // 25ns周期

  // ===== 書き込み側のテスト信号 =====
  logic                 wr_en   = 1'b0;
  logic [DataWidth-1:0] wr_data = 8'd1;
  logic [7:0]           wr_count = 8'd0;

  // ===== 読み出し側のテスト信号 =====
  logic                 rd_en       = 1'b0;
  logic [DataWidth-1:0] rd_data_obs = 8'd0;
  logic [DataWidth-1:0] expected    = 8'd1;
  logic [7:0]           rd_count    = 8'd0;
  logic                 mismatch    = 1'b0;

  // ===== DUT =====
  logic full;
  logic empty;
  logic [DataWidth-1:0] rd_data;

  AsyncFifo #(
    .DataWidth(DataWidth),
    .Depth(Depth)
  ) dut (
    .wr_clk   (wr_clk),
    .wr_rst_n (wr_rst_n),
    .wr_en    (wr_en),
    .wr_data  (wr_data),
    .rd_clk   (rd_clk),
    .rd_rst_n (rd_rst_n),
    .rd_en    (rd_en),
    .full     (full),
    .empty    (empty),
    .rd_data  (rd_data)
  );

  // ===== リセット =====
  // IRISは既定で5サイクル保持してから解除する。
  // 検証する語数は書き込み側と読み出し側の数え上げで決まるため、
  // 解除の時刻そのものは結果を変えない。
  initial begin
    wr_rst_n = 1'b0;
    rd_rst_n = 1'b0;
    #100;
    wr_rst_n = 1'b1;
    rd_rst_n = 1'b1;
  end

  // ===== 書き込みドメイン =====
  // wr_enを保持し、DUTが受理した（wr_enかつフルでない）エッジでのみ次へ進む。
  always_ff @(posedge wr_clk or negedge wr_rst_n) begin
    if (!wr_rst_n) begin
      wr_en    <= 1'b0;
      wr_data  <= 8'd1;
      wr_count <= 8'd0;
    end else begin
      if (wr_en) begin
        if (!full) begin
          wr_data  <= wr_data + 8'd1;
          wr_count <= wr_count + 8'd1;
          wr_en    <= ((wr_count + 8'd1) < Words) ? 1'b1 : 1'b0;
        end else begin
          wr_en <= 1'b1;
        end
      end else begin
        wr_en <= (wr_count < Words) ? 1'b1 : 1'b0;
      end
    end
  end

  // ===== 読み出しドメイン =====
  // rd_enを保持し、エンプティでないエッジで読み出しデータを検証する。
  always_ff @(posedge rd_clk or negedge rd_rst_n) begin
    if (!rd_rst_n) begin
      rd_en       <= 1'b0;
      rd_data_obs <= 8'd0;
      expected    <= 8'd1;
      rd_count    <= 8'd0;
      mismatch    <= 1'b0;
    end else begin
      if (rd_en) begin
        if (!empty) begin
          rd_data_obs <= rd_data;

          if (rd_data != expected) begin
            mismatch <= 1'b1;
          end
          assert (rd_data == expected)
            else $error("読み出しデータが期待値と一致しない: got %0d, expected %0d",
                        rd_data, expected);

          expected <= expected + 8'd1;
          rd_count <= rd_count + 8'd1;

          if ((rd_count + 8'd1) == Words) begin
            $display("all %0d words verified at %0t", rd_count + 8'd1, $time);
            report_and_finish(rd_count + 8'd1);
          end
        end
      end

      rd_en <= 1'b1;
    end
  end

  // 検証結果をIRIS版のrun.shと同じ形で出力する
  task automatic report_and_finish(input logic [7:0] verified);
    $display("");
    $display("=== Verification ===");
    $display("  words written (wr_count): %0d", wr_count);
    $display("  words verified (rd_count): %0d", verified);
    $display("  data mismatch flag:        %0d", mismatch);
    if (mismatch === 1'b0 && verified == Words) begin
      $display("  RESULT: PASS - all %0d words read back in order", Words);
    end else begin
      $display("  RESULT: FAIL - read data does not match expected values");
    end
    $finish;
  endtask

  // 波形
  initial begin
    $dumpfile("output.vcd");
    $dumpvars(0, AsyncFifoTB);
  end

  // 打ち切り。DUTが停止した場合にシミュレーションを終わらせる
  initial begin
    #200000;
    $display("  RESULT: FAIL - timeout, %0d of %0d words verified", rd_count, Words);
    $finish;
  end

endmodule
