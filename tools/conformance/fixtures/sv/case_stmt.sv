module m (input logic clk, input logic [1:0] s, output logic [7:0] y);
  always_comb begin
    case (s)
      2'd0: y = 8'd1;
      2'd1: y = 8'd2;
      default: y = 8'd0;
    endcase
  end
endmodule
