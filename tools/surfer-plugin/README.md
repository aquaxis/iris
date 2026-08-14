# iris-surfer-translator

Surferの翻訳プラグインである。
IRISの波形の値を、IRISの型のとおりに表示する。

## 何をするか

IRISの値をIRISの型のとおりに見せるための口である。

| IRISの型 | 判別のもと | 表示 |
|---|---|---|
| `bit[8]` | `$var wire` | `240` |
| `int[32]` | `$var integer` | `-16` |

**符号の情報は`variable_type_name`からは取れない。**
それはVHDLの型名から埋まる欄で、VCDでは常に空である。

```
libsurfer/src/wellen.rs:765
variable_type_name: var.vhdl_type_name(&self.hierarchy).map(ToString::to_string),
```

代わりに`$var`の種別を見る。
`iris-sim`は`int[N]`を`$var integer`として書く。

## 現状の正直な位置

**プラグインは読み込まれ、Surferから呼ばれている。**
次の警告がその証拠である。

```
WARN libsurfer::wave_data: More than one preferred translator for
     variable s_rs1 in scope TestMem.core: IRIS, Signed
```

Surferがこれを出せるのは、プラグインの`translates`を呼んで答を受け取ったからである。

**しかし画面に出ている値はSurfer組み込みの`Signed`が作っている。**
`$var integer`は組み込みの翻訳器も受け持ち、そちらが選ばれる。

判別のため、出力に印を付けた版を一時的に作って確かめた。
印は画面に出なかった。

| | 状態 |
|---|---|
| プラグインが読み込まれる | **確認済み** |
| Surferがプラグインを呼ぶ | **確認済み** |
| プラグインの出力が画面に出る | **未確認** |
| 符号付きが正しく出る | **確認済み。ただし組み込みによる** |

VCDが運べる型情報は`wire`と`integer`の区別しか無く、
その範囲は組み込みが既に覆っている。

**このプラグインの値は、VCDが運べない情報をIRIS側から渡せるようになったときに出る。**
現時点では、その口が用意してあるということ以上を主張しない。

## 何をしないか

**メモリを展開しない。**

配列は`iris-sim --dump-arrays`がスコープとして書き出し、
Surferがスコープとして展開する。
翻訳器は値の**見せ方**を変えるものであり、
ファイルに無い値を作り出すことはできない。

## 組み立て

```
cargo build --release --target wasm32-unknown-unknown --ignore-rust-version
```

`--ignore-rust-version`が要る。
Surferの型定義が依存する`ecolor`がrustc 1.92以上を要求し、
この機械のrustcは1.91.1だからである。
1.91.1で組み立てて動くことは確かめてある。

出るもの。

```
target/wasm32-unknown-unknown/release/iris_surfer_translator.wasm
```

## 導入

`.wasm`を次のどちらかに置く。

| 置き場所 | 効く範囲 |
|---|---|
| `<作業ディレクトリ>/.surfer/translators/` | そのディレクトリで開いたとき |
| `~/.local/share/surfer/translators/` | いつでも |

Surferを起動すると読み込まれる。

```
INFO libsurfer::translation::wasm_translator: Found .../iris_surfer_translator.wasm
INFO libsurfer: Translator IRIS loaded
```

**`Translator IRIS loaded`の`IRIS`は、このプラグインの`name()`が返した文字列である。**
読み込みに失敗した場合はここが空になり、
壊れた`.wasm`を置いた場合は`Failed to load plugin from`が出る。

波形の項目を選び、書式を`IRIS`にすると翻訳が効く。

```
variable_add TestMem.core.dmem.3
item_set_format IRIS
```

## 版

**Surfer 0.7.0で確かめた。**

Surferはプラグインを組み立てたPDKと、動かす側のSDKの版が食い違うと、
その旨を添えて読み込みに失敗する。
そのため`surfer-translation-types`は`v0.7.0`のタグに固定してある。

Surferの版を上げるときは、このタグも合わせる。

## ライセンス

このプラグイン自身はMITである。

`surfer-translation-types`はSurferの一部でありEUPL-1.2である。
**依存として参照しており、このリポジトリに複製していない。**
Surfer本体も同梱していない。

| | ライセンス | 扱い |
|---|---|---|
| このプラグイン | MIT | このリポジトリにある |
| `surfer-translation-types` | EUPL-1.2 | git依存。複製しない |
| Surfer本体 | EUPL-1.2 | 同梱しない。利用者が入れる |

## 実装の注記

Surferはプラグインを**Extism**として読み込む。
WITでもコンポーネントモデルでもない。

Surferが呼ぶ関数のうち、このプラグインが備えるのは4つである。

| 関数 | 必須か | 返すもの |
|---|---|---|
| `name` | 必須 | 翻訳器の名前 |
| `translates` | 必須 | この変数を翻訳できるか |
| `variable_info` | 必須 | 変数の形。真偽値かビット列か |
| `translate` | 必須 | 値の表示 |

`new`、`set_wave_source`、`variable_name_info`、`reload`は任意であり、備えていない。

`translates`は`Yes`を返し、`Prefer`を返さない。
既定の翻訳器を奪わず、読む者が選んだときだけ効くようにするためである。
