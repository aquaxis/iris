# 第10章 メモリ

[<< 演算子](./09_operators.md) | [目次](./iris_spec.md) | [検証機能 >>](./11_verification.md)

---

## 10.1 メモリ構文

### 10.1.1 EBNF定義

```ebnf
mem_decl = "mem" identifier ":" mem_type [ mem_config ] [ "=" initializer ] ";" ;
mem_type = element_type "[" depth "]" ;
element_type = primitive_type | user_type ;
depth = const_expr ;
mem_config = "{" { config_item } "}" ;
config_item = config_key ":" config_value [ "," ] ;
config_key = "ports" | "type" | "read_mode" | "write_mode" | "init_file" ;
```

### 10.1.2 基本宣言

```rust
// シンプルなメモリ
mem storage: bit[32][1024];       // 1024ワード × 32ビット

// 構造体配列
mem packet_buffer: PacketHeader[256];

// 多次元メモリ
mem cache: bit[64][4][256];       // 4ウェイ × 256エントリ × 64ビット
```

---

## 10.2 メモリ種別

### 10.2.1 RAM（読み書き可能）

```rust
mod Ram[DataWidth: uint = 32, Depth: uint = 1024](
    in  clk: clock,
    in  we: bit,
    in  addr: bit[$clog2(Depth)],
    in  wdata: bit[DataWidth],
    out rdata: bit[DataWidth],
) {
    mem storage: bit[DataWidth][Depth];

    sync(clk.posedge) {
        if we {
            storage[addr] = wdata;
        }
        rdata = storage[addr];
    }
}
```

### 10.2.2 ROM（読み取り専用）

```rust
mod Rom[DataWidth: uint = 8, Depth: uint = 256](
    in  clk: clock,
    in  addr: bit[$clog2(Depth)],
    out data: bit[DataWidth],
) {
    // 初期化付きROM
    const lookup: bit[DataWidth][Depth] = [
        8'h00, 8'h01, 8'h03, 8'h07,  // ...
    ];

    sync(clk.posedge) {
        data = lookup[addr];
    }
}

// ファイルから初期化
mod RomFromFile(
    in clk: clock,
    in addr: bit[10],
    out data: bit[32],
) {
    const rom_data: bit[32][1024] {
        init_file: "rom_contents.hex"
    };

    sync(clk.posedge) {
        data = rom_data[addr];
    }
}
```

---

## 10.3 読み出しモード

### 10.3.1 読み出しモードの種類

| モード | 説明 | 動作 |
|--------|------|------|
| `read_first` | 読み出し優先（デフォルト） | 書き込み前の値を読み出し |
| `write_first` | 書き込み優先 | 書き込み後の値を読み出し |
| `no_change` | 変更なし | 書き込み時は読み出し値を保持 |

### 10.3.2 読み出しモードの指定

```rust
// 読み出し優先（デフォルト）
mem ram_rf: bit[32][1024] {
    read_mode: read_first
};

sync(clk.posedge) {
    if we {
        ram_rf[addr] = wdata;
    }
    rdata = ram_rf[addr];  // 旧値を読み出し
}

// 書き込み優先
mem ram_wf: bit[32][1024] {
    read_mode: write_first
};

// 変更なしモード
mem ram_nc: bit[32][1024] {
    read_mode: no_change
};
```

---

## 10.4 ポート構成

### 10.4.1 シングルポートRAM

```rust
mem single_port: bit[32][1024] {
    ports: 1
};

sync(clk.posedge) {
    if we {
        single_port[addr] = wdata;
    }
    rdata = single_port[addr];
}
```

### 10.4.2 シンプルデュアルポートRAM

```rust
mod SimpleDualPort[Width: uint, Depth: uint](
    in  clk: clock,
    // 書き込みポート
    in  wr_en: bit,
    in  wr_addr: bit[$clog2(Depth)],
    in  wr_data: bit[Width],
    // 読み出しポート
    in  rd_addr: bit[$clog2(Depth)],
    out rd_data: bit[Width],
) {
    mem storage: bit[Width][Depth] {
        ports: 2,
        type: simple_dual_port
    };

    sync(clk.posedge) {
        if wr_en {
            storage[wr_addr] = wr_data;
        }
        rd_data = storage[rd_addr];
    }
}
```

### 10.4.3 真デュアルポートRAM

```rust
mod TrueDualPort[Width: uint, Depth: uint](
    in  clk: clock,
    // ポートA
    in  a_we: bit,
    in  a_addr: bit[$clog2(Depth)],
    in  a_wdata: bit[Width],
    out a_rdata: bit[Width],
    // ポートB
    in  b_we: bit,
    in  b_addr: bit[$clog2(Depth)],
    in  b_wdata: bit[Width],
    out b_rdata: bit[Width],
) {
    mem storage: bit[Width][Depth] {
        ports: 2,
        type: true_dual_port,
        read_mode: read_first
    };

    sync(clk.posedge) {
        // ポートA
        if a_we {
            storage[a_addr] = a_wdata;
        }
        a_rdata = storage[a_addr];

        // ポートB
        if b_we {
            storage[b_addr] = b_wdata;
        }
        b_rdata = storage[b_addr];
    }
}
```

### 10.4.4 異なるクロックドメイン

```rust
mod AsyncDualPort[Width: uint, Depth: uint](
    in  wr_clk: clock,
    in  rd_clk: clock,
    in  wr_en: bit,
    in  wr_addr: bit[$clog2(Depth)],
    in  wr_data: bit[Width],
    in  rd_addr: bit[$clog2(Depth)],
    out rd_data: bit[Width],
) {
    mem storage: bit[Width][Depth] {
        ports: 2,
        type: simple_dual_port,
        clocks: independent  // 異なるクロックドメイン
    };

    sync(wr_clk.posedge) @write_domain {
        if wr_en {
            storage[wr_addr] = wr_data;
        }
    }

    sync(rd_clk.posedge) @read_domain {
        rd_data = storage[rd_addr];
    }
}
```

---

## 10.5 初期化

### 10.5.1 インライン初期化

```rust
// 配列リテラルによる初期化
const sine_table: bit[8][16] = [
    8'd128, 8'd177, 8'd218, 8'd246,
    8'd255, 8'd246, 8'd218, 8'd177,
    8'd128, 8'd79,  8'd38,  8'd10,
    8'd0,   8'd10,  8'd38,  8'd79
];

// 繰り返し初期化
mem zeros: bit[32][1024] = [0; 1024];

// 関数による初期化
const crc_table: bit[8][256] = init_crc_table();
```

### 10.5.2 ファイル初期化

```rust
// HEXファイル（16進数）
const rom_hex: bit[32][1024] {
    init_file: "data.hex",
    format: hex
};

// バイナリファイル
const rom_bin: bit[32][1024] {
    init_file: "data.bin",
    format: binary
};

// メモリ初期化ファイル（MIF形式）
const rom_mif: bit[32][1024] {
    init_file: "data.mif",
    format: mif
};
```

---

## 10.6 合成アトリビュート

### 10.6.1 RAMスタイル

| スタイル | 説明 | 用途 |
|----------|------|------|
| `block` | ブロックRAM | 大容量メモリ |
| `distributed` | 分散RAM（LUT） | 小容量で高速 |
| `ultra` | UltraRAM | 超大容量（FPGA固有） |
| `registers` | レジスタ配列 | 最小遅延 |
| `auto` | 自動選択（デフォルト） | ツール判断 |

```rust
#[synthesis(ram_style = "block")]
mem large_buffer: bit[64][8192];

#[synthesis(ram_style = "distributed")]
mem small_fifo: bit[32][32];

#[synthesis(ram_style = "ultra")]
mem huge_buffer: bit[72][131072];

#[synthesis(ram_style = "registers")]
mem reg_file: bit[32][32];
```

### 10.6.2 その他のアトリビュート

```rust
// レジスタ出力追加（タイミング改善）
#[synthesis(ram_output_register)]
mem pipelined_ram: bit[64][4096];

// ECC有効化
#[synthesis(ecc = "encode_decode")]
mem protected_mem: bit[64][1024];

// バイトイネーブル
#[synthesis(byte_write_enable)]
mem byte_addressable: bit[32][1024];
```

---

## 10.7 RAM推論ガイドライン

### 10.7.1 推論パターン

| パターン | 推論結果 | 条件 |
|----------|----------|------|
| `mem` + syncブロック内で読み書き | RAM | クロック同期 |
| `mem` + 書き込みのみsync、読み出しはlet | 非同期読み出しRAM | 分散RAM |
| `const`配列 + 読み出しのみ | ROM | 初期化必須 |
| `mem` + 読み出しのみ（書き込みなし） | ROM | 初期化必須 |
| let文内でアクセス | 組み合わせ論理 | 分散RAM向け |

**`const`配列と`mem`のROM推論:**

IRISではROMを記述する方法が2つある。

1. **`const`配列**: インラインリテラルまたは`init_file`で初期化された読み出し専用のデータ。
10.2.2節の例のように、`const`配列として宣言し、`sync`ブロック内で読み出すとROMとして合成される。

2. **`mem`**: 書き込みポートを持たない`mem`もROMとして合成される。
初期値は宣言時または`init_file`で与える。

どちらの場合も、書き込みがない読み出しのみのアクセスパターンは合成ツールによりROMとして推論される。
小規模なROMには`const`配列を、大規模なROMには`mem` + `init_file`を使用することを推奨する。

### 10.7.2 サイズ推奨

| サイズ | 推奨スタイル | 備考 |
|--------|--------------|------|
| < 64ビット × 32深度 | distributed | LUT実装 |
| 64ビット × 32 ～ 36Kビット | block | BRAM |
| > 36Kビット | block/ultra | 複数BRAM/URAM |

---

[<< 演算子](./09_operators.md) | [目次](./iris_spec.md) | [検証機能 >>](./11_verification.md)
