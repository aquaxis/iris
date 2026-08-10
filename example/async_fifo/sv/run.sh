#!/bin/bash
# Async FIFO SystemVerilog Simulation Runner
# 非同期FIFO SystemVerilogシミュレーション実行スクリプト
#
# Usage / 使い方:
#   ./run.sh [--regenerate]
#
#   --regenerate  IRISソースからasync_fifo.svを変換し直す
#
# IRISからSystemVerilogへ変換したDUTを、SystemVerilogシミュレータで実行する。
# 期待する結果はIRIS版（../sim/run.sh）と同じである。
#   wr_count = 40、rd_count = 40、mismatch = 0
#
# Prerequisites / 前提条件:
#   - verilator がインストールされていること
#   - --regenerate を使う場合は node と pnpm も必要

set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
SRC_DIR="$SCRIPT_DIR/../src"
IRIS2SV="$PROJECT_ROOT/tools/iris2sv"
LOG="$SCRIPT_DIR/output.log"

echo "=== Async FIFO SystemVerilog Simulation ==="
echo ""

# ===== 変換（任意） =====
if [ "${1:-}" = "--regenerate" ]; then
    if [ ! -f "$IRIS2SV/packages/cli/dist/cli.js" ]; then
        echo "Building iris2sv..."
        (cd "$IRIS2SV" && \
         pnpm install --config.manage-package-manager-versions=false && \
         pnpm -r --config.manage-package-manager-versions=false build) || exit 1
    fi
    echo "Converting async_fifo.iris to SystemVerilog..."
    node "$IRIS2SV/packages/cli/dist/cli.js" \
        "$SRC_DIR/async_fifo.iris" -o "$SCRIPT_DIR" || exit 1
    echo ""
fi

if ! command -v verilator >/dev/null 2>&1; then
    echo "verilator not found. Install it and try again."
    exit 1
fi

# ===== ビルド =====
echo "Building simulation..."
verilator --binary --timing --trace -Wno-fatal \
    -o sim_verilator --Mdir "$SCRIPT_DIR/obj_dir" \
    "$SCRIPT_DIR/async_fifo.sv" "$SCRIPT_DIR/async_fifo_tb.sv" \
    --top-module AsyncFifoTB > /dev/null 2>&1 || {
    echo "Build failed. Re-running to show errors:"
    verilator --binary --timing --trace -Wno-fatal \
        -o sim_verilator --Mdir "$SCRIPT_DIR/obj_dir" \
        "$SCRIPT_DIR/async_fifo.sv" "$SCRIPT_DIR/async_fifo_tb.sv" \
        --top-module AsyncFifoTB
    exit 1
}

# ===== 実行 =====
echo "Running simulation..."
echo ""
(cd "$SCRIPT_DIR" && ./obj_dir/sim_verilator) | tee "$LOG"

# ===== 結果検証 =====
# テストベンチ自身がPASS／FAILを表示する。
# ここではそれを読み、スクリプトの終了コードに反映する。
if grep -q "RESULT: PASS" "$LOG"; then
    STATUS=0
else
    STATUS=1
fi

echo ""
if [ -f "$SCRIPT_DIR/output.vcd" ]; then
    echo "VCD output: $SCRIPT_DIR/output.vcd"
    echo "View waveform with:"
    echo "  gtkwave $SCRIPT_DIR/output.vcd"
fi

exit $STATUS
