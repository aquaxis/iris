#!/usr/bin/env bash
# The designs the formal flow covers, and what each one needs.
#
# Sourced by run.sh. Kept apart so that adding a design is one line here and
# nothing anywhere else.
#
# Each entry is:
#   <name>|<top module>|<iris source(s), space separated>
#
# The sources are given in dependency order, the top module last, because
# iris2sv and iris-sim both take them that way.

RISCV_SRC="example/riscv/src"

DESIGNS=(
    "alu|Alu|$RISCV_SRC/alu.iris"
    "decoder|Decoder|$RISCV_SRC/decoder.iris"
    "counter|Counter|example/counter/src/counter.iris"
    "regfile|RegFile|$RISCV_SRC/regfile.iris"
    "riscv_core|RiscvCore|$RISCV_SRC/regfile.iris $RISCV_SRC/alu.iris $RISCV_SRC/decoder.iris $RISCV_SRC/riscv_core.iris"
    "async_fifo|AsyncFifo|example/async_fifo/src/async_fifo.iris"
)

# Designs excluded from the equivalence stage, with the reason.
#
# `async_fifo` was here on the argument that cycle-accurate equivalence is not
# defined across an asynchronous boundary. That argument was wrong for what this
# flow actually does: equiv_make treats both clocks as free inputs and proves the
# two netlists behave identically for any waveform on either, which is
# well-defined and was proven, 178 cells of 178.
#
# What that does not say is anything about the crossing being correct. A
# synchroniser deep enough for the metastability it faces is a question about
# the design, not about whether the transpiler preserved it. That stays with the
# vector benches.
EXCLUDED=""

# Mutations: a change that is semantically real and textually small.
#
# Every one of these must make the proof FAIL. A mutation the flow proves
# equivalent is a defect in the flow, not in the design.
#
# Each entry is:
#   <design>|<description>|<sed expression applied to the generated SystemVerilog>
MUTATIONS=(
    "alu|signed compare in the SLT arm made unsigned|s/op == 4'd3 ? sa < sb/op == 4'd3 ? a < b/"
    "alu|SRL and SRA swapped|s/op == 4'd7 ? sra_result/op == 4'd7 ? (a >> shamt)/"
    "counter|counter increments by two|s/counter + 1/counter + 2/"
    "decoder|the I-type immediate loses its sign extension|s/imm_i = 32'(\$signed(instr\[31:20\]))/imm_i = {20'h0, instr[31:20]}/"
    "regfile|writes to x0 are no longer discarded|s/waddr != 5'd0/1'b1/"
)
