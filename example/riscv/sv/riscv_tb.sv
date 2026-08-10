// TestAluSv — RomAlu を繋いだテストベンチ
//
// example/riscv/src/test_alu.iris と同じ検証を行う。
// IRIS版から機械変換したものではなく、同じ意味を持つように書いたものである。
// iris2svはテストモジュール（test）をまだ変換できない。
//
// 変換したコアを、変換に使っていない経路で検証することになるため、
// トランスパイラの不具合がテストベンチ側にも同じ形で現れて打ち消し合うことがない。
//
// 期待値はRISC-Vの仕様から導いたものであり、このコアが出した値ではない。
module TestAluSv;

  logic clk = 1'b0;
  logic rst_n = 1'b0;
  always #5 clk = ~clk;

  logic [31:0] imem_addr;
  logic [31:0] imem_rdata;
  logic [31:0] pc_out;
  logic        halted;
  logic        illegal_op;
  logic [4:0]  dbg_addr;
  logic [31:0] dbg_data;

  RomAlu rom (.addr(imem_addr), .rdata(imem_rdata));

  RiscvCore dut (
    .clk(clk), .rst_n(rst_n),
    .imem_addr(imem_addr), .imem_rdata(imem_rdata),
    .pc_out(pc_out), .halted(halted), .illegal_op(illegal_op),
    .dbg_addr(dbg_addr), .dbg_data(dbg_data)
  );

  int          idx = 0;
  int          fails = 0;
  logic [31:0] expected;
  int          cycles = 0;

  // 期待値表。プログラムが書き換えないレジスタは0のままである。
  always_comb begin
    case (idx)
      6'd0: expected = 32'h00000000;
      6'd1: expected = 32'h0000000C;
      6'd2: expected = 32'h00000005;
      6'd3: expected = 32'h00000011;
      6'd4: expected = 32'h00000007;
      6'd5: expected = 32'h000000A0;
      6'd6: expected = 32'h00000001;
      6'd7: expected = 32'h00000000;
      6'd8: expected = 32'h00000009;
      6'd9: expected = 32'h07FFFFFF;
      6'd10: expected = 32'hFFFFFFFF;
      6'd11: expected = 32'h0000000D;
      6'd12: expected = 32'h00000004;
      6'd13: expected = 32'h0000000B;
      6'd14: expected = 32'h00000001;
      6'd15: expected = 32'h00000000;
      6'd16: expected = 32'hFFFFFFF3;
      6'd17: expected = 32'h0000000F;
      6'd18: expected = 32'h00000004;
      6'd19: expected = 32'h000000C0;
      6'd20: expected = 32'h0FFFFFFF;
      6'd21: expected = 32'hFFFFFFFF;
      6'd22: expected = 32'h12345000;
      6'd23: expected = 32'h00000000;
      6'd24: expected = 32'h00000000;
      6'd25: expected = 32'h00000000;
      6'd26: expected = 32'h00000000;
      6'd27: expected = 32'h00000000;
      6'd28: expected = 32'h00000000;
      6'd29: expected = 32'h00000000;
      6'd30: expected = 32'h00000000;
      6'd31: expected = 32'hFFFFFFF0;
      default: expected = 32'h0;
    endcase
  end

  assign dbg_addr = idx[4:0];

  initial begin
    rst_n = 1'b0;
    #100;
    rst_n = 1'b1;
  end

  always @(posedge clk) begin
    if (!rst_n) begin
      idx <= 0; fails <= 0; cycles <= 0;
    end else begin
      cycles <= cycles + 1;

      // 打ち切り。コアが停止しないと検証そのものが走らず、
      // 何も報告しないまま成功扱いで終わってしまう。
      if (!halted && cycles == 400) begin
        $display("");
        $display("=== TestAluSv ===");
        $display("  RESULT: FAIL - core did not halt within 400 cycles");
        $finish;
      end

      if (halted) begin
        if (dbg_data !== expected) begin
          fails <= fails + 1;
          $display("FAIL x%0d: expected %0d, got %0d", idx, expected, dbg_data);
        end
        if (idx == 31) begin
          $display("");
          $display("=== TestAluSv ===");
          $display("  instructions verified: 21");
          $display("  registers checked:     32");
          $display("  mismatches:            %0d", (dbg_data !== expected) ? fails + 1 : fails);
          if (((dbg_data !== expected) ? fails + 1 : fails) == 0)
            $display("  RESULT: PASS");
          else
            $display("  RESULT: FAIL");
          $finish;
        end else begin
          idx <= idx + 1;
        end
      end
    end
  end

endmodule


// TestMemSv — RomMem を繋いだテストベンチ
//
// example/riscv/src/test_mem.iris と同じ検証を行う。
// IRIS版から機械変換したものではなく、同じ意味を持つように書いたものである。
// iris2svはテストモジュール（test）をまだ変換できない。
//
// 変換したコアを、変換に使っていない経路で検証することになるため、
// トランスパイラの不具合がテストベンチ側にも同じ形で現れて打ち消し合うことがない。
//
// 期待値はRISC-Vの仕様から導いたものであり、このコアが出した値ではない。
module TestMemSv;

  logic clk = 1'b0;
  logic rst_n = 1'b0;
  always #5 clk = ~clk;

  logic [31:0] imem_addr;
  logic [31:0] imem_rdata;
  logic [31:0] pc_out;
  logic        halted;
  logic        illegal_op;
  logic [4:0]  dbg_addr;
  logic [31:0] dbg_data;

  RomMem rom (.addr(imem_addr), .rdata(imem_rdata));

  RiscvCore dut (
    .clk(clk), .rst_n(rst_n),
    .imem_addr(imem_addr), .imem_rdata(imem_rdata),
    .pc_out(pc_out), .halted(halted), .illegal_op(illegal_op),
    .dbg_addr(dbg_addr), .dbg_data(dbg_data)
  );

  int          idx = 0;
  int          fails = 0;
  logic [31:0] expected;
  int          cycles = 0;

  // 期待値表。プログラムが書き換えないレジスタは0のままである。
  always_comb begin
    case (idx)
      6'd0: expected = 32'h00000000;
      6'd1: expected = 32'h00000100;
      6'd2: expected = 32'h89ABCDEF;
      6'd3: expected = 32'h89ABCDEF;
      6'd4: expected = 32'hFFFFFFEF;
      6'd5: expected = 32'h000000EF;
      6'd6: expected = 32'hFFFFCDEF;
      6'd7: expected = 32'h0000CDEF;
      6'd8: expected = 32'hFFFFFF89;
      6'd9: expected = 32'h000089AB;
      6'd10: expected = 32'h0000007F;
      6'd11: expected = 32'h0000007F;
      6'd12: expected = 32'h00000123;
      6'd13: expected = 32'h00000123;
      6'd14: expected = 32'h0000005A;
      6'd15: expected = 32'h0000005A;
      6'd16: expected = 32'h00000008;
      6'd17: expected = 32'h00000000;
      6'd18: expected = 32'h00000000;
      6'd19: expected = 32'h00000000;
      6'd20: expected = 32'h000000A8;
      6'd21: expected = 32'h00000000;
      6'd22: expected = 32'h00000000;
      6'd23: expected = 32'h000000BD;
      6'd24: expected = 32'h000000B8;
      6'd25: expected = 32'h000000BC;
      6'd26: expected = 32'h00000000;
      6'd27: expected = 32'h000000C4;
      6'd28: expected = 32'h000000C4;
      6'd29: expected = 32'h00000000;
      6'd30: expected = 32'h0000002A;
      6'd31: expected = 32'h00000000;
      default: expected = 32'h0;
    endcase
  end

  assign dbg_addr = idx[4:0];

  initial begin
    rst_n = 1'b0;
    #100;
    rst_n = 1'b1;
  end

  always @(posedge clk) begin
    if (!rst_n) begin
      idx <= 0; fails <= 0; cycles <= 0;
    end else begin
      cycles <= cycles + 1;

      // 打ち切り。コアが停止しないと検証そのものが走らず、
      // 何も報告しないまま成功扱いで終わってしまう。
      if (!halted && cycles == 400) begin
        $display("");
        $display("=== TestMemSv ===");
        $display("  RESULT: FAIL - core did not halt within 400 cycles");
        $finish;
      end

      if (halted) begin
        if (dbg_data !== expected) begin
          fails <= fails + 1;
          $display("FAIL x%0d: expected %0d, got %0d", idx, expected, dbg_data);
        end
        if (idx == 31) begin
          $display("");
          $display("=== TestMemSv ===");
          $display("  instructions verified: 17");
          $display("  registers checked:     32");
          $display("  mismatches:            %0d", (dbg_data !== expected) ? fails + 1 : fails);
          if (((dbg_data !== expected) ? fails + 1 : fails) == 0)
            $display("  RESULT: PASS");
          else
            $display("  RESULT: FAIL");
          $finish;
        end else begin
          idx <= idx + 1;
        end
      end
    end
  end

endmodule


// TestSysSv — RomSys を繋いだテストベンチ
//
// example/riscv/src/test_sys.iris と同じ検証を行う。
// IRIS版から機械変換したものではなく、同じ意味を持つように書いたものである。
// iris2svはテストモジュール（test）をまだ変換できない。
//
// 変換したコアを、変換に使っていない経路で検証することになるため、
// トランスパイラの不具合がテストベンチ側にも同じ形で現れて打ち消し合うことがない。
//
// 期待値はRISC-Vの仕様から導いたものであり、このコアが出した値ではない。
module TestSysSv;

  logic clk = 1'b0;
  logic rst_n = 1'b0;
  always #5 clk = ~clk;

  logic [31:0] imem_addr;
  logic [31:0] imem_rdata;
  logic [31:0] pc_out;
  logic        halted;
  logic        illegal_op;
  logic [4:0]  dbg_addr;
  logic [31:0] dbg_data;

  RomSys rom (.addr(imem_addr), .rdata(imem_rdata));

  RiscvCore dut (
    .clk(clk), .rst_n(rst_n),
    .imem_addr(imem_addr), .imem_rdata(imem_rdata),
    .pc_out(pc_out), .halted(halted), .illegal_op(illegal_op),
    .dbg_addr(dbg_addr), .dbg_data(dbg_data)
  );

  int          idx = 0;
  int          fails = 0;
  logic [31:0] expected;
  int          cycles = 0;

  // 期待値表。プログラムが書き換えないレジスタは0のままである。
  always_comb begin
    case (idx)
      6'd0: expected = 32'h00000000;
      6'd1: expected = 32'h00000001;
      6'd2: expected = 32'h00000002;
      6'd3: expected = 32'h00000000;
      6'd4: expected = 32'h00000000;
      6'd5: expected = 32'h00000000;
      6'd6: expected = 32'h00000000;
      6'd7: expected = 32'h00000000;
      6'd8: expected = 32'h00000000;
      6'd9: expected = 32'h00000000;
      6'd10: expected = 32'h00000000;
      6'd11: expected = 32'h00000000;
      6'd12: expected = 32'h00000000;
      6'd13: expected = 32'h00000000;
      6'd14: expected = 32'h00000000;
      6'd15: expected = 32'h00000000;
      6'd16: expected = 32'h00000000;
      6'd17: expected = 32'h00000000;
      6'd18: expected = 32'h00000000;
      6'd19: expected = 32'h00000000;
      6'd20: expected = 32'h00000000;
      6'd21: expected = 32'h00000000;
      6'd22: expected = 32'h00000000;
      6'd23: expected = 32'h00000000;
      6'd24: expected = 32'h00000000;
      6'd25: expected = 32'h00000000;
      6'd26: expected = 32'h00000000;
      6'd27: expected = 32'h00000000;
      6'd28: expected = 32'h00000000;
      6'd29: expected = 32'h00000000;
      6'd30: expected = 32'h00000000;
      6'd31: expected = 32'h00000000;
      default: expected = 32'h0;
    endcase
  end

  assign dbg_addr = idx[4:0];

  initial begin
    rst_n = 1'b0;
    #100;
    rst_n = 1'b1;
  end

  always @(posedge clk) begin
    if (!rst_n) begin
      idx <= 0; fails <= 0; cycles <= 0;
    end else begin
      cycles <= cycles + 1;

      // 打ち切り。コアが停止しないと検証そのものが走らず、
      // 何も報告しないまま成功扱いで終わってしまう。
      if (!halted && cycles == 400) begin
        $display("");
        $display("=== TestSysSv ===");
        $display("  RESULT: FAIL - core did not halt within 400 cycles");
        $finish;
      end

      if (halted) begin
        if (dbg_data !== expected) begin
          fails <= fails + 1;
          $display("FAIL x%0d: expected %0d, got %0d", idx, expected, dbg_data);
        end
        if (idx == 31) begin
          $display("");
          $display("=== TestSysSv ===");
          $display("  instructions verified: 2");
          $display("  registers checked:     32");
          $display("  mismatches:            %0d", (dbg_data !== expected) ? fails + 1 : fails);
          if (((dbg_data !== expected) ? fails + 1 : fails) == 0)
            $display("  RESULT: PASS");
          else
            $display("  RESULT: FAIL");
          $finish;
        end else begin
          idx <= idx + 1;
        end
      end
    end
  end

endmodule
