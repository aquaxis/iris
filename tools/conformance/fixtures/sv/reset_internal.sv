module internal_probe (
    input  logic clk,
    input  logic rst_n,
    input  logic en,
    output logic [7:0] count
);
    logic [7:0] counter;
    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n) counter <= 8'd5;
        else if (en) counter <= counter + 8'd1;
    end
    assign count = counter;
endmodule
