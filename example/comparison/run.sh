#!/bin/bash
# IRIS / SystemVerilog / Veryl の比較を測り直す
#
# Usage / 使い方:
#   ./run.sh
#
# READMEの「SystemVerilogとの比較」に載っている数字を、すべてこの場で作り直す。
# 数字を引用する前に、まずここが通ることを確かめること。
#
# Prerequisites / 前提条件:
#   - veryl       (https://github.com/veryl-lang/veryl のリリースから取得)
#   - verilator
#   - cargo, node
#
# 段取り:
#   1. 同じ動作をすることを確かめる（等価性）
#   2. 行数と文字数を数える
#   3. 速度を測る
#
# 1が通らないうちは2と3に意味がない。
# 違う回路の行数を比べても、速い方が正しいとは限らないためである。

set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
WORK="$HERE/.work"
mkdir -p "$WORK"

have() { command -v "$1" >/dev/null 2>&1; }

for tool in veryl verilator node; do
    if ! have $tool; then
        echo "$tool が見つからない。前提条件を参照のこと。"
        exit 1
    fi
done

echo "=============================================="
echo " 1. 等価性 — 同じ入力に同じ出力を返すか"
echo "=============================================="

veryl build --quiet 2>/dev/null || veryl build >/dev/null 2>&1
node "$ROOT/tools/iris2sv/packages/cli/dist/cli.js" \
     "$ROOT/example/riscv/src/alu.iris" -o "$WORK" >/dev/null
node "$ROOT/tools/iris2sv/packages/cli/dist/cli.js" \
     "$ROOT/example/counter/src/counter.iris" -o "$WORK" >/dev/null

run_equiv() {
    local name=$1 tb=$2 iris_sv=$3 veryl_sv=$4
    verilator --binary --timing -Wno-fatal -o "$name" \
        "$HERE/equiv/$tb" "$iris_sv" "$veryl_sv" --top-module "${tb%.sv}" \
        --Mdir "$WORK/obj_$name" >/dev/null 2>&1
    "$WORK/obj_$name/$name" 2>&1 | grep -E "checks=|EQUIV|MISMATCH|after reset"
}

run_equiv alu_equiv alu_equiv.sv "$WORK/alu.sv"     "$HERE/target/alu.sv"
run_equiv ctr_equiv ctr_equiv.sv "$WORK/counter.sv" "$HERE/target/counter.sv"

echo
echo "=============================================="
echo " 2. 行数と文字数"
echo "=============================================="

code()  { grep -vE '^\s*(//|///)' "$1" | grep -vE '^\s*$' | wc -l; }
chars() { grep -vE '^\s*(//|///)' "$1" | grep -vE '^\s*$' | tr -d ' \t\n' | wc -c; }
longest() { awk '{ print length }' "$1" | sort -n | tail -1; }

printf "%-34s %8s %8s %8s\n" "" "コード行" "文字数" "最長行"
row() { printf "%-34s %8s %8s %8s\n" "$1" "$(code "$2")" "$(chars "$2")" "$(longest "$2")"; }

echo "-- ALU"
row "IRIS (手書き)"              "$ROOT/example/riscv/src/alu.iris"
row "SystemVerilog (iris2sv生成)" "$ROOT/example/riscv/sv/alu.sv"
row "Veryl (手書き)"             "$HERE/veryl/alu.veryl"

echo "-- Counter"
row "IRIS (手書き)"              "$ROOT/example/counter/src/counter.iris"
row "SystemVerilog (iris2sv生成)" "$WORK/counter.sv"
row "Veryl (手書き)"             "$HERE/veryl/counter.veryl"

echo "-- 設計5本の合計 (IRIS 対 SystemVerilog)"
ti=0; ts=0; ci=0; cs=0
for m in alu decoder regfile riscv_core; do
    i="$ROOT/example/riscv/src/$m.iris"; s="$ROOT/example/riscv/sv/$m.sv"
    ci=$((ci + $(code "$i"))); cs=$((cs + $(code "$s")))
    ti=$((ti + $(chars "$i"))); ts=$((ts + $(chars "$s")))
done
i="$ROOT/example/async_fifo/src/async_fifo.iris"; s="$ROOT/example/async_fifo/sv/async_fifo.sv"
ci=$((ci + $(code "$i"))); cs=$((cs + $(code "$s")))
ti=$((ti + $(chars "$i"))); ts=$((ts + $(chars "$s")))
printf "%-34s %8s %8s\n" "IRIS"                     "$ci" "$ti"
printf "%-34s %8s %8s\n" "SystemVerilog (iris2sv生成)" "$cs" "$ts"

echo
echo "=============================================="
echo " 3. 速度 — カウンタを回す"
echo "=============================================="

CYCLES=20000000
INTERP_CYCLES=1000000

median3() { printf '%s\n' "$1" "$2" "$3" | sort -n | sed -n 2p; }

time_it() {  # 3回走らせて中央値の秒数を返す
    local t=()
    for _ in 1 2 3; do
        local s=$( { /usr/bin/time -f "%e" "$@" >/dev/null; } 2>&1 | tail -1 )
        t+=("$s")
    done
    median3 "${t[0]}" "${t[1]}" "${t[2]}"
}

# IRIS インタプリタ
if [ -x "$ROOT/sim/iris-sim/target/release/iris-sim" ]; then
    t=$(time_it "$ROOT/sim/iris-sim/target/release/iris-sim" \
            -i "$ROOT/example/counter/src/counter.iris" -c $INTERP_CYCLES)
    printf "%-44s %6s s  (%s 反復)\n" "IRIS インタプリタ (iris-sim)" "$t" "$INTERP_CYCLES"
else
    echo "iris-sim が未ビルド: cargo build --release --manifest-path sim/iris-sim/Cargo.toml"
fi

# IRIS コンパイル型
if [ -x "$ROOT/sim/iris-sim/target/release/iris-compile" ]; then
    "$ROOT/sim/iris-sim/target/release/iris-compile" \
        -i "$ROOT/example/counter/src/counter.iris" \
        -o "$WORK/counter_sim" --release \
        --runtime-path "$ROOT/sim/iris-runtime" >/dev/null 2>&1
    if [ -x "$WORK/counter_sim" ]; then
        t=$(time_it "$WORK/counter_sim" -c $CYCLES)
        printf "%-44s %6s s  (%s 反復)\n" "IRIS コンパイル型 (iris-compile)" "$t" "$CYCLES"
    fi
fi

# Verilator の2経路
cat > "$WORK/bench.tmpl" <<'EOF'
module bench;
  logic clk = 0, rst = 0, enable = 1;
  logic [7:0] count;
  DUTNAME dut (.clk(clk), .rst(rst), .enable(enable), .count(count));
  localparam int unsigned CYCLES = NCYCLES;
  initial begin
    for (int unsigned i = 0; i < CYCLES; i++) begin
      clk = 1; #1; clk = 0; #1;
    end
    $display("cycles=%0d final=%0d", CYCLES, count);
    $finish;
  end
endmodule
EOF

bench_one() {
    local tag=$1 dut=$2 sv=$3
    sed -e "s/DUTNAME/$dut/" -e "s/NCYCLES/$CYCLES/" "$WORK/bench.tmpl" > "$WORK/bench_$tag.sv"
    verilator --binary --timing -Wno-fatal -O3 --x-assign fast --x-initial fast \
        -o "bench_$tag" "$WORK/bench_$tag.sv" "$sv" --top-module bench \
        --Mdir "$WORK/obj_bench_$tag" >/dev/null 2>&1
    local t; t=$(time_it "$WORK/obj_bench_$tag/bench_$tag")
    printf "%-44s %6s s  (%s 反復)\n" "$4" "$t" "$CYCLES"
}

bench_one iris  Counter            "$WORK/counter.sv"      "Verilator (IRIS -> iris2sv, SVテストベンチ)"
bench_one veryl comparison_Counter "$HERE/target/counter.sv" "Verilator (Veryl -> veryl build, SVテストベンチ)"

# Verilator を本来の速さで走らせたもの。
# 上の2つは SystemVerilog のテストベンチを #1 遅延で駆動しており、
# タイミングモードの分だけ遅い。ネイティブのループで駆動した
# iris-compile と比べるなら、こちらが相手である。
cat > "$WORK/vmain.cpp" <<EOF
#include "VCounter.h"
#include "verilated.h"
#include <cstdio>
int main(int argc, char** argv) {
    VerilatedContext ctx; ctx.commandArgs(argc, argv);
    VCounter dut{&ctx};
    dut.rst = 0; dut.enable = 1;
    const long N = $CYCLES;
    for (long i = 0; i < N; i++) { dut.clk = 1; dut.eval(); dut.clk = 0; dut.eval(); }
    dut.final();
    printf("cycles=%ld final=%u\n", N, (unsigned)dut.count);
    return 0;
}
EOF
# Verilator's own default is OPT_FAST=-Os. iris-compile builds with -O3 and
# fat LTO, so the C++ side is given the same treatment; otherwise the
# comparison measures build flags rather than simulators.
verilator --cc -O3 --x-assign fast --x-initial fast --build -Wno-fatal \
    "$WORK/counter.sv" --exe "$WORK/vmain.cpp" --top-module Counter \
    -o vfast --Mdir "$WORK/obj_vfast" \
    -CFLAGS "-O3 -flto" -LDFLAGS "-O3 -flto" >/dev/null 2>&1
if [ -x "$WORK/obj_vfast/vfast" ]; then
    t=$(time_it "$WORK/obj_vfast/vfast")
    printf "%-44s %6s s  (%s 反復)\n" "Verilator (C++ハーネス, eval(), -O3 -flto)" "$t" "$CYCLES"
fi

echo
echo "計測環境: $(grep -m1 'model name' /proc/cpuinfo | sed 's/.*: //')"
echo "          $(verilator --version) / veryl $(veryl --version | awk '{print $2}')"
