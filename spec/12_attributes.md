# 第12章 アトリビュート

[<< パッケージシステム](./11_package_system.md) | [目次](./iris_spec_0.1.0.md) | [エラーメッセージ >>](./13_error_messages.md)

---

## 12.1 アトリビュート構文

### 12.1.1 EBNF定義

```ebnf
attribute = "#[" attr_path [ attr_input ] "]" ;
attr_path = identifier { "::" identifier } ;
attr_input = "(" attr_args ")" ;
attr_args = attr_arg { "," attr_arg } ;
attr_arg = [ identifier "=" ] literal ;
```

### 12.1.2 基本形式

```rust
// 単純なアトリビュート
#[test]
fn check_counter() { ... }

// 引数付きアトリビュート
#[timeout(1.ms)]
test long_test() { ... }

// 名前付き引数
#[synthesis(ram_style = "block")]
mem large_ram: bit[32][4096];

// 複数引数
#[timing(false_path, from = "clk_a", to = "clk_b")]
let cdc_signal: bit;
```

---

## 12.2 合成制御アトリビュート

### 12.2.1 階層制御

| アトリビュート | 説明 | 適用対象 |
|----------------|------|----------|
| `#[synthesis(keep)]` | 最適化で削除しない | 信号、モジュール |
| `#[synthesis(dont_touch)]` | 完全に最適化禁止 | 信号、モジュール |
| `#[synthesis(flatten)]` | 階層を展開 | モジュール |
| `#[synthesis(keep_hierarchy)]` | 階層を維持 | モジュール |

```rust
#[synthesis(keep)]
let debug_probe: bit[32];  // 削除されない

#[synthesis(dont_touch)]
let critical_signal: bit;  // 最適化対象外

#[synthesis(flatten)]
mod SmallHelper(...) { ... }  // 親モジュールに展開

#[synthesis(keep_hierarchy)]
mod ImportantBlock(...) { ... }  // 階層を維持
```

### 12.2.2 リソース制御

```rust
// RAMスタイル指定
#[synthesis(ram_style = "block")]
mem large_ram: bit[32][4096];

#[synthesis(ram_style = "distributed")]
mem small_ram: bit[8][64];

#[synthesis(ram_style = "ultra")]
mem huge_ram: bit[72][131072];

#[synthesis(ram_style = "registers")]
mem reg_array: bit[32][16];

// ROMスタイル指定
#[synthesis(rom_style = "block")]
const lookup: bit[16][1024] = [...];

// FSMエンコーディング
#[synthesis(fsm_encoding = "onehot")]
fsm Controller { ... }

#[synthesis(fsm_encoding = "binary")]
fsm CompactFsm { ... }

#[synthesis(fsm_encoding = "gray")]
fsm CdcFsm { ... }

// レジスタ複製（ファンアウト制御）
#[synthesis(max_fanout = 32)]
let high_fanout_signal: bit;

#[synthesis(register_duplication)]
let distributed_enable: bit;
```

### 12.2.3 最適化制御

```rust
// リタイミング
#[synthesis(retiming = true)]
mod PipelinedUnit(...) { ... }

#[synthesis(retiming = false)]
mod NoRetiming(...) { ... }

// リソース共有
#[synthesis(resource_sharing = false)]
comb {
    // 専用乗算器を使用
    result1 = a * b;
    result2 = c * d;
}

// 演算器推論制御
#[synthesis(use_dsp = true)]
let product = a * b;  // DSPスライス使用

#[synthesis(use_dsp = false)]
let small_mul = x * y;  // ロジックで実装
```

---

## 12.3 タイミング制御アトリビュート

### 12.3.1 パス指定

```rust
// 非同期入力（フォールスパス）
#[timing(false_path)]
in async_reset: reset;

#[timing(false_path, from = "clk_a", to = "clk_b")]
let cdc_signal: bit;

// マルチサイクルパス
#[timing(multicycle_path = 2)]
let slow_data: bit[64];

#[timing(multicycle_path = 3, from = "clk", setup = 2, hold = 1)]
let complex_timing: bit[128];

// 最大遅延指定
#[timing(max_delay = "5.0ns")]
let critical_path_signal: bit;

// 最小遅延指定
#[timing(min_delay = "1.0ns")]
let hold_critical: bit;
```

### 12.3.2 クロックグループ

```rust
// 非同期クロック
#[timing(async_clocks)]
mod CdcBridge(
    in clk_a: clock,
    in clk_b: clock,
) {
    // clk_a と clk_b は非同期
}

// 排他的クロック
#[timing(exclusive_clocks = ["clk_fast", "clk_slow"])]
mod MuxedClock(...) { ... }
```

---

## 12.4 クロックドメインアトリビュート

```rust
// クロックドメイン指定
#[clock_domain("core_clk")]
mod CpuCore(
    in clk: clock,
) {
    // このモジュール全体がcore_clkドメイン
}

// 複数ドメイン
#[clock_domain(read = "clk_a", write = "clk_b")]
mod AsyncFifo(...) { ... }

// CDC警告抑制
#[allow(cdc_crossing)]
sync(clk_b.posedge) {
    synced_data = raw_data;  // 意図的なCDC
}
```

---

## 12.5 物理制約アトリビュート

### 12.5.1 配置制約

```rust
// IOB配置
#[synthesis(iob = true)]
in data_in: bit[8];  // IOBレジスタ使用

#[synthesis(iob = false)]
out data_out: bit[8];  // ファブリックレジスタ

// 位置指定
#[synthesis(loc = "SLICE_X10Y20")]
let placed_reg: bit;

// 領域制約
#[synthesis(pblock = "pblock_cpu")]
mod CpuCluster(...) { ... }
```

### 12.5.2 I/O制約

```rust
// I/O標準
#[io(standard = "LVCMOS33")]
in gpio: bit[8];

#[io(standard = "LVDS_25", diff_term = true)]
in lvds_clk: clock;

// スルーレート・ドライブ強度
#[io(standard = "LVCMOS18", slew = "fast", drive = 12)]
out high_speed_out: bit;

// プルアップ・プルダウン
#[io(pullup)]
in button: bit;

#[io(pulldown)]
in switch: bit;
```

---

## 12.6 デバッグアトリビュート

### 12.6.1 基本デバッグ

```rust
// デバッグプローブ
#[debug(probe)]
let internal_state: bit[32];

// ILAマーク
#[debug(ila)]
let waveform_capture: bit[64];

// VIO（仮想I/O）
#[debug(vio)]
let virtual_input: bit[8];

// デバッグハブ接続
#[debug(mark_debug)]
let debug_signal: bit[16];

// デバッグ専用（合成時に削除）
#[debug_only]
mod DebugMonitor(...) { ... }
```

### 12.6.2 ILA詳細設定

```rust
// 基本的なILAマーキング
#[debug(ila)]
let captured_signal: bit[32];

// 詳細設定
#[debug(ila, depth = 4096, trigger = "data_valid")]
let trace_data: bit[64];

// 複数信号のグループ化
#[debug(ila, group = "cpu_trace")]
let pc: bit[32];

#[debug(ila, group = "cpu_trace")]
let instruction: bit[32];

// 完全な設定
#[debug(ila,
    depth = 4096,              // キャプチャ深度
    trigger = "start_pulse",   // トリガー信号
    trigger_position = 512,    // トリガー位置
    storage_mode = "always"    // always | triggered
)]
let data_stream: bit[128];
```

### 12.6.3 VIO設定

```rust
// 仮想入力（デバッグ時に値を注入）
#[debug(vio, direction = "in", init = 0)]
let override_enable: bit;

#[debug(vio, direction = "in", init = 32'h12345678)]
let test_pattern: bit[32];

// 仮想出力（デバッグ時に値を観測）
#[debug(vio, direction = "out")]
let internal_status: bit[16];

// 双方向
#[debug(vio, direction = "inout")]
let debug_register: bit[8];
```

### 12.6.4 デバッグツール生成規則

| アトリビュート | 生成されるIP | ツール接続 |
|----------------|-------------|-----------|
| `debug(ila)` | Integrated Logic Analyzer | JTAG/Debug Hub |
| `debug(vio)` | Virtual I/O | JTAG/Debug Hub |
| `debug(probe)` | Probe接続のみ | 外部ロジックアナライザ |
| `debug(mark_debug)` | 信号保持 + ネット名維持 | 任意のデバッグ手法 |

---

## 12.7 条件付きコンパイル

```rust
// フィーチャーフラグ
#[cfg(feature = "debug")]
mod DebugLogic(...) { ... }

#[cfg(not(feature = "debug"))]
mod ReleaseLogic(...) { ... }

// ターゲットデバイス
#[cfg(target = "xilinx")]
#[synthesis(use_dsp48)]
let product = a * b;

#[cfg(target = "intel")]
#[synthesis(use_dsp)]
let product = a * b;

// 合成/シミュレーション切り替え
#[cfg(synthesis)]
const DELAY: uint = 0;

#[cfg(simulation)]
const DELAY: uint = 10;

// 複合条件
#[cfg(all(feature = "uart", target = "xilinx"))]
mod XilinxUart(...) { ... }

#[cfg(any(feature = "spi", feature = "i2c"))]
mod SerialInterface(...) { ... }
```

---

## 12.8 アトリビュート一覧表

| カテゴリ | アトリビュート | 説明 |
|----------|----------------|------|
| **合成** | `synthesis(keep)` | 信号保持 |
| | `synthesis(dont_touch)` | 最適化禁止 |
| | `synthesis(flatten)` | 階層展開 |
| | `synthesis(keep_hierarchy)` | 階層維持 |
| | `synthesis(ram_style)` | RAMタイプ指定 |
| | `synthesis(fsm_encoding)` | FSMエンコード |
| | `synthesis(max_fanout)` | ファンアウト制限 |
| | `synthesis(use_dsp)` | DSP使用制御 |
| **タイミング** | `timing(false_path)` | フォールスパス |
| | `timing(multicycle_path)` | マルチサイクル |
| | `timing(max_delay)` | 最大遅延 |
| | `timing(min_delay)` | 最小遅延 |
| **クロック** | `clock_domain` | ドメイン指定 |
| | `allow(cdc_crossing)` | CDC警告抑制 |
| **I/O** | `io(standard)` | I/O標準 |
| | `io(slew)` | スルーレート |
| | `io(drive)` | ドライブ強度 |
| **デバッグ** | `debug(probe)` | プローブ |
| | `debug(ila)` | ILAマーク |
| | `debug_only` | デバッグ専用 |
| **条件** | `cfg(feature)` | フィーチャー |
| | `cfg(target)` | ターゲット |
| | `cfg(synthesis)` | 合成時のみ |

---

## 12.9 アトリビュート優先順位規則

### 12.9.1 設定の優先順位

アトリビュートと設定ファイル（iris.toml）の間で同じ設定が指定された場合の優先順位：

| 優先度 | 設定ソース | 説明 |
|--------|-----------|------|
| 1（最高） | ソースコード内アトリビュート | `#[synthesis(...)]` |
| 2 | iris.toml のモジュール固有設定 | `[synthesis.modules.ModuleName]` |
| 3（最低） | iris.toml のグローバル設定 | `[synthesis]` |

```toml
# iris.toml
[synthesis]
fsm_encoding = "auto"           # デフォルト（優先度3）

[synthesis.modules.CriticalFsm]
fsm_encoding = "onehot"         # モジュール固有（優先度2）
```

```rust
// ソースコード
#[synthesis(fsm_encoding = "binary")]  // 最優先（優先度1）
fsm VeryCompactFsm { ... }
```

### 12.9.2 競合解決規則

1. **明示的指定が暗黙を上書き**: 明示的なアトリビュートは常に暗黙のデフォルトを上書き
2. **ローカルがグローバルを上書き**: 信号/モジュール固有の設定はグローバル設定を上書き
3. **エラー報告**: 互いに矛盾するアトリビュートが同一要素に適用された場合はコンパイルエラー

```rust
// エラー例：矛盾するアトリビュート
#[synthesis(flatten)]
#[synthesis(keep_hierarchy)]  // エラー: flattenとkeep_hierarchyは排他的
mod Conflicting(...) { ... }
```

---

[<< パッケージシステム](./11_package_system.md) | [目次](./iris_spec_0.1.0.md) | [エラーメッセージ >>](./13_error_messages.md)
