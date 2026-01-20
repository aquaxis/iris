# 第15章 文法定義

[<< 移行ガイド](./14_migration_guide.md) | [目次](./iris_spec_0.1.0.md) | [サンプルコード集 >>](./16_examples.md)

---

## 15.1 完全文法定義（EBNF）

### 15.1.1 トップレベル構文

```ebnf
source_file = { item } ;
item = visibility_modifier ( mod_def | test_mod_def | type_def | const_def | fn_def
     | interface_def | package_decl | import_decl | test_def ) ;

visibility_modifier = [ "pub" ] ;
```

### 15.1.2 モジュール定義

```ebnf
mod_def = [ attribute ] "mod" identifier [ generic_params ] [ where_clause ]
          "(" port_list ")" "{" { mod_item } "}" ;

generic_params = "[" generic_param { "," generic_param } "]" ;
generic_param = identifier ":" generic_bound [ "=" default_value ] ;
generic_bound = "type" | "uint" | "int" | "bool" | type_expr ;
where_clause = "where" constraint { "," constraint } ;

port_list = { port_decl } ;
port_decl = port_direction identifier ":" type_expr [ "," ] ;
port_direction = "in" | "out" | "inout" | "initiator" | "target" | "monitor" ;

mod_item = signal_decl | const_decl | type_alias | logic_block
         | inst_decl | mem_decl | fsm_block ;
```

**構文の特徴:**
- ポート宣言は`()`内に記述（Rust関数の引数リストに類似）
- モジュール本体は`{}`内に記述
- ポート宣言とモジュール本体が明確に分離される

### 15.1.3 信号・変数宣言

```ebnf
signal_decl = let_decl | var_decl ;
let_decl = "let" [ "mut" ] identifier [ ":" type_expr ] [ "=" expr ] ";" ;
var_decl = "var" identifier [ ":" type_expr ] [ "=" expr ] ";" ;
const_decl = "const" identifier ":" type_expr "=" expr ";" ;
type_alias = "type" identifier [ generic_params ] "=" type_expr ";" ;
```

**宣言形式:**
- `let 名前: 型;` - 信号（型のみ指定、コンテキスト依存）
- `let 名前 = 初期値;` - 組み合わせ信号（直接代入、型推論）
- `let 名前: 型 = 初期値;` - 組み合わせ信号（直接代入、型指定）
- `let mut 名前: 型;` - 可変信号（型のみ指定）
- `let mut 名前 = 初期値;` - 可変信号（型推論、初期値がリセット値）
- `let mut 名前: 型 = 初期値;` - 可変信号（型指定、初期値がリセット値）
- `var 名前: 型;` - 順序回路専用（**sync/fsmでのみ使用可能**）
- `var 名前 = 初期値;` - 順序回路専用（初期値がリセット値）
- `var 名前: 型 = 初期値;` - 順序回路専用（型指定、初期値がリセット値）

**使用制限:**
- `let`直接代入（`let x = expr;`）は組み合わせ回路
- `let`宣言のみで`sync`/`fsm`内で代入すると順序回路
- `var`は`sync`または`fsm`ブロック内でのみ使用可能（順序回路専用）

### 15.1.4 型式

```ebnf
type_expr = primitive_type | array_type | user_type | generic_type ;
primitive_type = "bit" [ "[" const_expr "]" ]
               | "int" "[" const_expr "]"
               | "uint" "[" const_expr "]"
               | "bool" | "clock" | "reset" | "string" ;
array_type = type_expr "[" const_expr "]" ;
user_type = path ;
generic_type = path "[" generic_args "]" ;
generic_args = generic_arg { "," generic_arg } ;
generic_arg = [ identifier ":" ] ( type_expr | const_expr ) ;
```

### 15.1.5 式

```ebnf
expr = unary_expr | binary_expr | primary_expr ;
unary_expr = unary_op expr ;
binary_expr = expr binary_op expr ;
primary_expr = literal | identifier | path | call_expr | index_expr
             | field_expr | cast_expr | if_expr | match_expr
             | "(" expr ")" ;

unary_op = "!" | "~" | "-" | "&" | "|" | "^" ;
binary_op = "+" | "-" | "*" | "/" | "%" | "**"
          | "&" | "|" | "^" | "<<" | ">>" | ">>>"
          | "==" | "!=" | "<" | "<=" | ">" | ">="
          | "&&" | "||" ;

call_expr = expr "(" [ expr_list ] ")" ;
index_expr = expr "[" expr [ ":" expr ] "]" ;
field_expr = expr "." identifier ;
cast_expr = expr "as" type_expr ;
```

---

## 15.2 論理ブロック

```ebnf
logic_block = signal_decl | comb_block | sync_block ;

comb_block = "comb" "{" { statement } "}" ;
sync_block = "sync" "(" clock_spec [ "," reset_spec ] ")" "{" { statement } "}" ;
clock_spec = expr "." ( "posedge" | "negedge" ) ;
reset_spec = expr "." ( "async" | "sync" ) ;
```

---

## 15.3 FSM

```ebnf
fsm_block = "fsm" identifier "(" clock_spec [ "," reset_spec ] ")" "{"
            state_enum transitions_block { output_block }
            "}" ;
state_enum = "state" "enum" "{" state_item { "," state_item } "}" ;
state_item = identifier [ moore_outputs ] ;
moore_outputs = "[" output_assign { "," output_assign } "]" ;
output_assign = identifier "=" const_expr ;

transitions_block = "transitions" "{" { transition_item } "}" ;
transition_item = identifier "=>" "{" { when_clause } "}"
                | "_" "=>" "{" statement "}" ;
when_clause = "when" expr "{" { transition_action } "}" ;
transition_action = "goto" identifier ";" | statement ;
```

---

## 15.4 文

```ebnf
statement = assign_stmt | if_stmt | match_stmt | for_stmt | while_stmt
          | return_stmt | block_stmt ;

assign_stmt = lvalue "=" expr ";" ;
lvalue = identifier | index_expr | field_expr | "{" lvalue_list "}" ;

if_stmt = "if" expr "{" { statement } "}" [ "else" ( if_stmt | block_stmt ) ] ;
match_stmt = "match" expr "{" { match_arm } "}" ;
match_arm = pattern "=>" ( expr "," | block_stmt ) ;

for_stmt = "for" identifier "in" range_expr "{" { statement } "}" ;
range_expr = expr ".." expr | expr "..=" expr ;

while_stmt = "while" expr "{" { statement } "}" ;
return_stmt = "return" [ expr ] ";" ;
block_stmt = "{" { statement } "}" ;
```

---

## 15.5 インターフェース

```ebnf
interface_def = "interface" identifier [ generic_params ] "{"
                { interface_signal | view_def }
                "}" ;
interface_signal = [ "logic" ] identifier ":" type_expr ";" ;
view_def = "view" identifier "{" { view_signal } "}" ;
view_signal = view_direction identifier ";" ;
view_direction = "in" | "out" | "inout" ;
```

---

## 15.6 テスト

### 15.6.1 テストモジュール

テストベンチ専用のモジュール定義。ポート宣言を持たない（ポートレス）。

```ebnf
test_mod_def = "test" identifier "{" { test_item } "}" ;
test_item    = let_decl | var_decl | const_decl | inst_decl
             | comb_block | sync_block | initial_block
             | test_stmt ;
initial_block = "initial" "{" { statement } "}" ;
```

**特徴:**
- ポート宣言なし（SystemVerilogのテストベンチトップ階層と同等）
- 合成対象外（シミュレーション専用）
- 他のモジュールからインスタンス化不可（トップレベルのみ）

### 15.6.2 テスト関数

#[test]アトリビュートを使用した単体テスト関数。

```ebnf
test_def = "#[" test_attr "]" "fn" identifier "(" ")" "{" { test_stmt } "}" ;
test_attr = "test" [ "(" test_params ")" ] ;
test_params = test_param { "," test_param } ;
test_param = "timeout" "=" duration
           | "should_fail"
           | "ignore"
           | "parametric" "(" param_values ")" ;
```

---

## 15.7 パッケージとインポート

```ebnf
package_decl = "package" package_path ";" { package_item } ;
package_path = identifier { "::" identifier } ;
package_item = visibility_modifier ( type_def | const_def | fn_def
             | mod_def | interface_def | enum_def | struct_def ) ;

import_decl = "import" import_path [ "as" identifier ] ";" ;
import_path = package_path [ "::" "{" import_list "}" | "::" "*" ] ;
import_list = import_item { "," import_item } ;
import_item = identifier [ "as" identifier ] ;
```

---

## 15.8 リテラル

```ebnf
literal = integer_literal | bool_literal | string_literal ;

integer_literal = [ size ] [ "'" base ] digits ;
size = decimal_digits ;
base = "b" | "o" | "d" | "h" ;
digits = binary_digit { [ "_" ] binary_digit }
       | octal_digit { [ "_" ] octal_digit }
       | decimal_digit { [ "_" ] decimal_digit }
       | hex_digit { [ "_" ] hex_digit } ;

bool_literal = "true" | "false" ;
string_literal = '"' { character } '"' ;
```

---

## 15.9 識別子とパス

```ebnf
identifier = letter { letter | digit | "_" } ;
letter = "a".."z" | "A".."Z" ;
digit = "0".."9" ;

path = identifier { "::" identifier } ;
```

---

## 15.10 アトリビュート

```ebnf
attribute = "#[" attr_path [ attr_input ] "]" ;
attr_path = identifier { "::" identifier } ;
attr_input = "(" attr_args ")" ;
attr_args = attr_arg { "," attr_arg } ;
attr_arg = [ identifier "=" ] literal ;
```

---

## 15.11 メモリ宣言

```ebnf
mem_decl = "mem" identifier ":" mem_type [ mem_config ] [ "=" initializer ] ";" ;
mem_type = element_type "[" depth "]" ;
element_type = primitive_type | struct_type ;
depth = const_expr ;
mem_config = "{" { config_item } "}" ;
config_item = config_key ":" config_value [ "," ] ;
config_key = "ports" | "type" | "read_mode" | "write_mode" | "init_file" ;
```

---

## 15.12 構文要素詳細説明

### 15.12.1 モジュール（mod）

モジュールはハードウェア設計の基本単位。合成時にSystemVerilogのmoduleに変換される。

| 要素 | 説明 | 必須 |
|------|------|------|
| identifier | モジュール名（PascalCase推奨） | Yes |
| generic_params | パラメータ/型パラメータ | No |
| port_decl | ポート宣言（in/out/inout） | No |
| mod_item | 内部宣言（信号、ロジック等） | No |

**ポート宣言と信号宣言の同等性:**
- `out`および`inout`ポートは`let`宣言と**同等**として扱われる
- ポート宣言自体が信号宣言として機能するため、追加の`let`宣言は不要
- `out`ポートは`comb`で代入すると組み合わせ回路、`sync`/`fsm`で代入すると順序回路として合成

### 15.12.2 組み合わせ論理（comb）

全ての出力信号に対して全パスで値が割り当てられることを保証。

**規則:**
1. 全ての代入先は明示的に宣言された信号
2. 全パスで信号に値が割り当てられること
3. 代入は`=`
4. 循環依存はコンパイルエラー

### 15.12.3 順序論理（sync）

クロック同期の順序回路を記述。

**規則:**
1. 代入は`=`（コンパイラがレジスタ更新として解釈）
2. クロックエッジ指定は必須
3. リセットは省略可能（省略時はリセットなし）
4. 同一信号への複数代入は最後の代入が有効
5. `let`、`let mut`、`var`のいずれで宣言した信号も`sync`ブロック内で代入可能
6. `sync`ブロック内で代入された信号は順序回路（レジスタ）として合成される
7. **`var`宣言は`sync`または`fsm`ブロック内でのみ使用可能**（`comb`や直接代入で使用不可）

### 15.12.4 FSM

ステートマシンの高レベル記述。

**規則:**
1. 状態はenum形式で宣言
2. 各状態からの遷移をtransitionsで記述
3. Moore出力は状態宣言時に指定可能
4. Mealy出力はtransitions内で指定

---

[<< 移行ガイド](./14_migration_guide.md) | [目次](./iris_spec_0.1.0.md) | [サンプルコード集 >>](./16_examples.md)
