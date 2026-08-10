module sub (input logic a, output logic y);
  assign y = a;
endmodule
module top (input logic a, output logic y);
  sub u0 (.a(a), .y(y));
endmodule
