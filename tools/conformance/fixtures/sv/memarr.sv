module m (input logic clk, input logic we, input logic [3:0] addr, input logic [7:0] wd, output logic [7:0] y);
  logic [7:0] ram [0:15];
  always_ff @(posedge clk) if (we) ram[addr] <= wd;
  assign y = ram[addr];
endmodule
