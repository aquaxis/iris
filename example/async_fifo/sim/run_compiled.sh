#!/bin/bash
# Async FIFO Simulation Runner (compiled)
# 非同期FIFOシミュレーション実行スクリプト（コンパイル版）
#
# Usage / 使い方:
#   ./run_compiled.sh [cycles]
#
# run.sh はインタプリタ（iris-sim）で実行する。
# こちらは iris-compile で設計をRustプログラムに変換し、それを実行する。
# 両者は同じ波形と同じ最終値を出力する。
#
# Default cycles / デフォルトサイクル数: 200
#
# Prerequisites / 前提条件:
#   - cargo がインストールされていること

set -u

CYCLES=${1:-200}
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
SIM_DIR="$PROJECT_ROOT/sim/iris-sim"
RUNTIME_DIR="$PROJECT_ROOT/sim/iris-runtime"
SRC_DIR="$SCRIPT_DIR/../src"
BUILD_DIR="$SCRIPT_DIR/compiled"
BINARY="$BUILD_DIR/async_fifo_sim"
OUTPUT="$SCRIPT_DIR/output_compiled.vcd"
LOG="$SCRIPT_DIR/output_compiled.log"

echo "=== Async FIFO Simulation (compiled) ==="
echo "Cycles: $CYCLES"
echo "Output: $OUTPUT"
echo ""

mkdir -p "$BUILD_DIR"

# 設計をRustプログラムに変換してビルドする
echo "Compiling design to Rust..."
cargo run --quiet --bin iris-compile --manifest-path "$SIM_DIR/Cargo.toml" -- \
    -i "$SRC_DIR/async_fifo.iris" \
    -i "$SRC_DIR/async_fifo_tb.iris" \
    -o "$BINARY" \
    --release \
    --runtime-path "$RUNTIME_DIR" || exit 1

echo ""
echo "Running simulation..."
"$BINARY" -c "$CYCLES" -o "$OUTPUT" -v | tee "$LOG"

if [ ! -f "$OUTPUT" ]; then
    echo ""
    echo "Simulation failed. Check error messages above."
    exit 1
fi

# 結果検証（run.sh と同じ判定）
value_of() {
    grep -E "^[[:space:]]+$1: " "$LOG" | tail -1 | sed -E "s/.*: [0-9]+'h([0-9a-fA-F]+).*/\1/"
}

WR_COUNT=$(value_of wr_count)
RD_COUNT=$(value_of rd_count)
MISMATCH=$(value_of mismatch)

echo ""
echo "=== Verification ==="
printf "  words written (wr_count): %d\n" "0x${WR_COUNT:-0}"
printf "  words verified (rd_count): %d\n" "0x${RD_COUNT:-0}"
printf "  data mismatch flag:        %d\n" "0x${MISMATCH:-1}"

if [ "$((0x${MISMATCH:-1}))" -eq 0 ] && [ "$((0x${RD_COUNT:-0}))" -eq 40 ] &&
   [ "$((0x${WR_COUNT:-0}))" -eq 40 ]; then
    echo "  RESULT: PASS - all 40 words read back in order"
    STATUS=0
else
    echo "  RESULT: FAIL - read data does not match expected values"
    STATUS=1
fi

# インタプリタの波形があれば一致を確認する
if [ -f "$SCRIPT_DIR/output.vcd" ]; then
    echo ""
    if diff -q "$SCRIPT_DIR/output.vcd" "$OUTPUT" > /dev/null; then
        echo "  waveform matches the interpreter's output.vcd"
    else
        echo "  WARNING: waveform differs from the interpreter's output.vcd"
        STATUS=1
    fi
fi

echo ""
echo "VCD output: $OUTPUT"
echo "View waveform with:"
echo "  gtkwave $OUTPUT"

exit $STATUS
