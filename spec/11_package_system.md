# 第11章 パッケージシステム

[<< 検証機能](./10_verification.md) | [目次](./iris_spec_0.1.0.md) | [アトリビュート >>](./12_attributes.md)

---

## 11.1 パッケージ構文

### 11.1.1 EBNF定義

```ebnf
package_decl = "package" package_path ";" { package_item } ;
package_path = identifier { "::" identifier } ;
package_item = visibility_modifier ( type_def | const_def | fn_def
             | mod_def | interface_def | enum_def | struct_def ) ;
visibility_modifier = [ "pub" ] ;
```

### 11.1.2 パッケージ定義

```rust
// src/common/mod.iris
package common;

//! このパッケージは共通の型と定数を定義します

/// 8ビットデータ型
pub type Byte = bit[8];

/// 32ビットワード型
pub type Word = bit[32];

/// アドレス型
pub type Address = bit[16];

// パッケージプライベート（デフォルト）
type InternalType = bit[64];

/// 演算コード列挙型
pub enum OpCode: bit[4] {
    Add  = 4'h0,
    Sub  = 4'h1,
    And  = 4'h2,
    Or   = 4'h3,
    Xor  = 4'h4,
    Shl  = 4'h5,
    Shr  = 4'h6,
    Nop  = 4'hF,
}

/// パリティ計算関数
pub fn parity(data: Byte) -> bit {
    return data.xor_reduce();
}
```

---

## 11.2 可視性制御

### 11.2.1 可視性修飾子

| 修飾子 | 可視範囲 | 用途 |
|--------|----------|------|
| なし | 同一パッケージ内のみ | 内部実装（プライベート） |
| `pub` | どこからでもアクセス可能 | 公開API |

```rust
package mylib::internal;

// 公開（どこからでもアクセス可能）
pub struct PublicConfig { ... }

// プライベート（デフォルト）
fn private_function() { ... }
const INTERNAL_VERSION: uint = 1;
```

---

## 11.3 インポート

### 11.3.1 インポート構文

```ebnf
import_decl = "import" import_path [ "as" identifier ] ";" ;
import_path = package_path [ "::" "{" import_list "}" | "::" "*" ] ;
import_list = import_item { "," import_item } ;
import_item = identifier [ "as" identifier ] ;
```

### 11.3.2 インポート例

```rust
// 単一アイテムのインポート
import common::Word;
import common::OpCode;

// 複数アイテムのインポート
import common::{Word, OpCode, Byte};

// ワイルドカードインポート（非推奨）
import common::*;

// エイリアス付きインポート
import common::Word as DataWord;
import vendor_ip::AXI4 as Axi;

// 完全修飾名でのアクセス
import common;
let data: common::Word = 32'h0;

// ネストされたパッケージ
import mylib::protocols::axi::AxiLite;
import mylib::protocols::axi::{AxiLite, AxiStream};
```

### 11.3.3 再エクスポート

```rust
// src/lib.iris
package mylib;

// 公開再エクスポート
pub import common::Word;
pub import common::OpCode;

// 内部パッケージを公開
pub mod protocols;
pub mod utils;
```

---

## 11.4 パッケージ階層

```rust
// ファイル構造
// src/
// ├── lib.iris          (package mylib)
// ├── common/
// │   ├── mod.iris      (package mylib::common)
// │   └── types.iris    (package mylib::common::types)
// └── protocols/
//     ├── mod.iris      (package mylib::protocols)
//     ├── axi.iris      (package mylib::protocols::axi)
//     └── apb.iris      (package mylib::protocols::apb)

// src/lib.iris
package mylib;

pub mod common;
pub mod protocols;

// src/common/mod.iris
package mylib::common;

pub mod types;

pub use types::*;  // typesの内容を再エクスポート
```

---

## 11.5 プロジェクト構成

### 11.5.1 標準ディレクトリ構造

```
project/
├── iris.toml               # プロジェクト設定（必須）
├── iris.lock               # 依存関係ロックファイル（自動生成）
├── src/
│   ├── lib.iris            # ライブラリルート
│   ├── main.iris           # バイナリ（合成トップ）
│   ├── common/
│   │   ├── mod.iris        # サブモジュール定義
│   │   └── types.iris
│   └── rtl/
│       ├── mod.iris
│       └── cpu.iris
├── test/
│   ├── unit/               # ユニットテスト
│   └── integration/        # 統合テスト
├── bench/                  # ベンチマーク
├── constraints/
│   ├── timing.sdc          # タイミング制約
│   └── pinout.xdc          # ピン配置
├── scripts/
├── doc/
├── ip/                     # 外部IP
├── sim/                    # シミュレーション出力
└── build/                  # ビルド出力
```

### 11.5.2 モジュール解決規則

| パターン | ファイルパス |
|----------|-------------|
| `mod foo` | `src/foo.iris` または `src/foo/mod.iris` |
| `mod bar::baz` | `src/bar/baz.iris` または `src/bar/baz/mod.iris` |
| テスト | `test/**/*.iris` |

---

## 11.6 設定ファイル（iris.toml）

### 11.6.1 基本設定

```toml
[package]
name = "my_soc"
version = "1.0.0"
authors = ["Developer <dev@example.com>"]
license = "MIT"
description = "Example SoC design"
edition = "2025"

# 依存関係
[dependencies]
iris_std = "1.0"
iris_axi = { version = "2.0", features = ["lite", "stream"] }
riscv_core = { git = "https://github.com/example/riscv", tag = "v1.0" }
vendor_ip = { path = "../vendor_ip" }

# 開発時のみの依存
[dev-dependencies]
iris_test = "1.0"

# オプション機能
[features]
default = ["uart"]
uart = []
spi = []
ethernet = ["iris_eth"]
```

### 11.6.2 合成設定

```toml
[synthesis]
target = "xilinx_ultrascale_plus"
device = "xczu7ev-ffvc1156-2-e"
top_module = "SocTop"
output_format = "systemverilog"

[[synthesis.clocks]]
name = "sys_clk"
period = "10.0ns"
uncertainty = "0.5ns"

[synthesis.options]
flatten_hierarchy = "rebuilt"
retiming = true
fsm_encoding = "auto"
```

### 11.6.3 シミュレーション設定

```toml
[simulation]
default_timescale = "1ns/1ps"
default_timeout = "10ms"
waveform_format = "vcd"
coverage = ["line", "branch", "toggle", "fsm"]
```

---

## 11.7 依存関係管理

### 11.7.1 依存関係の種類

```toml
[dependencies]
# レジストリから（バージョン指定）
iris_std = "1.0"
iris_std = ">=1.0, <2.0"

# Gitリポジトリから
riscv_core = { git = "https://github.com/example/riscv", tag = "v1.0" }

# ローカルパスから
vendor_ip = { path = "../vendor_ip" }

# オプション依存
iris_eth = { version = "1.0", optional = true }

# フィーチャー付き
iris_axi = { version = "2.0", features = ["lite", "stream"] }
```

### 11.7.2 ワークスペース

```toml
# workspace/iris.toml
[workspace]
members = [
    "cpu",
    "peripherals",
    "soc",
]

# 共通依存関係
[workspace.dependencies]
iris_std = "1.0"
iris_axi = "2.0"
```

---

[<< 検証機能](./10_verification.md) | [目次](./iris_spec_0.1.0.md) | [アトリビュート >>](./12_attributes.md)
