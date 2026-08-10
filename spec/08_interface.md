# 第8章 インターフェース

[<< FSM](./07_fsm.md) | [目次](./iris_spec.md) | [演算子 >>](./09_operators.md)

---

## 8.1 インターフェース構文

### 8.1.1 EBNF定義

```ebnf
interface_def = "interface" identifier [ generic_params ] [ "extends" identifier ]
                [ where_clause ] "{" { interface_signal | view_def } "}" ;

interface_signal = identifier ":" type_expr [ "," ] ;

view_def = "view" view_name "{" { direction_list } "}" ;
view_name = "initiator" | "target" | "monitor" | identifier ;
direction_list = direction ":" signal_list ;
direction = "inout" | "out" | "in" ;
signal_list = identifier { "," identifier } [ "," ] ;
```

この文法は`tools/iris.ebnf`および第16章と同一である。

インターフェースの信号は`interface_signal`である。
`signal_decl`はモジュールの`let`／`var`宣言を指す別の規則なので、
この章では使わない。

### 8.1.2 基本定義

```rust
interface AxiLite[AddrWidth: uint = 32, DataWidth: uint = 32] {
    // 書き込みアドレスチャネル
    awaddr:  bit[AddrWidth],
    awvalid: bit,
    awready: bit,

    // 書き込みデータチャネル
    wdata:   bit[DataWidth],
    wstrb:   bit[DataWidth / 8],
    wvalid:  bit,
    wready:  bit,

    // 書き込み応答チャネル
    bresp:   bit[2],
    bvalid:  bit,
    bready:  bit,

    // 読み出しアドレスチャネル
    araddr:  bit[AddrWidth],
    arvalid: bit,
    arready: bit,

    // 読み出しデータチャネル
    rdata:   bit[DataWidth],
    rresp:   bit[2],
    rvalid:  bit,
    rready:  bit,

    // ビュー定義
    view initiator {
        out: awaddr, awvalid, wdata, wstrb, wvalid, bready,
             araddr, arvalid, rready,
        in:  awready, wready, bresp, bvalid,
             arready, rdata, rresp, rvalid
    }

    view target {
        in:  awaddr, awvalid, wdata, wstrb, wvalid, bready,
             araddr, arvalid, rready,
        out: awready, wready, bresp, bvalid,
             arready, rdata, rresp, rvalid
    }
}
```

---

## 8.2 ビュー定義

### 8.2.1 標準ビュー名

| ビュー名 | 説明 | 用途 |
|----------|------|------|
| `initiator` | トランザクション開始側 | マスターデバイス |
| `target` | トランザクション応答側 | スレーブデバイス |
| `monitor` | 観測専用（全信号入力） | 検証用 |
| カスタム名 | ユーザー定義ビュー | 特殊接続 |

### 8.2.2 ビュー方向規則

```rust
interface Handshake {
    valid: bit,
    ready: bit,
    data:  bit[8],

    // initiatorはvalidとdataを駆動
    view initiator {
        out: valid, data,
        in:  ready
    }

    // targetはreadyを駆動
    view target {
        in:  valid, data,
        out: ready
    }

    // monitorは全信号を観測
    view monitor {
        in: valid, ready, data
    }
}
```

### 8.2.3 双方向信号

```rust
interface I2C {
    scl: bit,
    sda: bit,

    view controller {
        out:   scl,
        inout: sda
    }

    view peripheral {
        in:    scl,
        inout: sda
    }
}
```

---

## 8.3 インターフェースの使用

### 8.3.1 ポート宣言

```rust
mod AxiMaster(
    in  clk: clock,
    in  rst: reset,
    initiator axi: AxiLite,  // initiatorビューで接続
) {
    // 内部ロジック
    comb {
        axi.awaddr = address;
        axi.awvalid = wr_request;
    }
}

mod AxiSlave(
    in  clk: clock,
    in  rst: reset,
    target axi: AxiLite,  // targetビューで接続
    out reg_out: bit[32][16],
) {
    // 内部ロジック
    comb {
        axi.awready = !busy;
    }
}
```

### 8.3.2 インターフェース接続

```rust
mod Top(
    in clk: clock,
    in rst: reset,
) {
    // インターフェースインスタンス
    let axi_bus: AxiLite[AddrWidth: 16, DataWidth: 32];

    // モジュールインスタンス化と接続
    inst master = AxiMaster {
        clk: clk,
        rst: rst,
        axi: axi_bus  // 自動的にビューが適用される
    };

    inst slave = AxiSlave {
        clk: clk,
        rst: rst,
        axi: axi_bus,  // 同じバスに接続
        reg_out: registers
    };
}
```

### 8.3.3 配列インターフェース

```rust
mod MultiPortController(
    in clk: clock,
    in rst: reset,
    initiator ports[4]: AxiLite,  // 4つのAXIポート
) {
    // 各ポートへのアクセス
    for i in 0..4 {
        comb {
            ports[i].awvalid = requests[i];
        }
    }
}
```

---

## 8.4 インターフェースの合成

### 8.4.1 信号展開規則

インターフェースは合成時に個別信号に展開されます。

```rust
// IRIS
interface Simple {
    valid: bit,
    data:  bit[8],
    view initiator { out: valid, data }
}

mod Producer(
    initiator out_if: Simple,
) {}
```

**生成されるSystemVerilog:**

```systemverilog
module Producer (
    output logic       out_if_valid,
    output logic [7:0] out_if_data
);
```

### 8.4.2 命名規則

| パターン | 生成される信号名 |
|----------|------------------|
| `interface_name.signal` | `interface_name_signal` |
| `ports[n].signal` | `ports_n_signal` |
| ネストされた場合 | `outer_inner_signal` |

---

## 8.5 インターフェース継承とコンポジション

### 8.5.1 インターフェース継承

```rust
// 基本インターフェース
interface StreamBase {
    valid: bit,
    ready: bit,

    view initiator { out: valid, in: ready }
    view target { in: valid, out: ready }
}

// 拡張インターフェース
interface AxiStream extends StreamBase {
    data:  bit[32],
    last:  bit,
    keep:  bit[4],

    view initiator {
        out: valid, data, last, keep,
        in:  ready
    }
    view target {
        in:  valid, data, last, keep,
        out: ready
    }
}
```

**継承の合成規則:**

- 合成時、継承階層は**フラットな信号集合**として展開される
- 継承元と継承先で同名の信号がある場合はコンパイルエラー
- 多重継承は禁止（単一継承のみ）
- 継承の深さは3レベルまでを推奨
- 同名のビューを継承先が書き直した場合は、継承先の定義が優先する

**インターフェースの展開:**

インターフェースはメンバごとの信号に展開される。
`initiator bus: Simple`というポートは、メンバの数だけのポートになり、
それぞれの向きはポートの方向が指すビューから決まる。
そのビューが`out`とした信号はこのモジュールが駆動し、`in`とした信号は受け取る。
`monitor`はすべてを受け取る。
ビューが触れていないメンバも受け取る。

バスは信号として宣言し、両側のインスタンスに同じものを渡す。
接続もメンバごとに展開される。
波形には`link.valid`や`p.bus.valid`のような名前で現れ、
インターフェースそのものは信号にならない。

### 8.5.2 インターフェースのコンポジション

```rust
interface AxiFull {
    // 書き込みチャネル（インターフェースを含む）
    write: AxiWriteChannel,
    // 読み出しチャネル
    read:  AxiReadChannel,

    view initiator {
        // 子インターフェースのビューを参照
        write: initiator,
        read:  initiator
    }
    view target {
        write: target,
        read:  target
    }
}
```

---

## 8.6 接続規則

### 8.6.1 接続の妥当性チェック

| 接続パターン | 有効性 | 備考 |
|--------------|--------|------|
| initiator ↔ target | 有効 | 標準接続 |
| initiator ↔ initiator | エラー | 駆動競合 |
| target ↔ target | エラー | 駆動なし |
| monitor ↔ any | 有効 | 観測のみ |

### 8.6.2 エラー例

```rust
// エラー例
mod BadConnection(
    initiator port_a: Handshake,
    initiator port_b: Handshake,
) {
    // エラー: 両方がinitiatorのため接続不可
}
```

**エラーメッセージ:**

```
error[O0030]: incompatible interface views
  --> src/example.iris:5:5
   |
 5 |     initiator port_a: Handshake,
 6 |     initiator port_b: Handshake,
   |     ^^^^^^^^^^^^^^^^^^^^^^^^^^^ both 'port_a' and 'port_b' are initiators
   |
   = help: one must be 'initiator' and the other 'target'
```

---

[<< FSM](./07_fsm.md) | [目次](./iris_spec.md) | [演算子 >>](./09_operators.md)
