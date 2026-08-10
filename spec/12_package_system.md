# 第12章 パッケージシステム

[<< 検証機能](./11_verification.md) | [目次](./iris_spec.md) | [アトリビュート >>](./13_attributes.md)

---

## 12.1 パッケージ構文

### 12.1.1 EBNF定義

```ebnf
package_decl = "package" package_path ";" { package_item } ;
package_path = identifier { "::" identifier } ;
package_item = visibility_modifier ( type_def | const_decl | fn_def
             | mod_def | interface_def | enum_def | struct_def ) ;
visibility_modifier = [ "pub" ] ;
```

### 12.1.2 パッケージ定義

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

## 12.2 可視性制御

### 12.2.1 可視性修飾子

| 修飾子 | 可視範囲 | 用途 |
|--------|----------|------|
| なし | 同一パッケージ内のみ | 内部実装（プライベート） |
| `pub` | どこからでもアクセス可能 | 公開API |

パッケージに属する宣言は`パッケージ名::名前`という名前になる。
トップモジュールを指定するときもこの名前を使う。

`pub`は「宣言したものを公開する」ものであり、
`export`は「取り込んだものを渡す」ものである。
役割が異なる。
別のパッケージから取り込んだ名前を、自分を取り込む側へ渡すには`export`を使う。

```rust
package facade;

import common::{Doubler};
export Doubler;          // facade を取り込む側からも Doubler が見える
```

```rust
package mylib::internal;

// 公開（どこからでもアクセス可能）
pub struct PublicConfig { ... }

// プライベート（デフォルト）
fn private_function() { ... }
const INTERNAL_VERSION: uint = 1;
```

---

## 12.3 インポート

### 12.3.1 インポート構文

```ebnf
import_decl = "import" import_path [ "as" identifier ] ";" ;
import_path = package_path [ "::" "{" import_list "}" | "::" "*" ] ;
import_list = import_item { "," import_item } ;
import_item = identifier [ "as" identifier ] ;
```

### 12.3.2 インポート例

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

### 12.3.3 再エクスポート

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

## 12.4 パッケージ階層

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

## 12.5 プロジェクト構成

### 12.5.1 標準ディレクトリ構造

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

### 12.5.2 ファイル拡張子

IRIS言語ソースファイルには以下の拡張子を使用します：

| 拡張子 | 種別 | 説明 |
|--------|------|------|
| `.iris` | 正式拡張子 | **推奨**。プロジェクトでの使用を推奨 |
| `.irs` | 短縮形 | 便宜のための短縮形。正式拡張子と同等に扱う |

> **注記**: ツールチェーン（iris-sim、irisfmt、iris2svなど）は両方の拡張子を同等に認識します。
> プロジェクト内では一貫性のため`.iris`拡張子の使用を推奨します。

### 12.5.3 モジュール解決規則

| パターン | ファイルパス |
|----------|-------------|
| `mod foo` | `src/foo.iris`（または`.irs`）、`src/foo/mod.iris` |
| `mod bar::baz` | `src/bar/baz.iris`（または`.irs`）、`src/bar/baz/mod.iris` |
| テスト | `test/**/*.iris`（または`*.irs`） |

---

## 12.6 設定ファイル（iris.toml）

### 12.6.1 基本設定

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

### 12.6.2 合成設定

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

### 12.6.3 シミュレーション設定

```toml
[simulation]
default_timescale = "1ns/1ps"
default_timeout = "10ms"
waveform_format = "vcd"
coverage = ["line", "branch", "toggle", "fsm"]
```

### 12.6.4 Rust連携設定

テストベンチで外部Rust関数を使用する場合の設定。

```toml
[rust]
# Rustソースディレクトリ（デフォルト: "rust/"）
src = "rust/"

# Rust版指定（最小要求バージョン）
edition = "2021"
min_version = "1.70.0"

# Rustクレートの依存関係
[rust.dependencies]
rand = "0.8"
serde = { version = "1.0", features = ["derive"] }

# 開発時のみのRust依存関係
[rust.dev-dependencies]
criterion = "0.5"

# カスタムCargo.toml設定のオーバーライド
[rust.cargo]
# Cargoプロファイル設定
[rust.cargo.profile.dev]
opt-level = 0
debug = true

[rust.cargo.profile.release]
opt-level = 3
lto = true
```

### 12.6.5 テスト設定

```toml
[test]
# テストディレクトリ（デフォルト: "test/"）
dir = "test/"

# Rustテストヘルパーディレクトリ（デフォルト: "rust/"）
rust_helpers = "rust/"

# テスト実行設定
parallel = true           # 並列実行
timeout = "60s"           # テストタイムアウト
fail_fast = false         # 最初の失敗で中断

# シミュレータ設定
[test.simulator]
name = "verilator"        # 使用するシミュレータ
args = ["--trace", "--coverage"]

# テストカバレッジ設定
[test.coverage]
enabled = true
types = ["line", "branch", "toggle"]
output_format = "html"
```

### 12.6.6 Rust連携プロジェクト構造

Rust関数をテストベンチで使用する場合のプロジェクト構造:

```
project/
├── iris.toml               # プロジェクト設定
├── Cargo.toml              # Rust依存関係（自動生成または手動）
├── src/
│   └── ...                 # IRISソースファイル
├── test/
│   └── ...                 # IRISテストファイル
├── rust/                   # 外部Rust関数
│   ├── mod.rs              # ルートモジュール
│   ├── test_utils.rs       # テストユーティリティ
│   └── generators/
│       ├── mod.rs
│       └── stimulus.rs     # スティミュラス生成
└── build/
    └── rust_bridge/        # 自動生成ブリッジコード
```

**Cargo.toml（自動生成または手動作成）:**

```toml
[package]
name = "my_soc_rust"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
iris_runtime = "0.1"       # IRIS Rust連携ランタイム
rand = "0.8"               # iris.toml の [rust.dependencies] から

[dev-dependencies]
# iris.toml の [rust.dev-dependencies] から
```

---

## 12.7 依存関係管理

### 12.7.1 依存関係の種類

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

### 12.7.2 ワークスペース

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

[<< 検証機能](./11_verification.md) | [目次](./iris_spec.md) | [アトリビュート >>](./13_attributes.md)
