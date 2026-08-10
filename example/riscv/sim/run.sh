#!/bin/bash
# RV32I Processor Simulation Runner (interpreter)
# RV32Iプロセッサ シミュレーション実行スクリプト（インタプリタ）
#
# Usage / 使い方:
#   ./run.sh
#
# 3つのテストプログラムを順に実行し、RV32Iの40命令を検証する。
#   test_alu  R形式10、I形式9、LUI、EBREAK            計21命令
#   test_mem  ロード5、ストア3、分岐6、JAL/JALR、AUIPC  計17命令
#   test_sys  FENCE、ECALL                            計2命令
#
# EBREAKはtest_aluとtest_memの停止そのものが検証になっている。
# 停止しなければ打ち切りに掛かってFAILになる。
#
# 各テストは、コアが停止したあとにレジスタx0からx31までを
# 期待値表と突き合わせ、PASSかFAILを表示する。
# 期待値はRISC-Vの仕様から導いたものであり、コアの出力ではない。
#
# Prerequisites / 前提条件:
#   - cargo がインストールされていること

set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
SIM="$PROJECT_ROOT/sim/iris-sim"
SRC="$SCRIPT_DIR/../src"
LOG="$SCRIPT_DIR/output.log"
CYCLES=600

echo "=== RV32I Processor Simulation ==="
echo ""

# ビルド（未ビルドの場合）
if [ ! -x "$SIM/target/release/iris-sim" ]; then
    echo "Building iris-sim..."
    cargo build --release --manifest-path "$SIM/Cargo.toml" || exit 1
fi

IRIS_SIM="$SIM/target/release/iris-sim"
CORE="-i $SRC/regfile.iris -i $SRC/alu.iris -i $SRC/decoder.iris -i $SRC/riscv_core.iris"

: > "$LOG"
STATUS=0
TOTAL=0

for t in alu mem sys; do
    echo "--- test_$t ---"
    # shellcheck disable=SC2086
    OUT=$("$IRIS_SIM" $CORE -i "$SRC/test_$t.iris" \
              -o "$SCRIPT_DIR/output_$t.vcd" -c "$CYCLES" 2>&1)
    echo "$OUT" | tee -a "$LOG"

    if ! echo "$OUT" | grep -q "RESULT: PASS"; then
        STATUS=1
    fi
    N=$(echo "$OUT" | sed -n 's/.*instructions verified: *\([0-9]*\).*/\1/p' | head -1)
    TOTAL=$((TOTAL + ${N:-0}))
    echo ""
done

echo "=== Summary ==="
echo "  instructions verified: $TOTAL / 40"
if [ "$STATUS" -eq 0 ] && [ "$TOTAL" -eq 40 ]; then
    echo "  RESULT: PASS - all 40 RV32I instructions behave as the specification requires"
else
    echo "  RESULT: FAIL"
    STATUS=1
fi

echo ""
echo "VCD output: $SCRIPT_DIR/output_alu.vcd, output_mem.vcd, output_sys.vcd"

exit $STATUS
