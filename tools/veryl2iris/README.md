# veryl2iris

VerylとIRISの相互変換。

**3つのクレートに分かれている。**

| クレート | 何か | 依存 |
|---|---|---|
| `mapping/` | **対応表。両方向がこれだけを読む** | 無し |
| `i2v/` | IRIS → Veryl | `iris-sim` |
| `v2i/` | Veryl → IRIS | `veryl-parser` |

## なぜ3つに分かれているか

**`iris-sim`と`veryl-parser`は同じ依存グラフに同居できない。**

`iris-sim`は全依存を厳密に固定する方針で、`clap = "=4.4.18"`である。
`veryl-parser`はparol経由でclap `^4.6`を要求する。

```
error: failed to select a version for `clap`.
    ... required by package `parol v5.0.0`
    ... which satisfies dependency `parol = "^5.0"` of package `veryl-parser v0.20.3`
versions that meet the requirements `^4.6` are: 4.6.6, ...
all possible versions conflict with previously selected packages.
```

ワークスペースにしても1つのロックファイルを共有するので解決しない。
そこで**独立したクレートに分け、それぞれが必要な解析器だけを繋ぐ。**

`iris-sim`の固定を緩める道は採らなかった。
全依存が`=`で固定されており、意図のある方針だからである。

**対応表は1つのままである。**
`mapping/`は依存を持たず、両方向がこれを読む。
2つ持つと必ず食い違う。

## 組み立て

それぞれ独立している。

```bash
cd mapping && cargo test
cd i2v     && cargo build --release
cd v2i     && cargo build --release
```

## 何ができて何ができないか

`doc/veryl.md`にある。
要点は、**共通部分でしか完全にならない**ことと、
**共通部分の外は黙って落とさず、位置を添えて拒否する**ことである。
