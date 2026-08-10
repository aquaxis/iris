// Compare the IRIS-derived counter against the hand-written Veryl one.
module ctr_equiv;

  logic clk = 0, rst = 0, enable = 0;
  logic [7:0] c_iris, c_veryl;

  Counter       u_iris  (.clk(clk), .rst(rst), .enable(enable), .count(c_iris));
  comparison_Counter u_veryl (.clk(clk), .rst(rst), .enable(enable), .count(c_veryl));

  int unsigned mismatches = 0, checks = 0;

  always #5 clk = ~clk;

  task automatic step();
    @(posedge clk);
    #1;
    checks++;
    if (c_iris !== c_veryl) begin
      mismatches++;
      if (mismatches <= 5)
        $display("MISMATCH t=%0t enable=%0b rst=%0b  iris=%0d veryl=%0d",
                 $time, enable, rst, c_iris, c_veryl);
    end
  endtask

  initial begin
    // Both start from a known value
    enable = 0;
    repeat (2) @(posedge clk);

    // Plain counting, reset held low throughout
    enable = 1;
    repeat (300) step();

    // Enable toggling
    for (int i = 0; i < 200; i++) begin
      enable = $urandom_range(0, 1);
      step();
    end

    $display("clocked checks=%0d mismatches=%0d", checks, mismatches);

    // Now exercise reset, which is where the two differ in the emitted RTL:
    // IRIS lists `or posedge rst` on the always_ff, Veryl does not.
    $display("--- pulsing reset ---");
    enable = 0;
    #2 rst = 1;
    #2 rst = 0;
    #2;
    $display("after reset pulse: iris=%0d veryl=%0d %s",
             c_iris, c_veryl, (c_iris === c_veryl) ? "same" : "DIFFERENT");

    if (mismatches == 0) $display("EQUIVALENT_CLOCKED");
    else                 $display("NOT EQUIVALENT");
    $finish;
  end

endmodule
