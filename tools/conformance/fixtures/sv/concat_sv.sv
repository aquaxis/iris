module m (input logic [3:0] a, output logic [7:0] y);
  assign y = {a, a};
endmodule
