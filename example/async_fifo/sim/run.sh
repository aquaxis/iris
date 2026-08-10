#!/bin/bash
# Async FIFO Simulation Runner
# 非同期FIFOシミュレーション実行スクリプト
#
# Usage / 使い方:
#   ./run.sh [cycles]
#
# Default cycles / デフォルトサイクル数: 200
# サイクル数は書き込みクロック（10ns周期）を基準とする。
#
# Prerequisites / 前提条件:
#   - cargo がインストールされていること

set -u

CYCLES=${1:-200}
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
SIM_DIR="$PROJECT_ROOT/sim/iris-sim"
SRC_DIR="$SCRIPT_DIR/../src"
OUTPUT="$SCRIPT_DIR/output.vcd"
LOG="$SCRIPT_DIR/output.log"

echo "=== Async FIFO Simulation ==="
echo "Cycles: $CYCLES"
echo "Output: $OUTPUT"
echo ""

# ビルド（未ビルドの場合）
if [ ! -x "$SIM_DIR/target/debug/iris-sim" ]; then
    echo "Building iris-sim..."
    cargo build --manifest-path "$SIM_DIR/Cargo.toml" || exit 1
fi

# シミュレーション実行
echo "Running simulation..."
cargo run --quiet --bin iris-sim --manifest-path "$SIM_DIR/Cargo.toml" -- \
    -i "$SRC_DIR/async_fifo.iris" \
    -i "$SRC_DIR/async_fifo_tb.iris" \
    -o "$OUTPUT" \
    -c "$CYCLES" \
    -v | tee "$LOG"

if [ ! -f "$OUTPUT" ]; then
    echo ""
    echo "Simulation failed. Check error messages above."
    exit 1
fi

# 結果検証
# テストベンチは以下の信号で書き込み／読み出しの一致性を報告する。
#   wr_count  : DUTが受理した書き込み語数
#   rd_count  : 検証済みの読み出し語数
#   mismatch  : 期待値と異なるデータを読み出したら1にラッチされる
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

echo ""
echo "VCD output: $OUTPUT"
echo "View waveform with:"
echo "  gtkwave $OUTPUT"

exit $STATUS
