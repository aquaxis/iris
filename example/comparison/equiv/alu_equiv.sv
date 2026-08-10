// Compare the IRIS-derived ALU against the hand-written Veryl one.
//
// The point is not that both compile. It is that for the same inputs they
// produce the same output, so a line count taken across the two is a count of
// two things that do the same job.
module alu_equiv;

  logic [3:0]  op;
  logic [31:0] a, b;
  logic [31:0] y_iris, y_veryl;

  Alu       u_iris  (.op(op), .a(a), .b(b), .y(y_iris));
  comparison_Alu u_veryl (.op(op), .a(a), .b(b), .y(y_veryl));

  int unsigned mismatches = 0;
  int unsigned checks = 0;

  // Values that have caught sign errors before: the boundaries, not the middle
  localparam int unsigned N_EDGE = 8;
  logic [31:0] edges [N_EDGE] = '{
    32'h0000_0000, 32'h0000_0001, 32'h7FFF_FFFF, 32'h8000_0000,
    32'hFFFF_FFFF, 32'hFFFF_FFFE, 32'h0000_001F, 32'h0000_0020
  };

  task automatic check();
    checks++;
    #1;
    if (y_iris !== y_veryl) begin
      mismatches++;
      if (mismatches <= 10)
        $display("MISMATCH op=%0d a=%h b=%h  iris=%h veryl=%h",
                 op, a, b, y_iris, y_veryl);
    end
  endtask

  initial begin
    // Every operation against every pair of edge values
    for (int o = 0; o < 16; o++) begin
      op = o[3:0];
      for (int i = 0; i < N_EDGE; i++) begin
        for (int j = 0; j < N_EDGE; j++) begin
          a = edges[i];
          b = edges[j];
          check();
        end
      end
    end

    // Random vectors on top of the edges
    for (int o = 0; o < 16; o++) begin
      op = o[3:0];
      for (int k = 0; k < 2000; k++) begin
        a = {$urandom(), $urandom()};
        b = {$urandom(), $urandom()};
        check();
      end
    end

    $display("checks=%0d mismatches=%0d", checks, mismatches);
    if (mismatches == 0) $display("EQUIVALENT");
    else                 $display("NOT EQUIVALENT");
    $finish;
  end

endmodule
