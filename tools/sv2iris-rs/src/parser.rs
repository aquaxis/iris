//! A recursive-descent parser for the supported SystemVerilog subset.
//!
//! Anything outside the subset is refused with a line number, never dropped:
//! a converter that silently skips what it cannot handle produces a design that
//! looks whole and is not.

use crate::ast::*;
use crate::lexer::{Tok, Token};

pub struct Parser {
    tokens: Vec<Token>,
    pos: usize,
}

impl Parser {
    pub fn new(tokens: Vec<Token>) -> Self {
        Self { tokens, pos: 0 }
    }

    /// Parse a whole file: file-level type declarations and modules.
    pub fn parse_design(&mut self) -> Result<Design, String> {
        let mut types = Vec::new();
        let mut modules = Vec::new();
        while !self.at_end() {
            if self.at_kw("typedef") {
                types.push(self.parse_typedef()?);
            } else if self.at_kw("function") {
                types.push(FileDecl::Function(self.parse_function()?));
            } else if self.at_kw("interface") {
                types.push(FileDecl::Interface(self.parse_interface()?));
            } else if self.at_kw("module") {
                modules.push(self.parse_module()?);
            } else {
                return Err(format!(
                    "line {}: expected 'module', 'typedef', 'function' or 'interface', found '{}'",
                    self.line(),
                    self.peek_text()
                ));
            }
        }
        if modules.is_empty() && types.is_empty() {
            return Err("no module found".to_string());
        }
        Ok(Design { decls: types, modules })
    }

    /// `function [automatic] [logic] [signed] [range] name ( args ); body endfunction`
    fn parse_function(&mut self) -> Result<FnDecl, String> {
        self.expect_kw("function")?;
        if self.at_kw("automatic") || self.at_kw("static") {
            self.next();
        }
        if self.at_kw("logic") || self.at_kw("wire") || self.at_kw("reg") {
            self.next();
        }
        let mut ret_signed = false;
        if self.at_kw("signed") {
            self.next();
            ret_signed = true;
        } else if self.at_kw("unsigned") {
            self.next();
        }
        let ret_width = if self.at_sym("[") {
            Some(self.parse_range_width()?)
        } else {
            None
        };
        let name = self.ident()?;
        self.expect_sym("(")?;
        let mut args = Vec::new();
        if !self.at_sym(")") {
            loop {
                if self.at_kw("input") || self.at_kw("output") || self.at_kw("inout") {
                    self.next();
                }
                if self.at_kw("logic") || self.at_kw("wire") || self.at_kw("reg") {
                    self.next();
                }
                let mut signed = false;
                if self.at_kw("signed") {
                    self.next();
                    signed = true;
                } else if self.at_kw("unsigned") {
                    self.next();
                }
                let width = if self.at_sym("[") {
                    Some(self.parse_range_width()?)
                } else {
                    None
                };
                let arg_name = self.ident()?;
                args.push(FnArg { name: arg_name, width, signed });
                if self.at_sym(",") {
                    self.next();
                    continue;
                }
                break;
            }
        }
        self.expect_sym(")")?;
        self.expect_sym(";")?;
        let mut body = Vec::new();
        while !self.at_kw("endfunction") {
            if self.at_end() {
                return Err("unexpected end of input before 'endfunction'".to_string());
            }
            body.push(self.parse_stmt()?);
        }
        self.expect_kw("endfunction")?;
        Ok(FnDecl { name, args, ret_width, ret_signed, body })
    }

    /// `interface Name; <field>; modport m (dir sig, ...); ... endinterface`
    fn parse_interface(&mut self) -> Result<InterfaceDecl, String> {
        self.expect_kw("interface")?;
        let name = self.ident()?;
        self.expect_sym(";")?;
        let mut fields = Vec::new();
        let mut modports = Vec::new();
        while !self.at_kw("endinterface") {
            if self.at_end() {
                return Err("unexpected end of input before 'endinterface'".to_string());
            }
            if self.at_kw("modport") {
                self.next();
                let mp_name = self.ident()?;
                self.expect_sym("(")?;
                let mut signals = Vec::new();
                loop {
                    let dir = match self.ident()?.as_str() {
                        "input" => Dir::In,
                        "output" => Dir::Out,
                        "inout" => Dir::Inout,
                        other => {
                            return Err(format!(
                                "line {}: expected a modport direction, found '{}'",
                                self.line(),
                                other
                            ))
                        }
                    };
                    let sig = self.ident()?;
                    signals.push((dir, sig));
                    if self.at_sym(",") {
                        self.next();
                        continue;
                    }
                    break;
                }
                self.expect_sym(")")?;
                self.expect_sym(";")?;
                modports.push(Modport { name: mp_name, signals });
            } else {
                // A field declaration: [logic] [signed] [range] name ;
                if self.at_kw("logic") || self.at_kw("wire") || self.at_kw("reg") {
                    self.next();
                }
                let mut signed = false;
                if self.at_kw("signed") {
                    self.next();
                    signed = true;
                } else if self.at_kw("unsigned") {
                    self.next();
                }
                let width = if self.at_sym("[") {
                    Some(self.parse_range_width()?)
                } else {
                    None
                };
                let fname = self.ident()?;
                self.expect_sym(";")?;
                fields.push(Field { name: fname, width, signed, user_type: None });
            }
        }
        self.expect_kw("endinterface")?;
        Ok(InterfaceDecl { name, fields, modports })
    }

    /// `typedef enum|struct|union ... Name;`
    fn parse_typedef(&mut self) -> Result<FileDecl, String> {
        // Look past `typedef` to decide the kind.
        match self.tokens.get(self.pos + 1) {
            Some(Token { tok: Tok::Ident(k), .. }) if k == "enum" => {
                Ok(FileDecl::Enum(self.parse_typedef_enum()?))
            }
            Some(Token { tok: Tok::Ident(k), .. }) if k == "struct" || k == "union" => {
                Ok(FileDecl::Struct(self.parse_typedef_struct()?))
            }
            other => Err(format!(
                "line {}: unsupported typedef of '{}'",
                self.line(),
                other.map(|t| text_of(Some(t))).unwrap_or_default()
            )),
        }
    }

    /// `typedef struct|union packed { logic [w] f; ... } Name;`
    fn parse_typedef_struct(&mut self) -> Result<StructDecl, String> {
        self.expect_kw("typedef")?;
        let is_union = self.at_kw("union");
        self.next(); // struct or union
        if self.at_kw("packed") || self.at_kw("unpacked") {
            self.next();
        }
        if self.at_kw("signed") || self.at_kw("unsigned") {
            self.next();
        }
        self.expect_sym("{")?;
        let mut fields = Vec::new();
        while !self.at_sym("}") {
            if self.at_end() {
                return Err("unexpected end of input in a struct".to_string());
            }
            // A field: [logic|UserType] [signed] [range] name ;
            let mut user_type = None;
            let mut signed = false;
            if self.at_kw("logic") || self.at_kw("wire") || self.at_kw("reg") {
                self.next();
                if self.at_kw("signed") {
                    self.next();
                    signed = true;
                } else if self.at_kw("unsigned") {
                    self.next();
                }
            } else {
                // A user type name.
                user_type = Some(self.ident()?);
            }
            let width = if self.at_sym("[") {
                Some(self.parse_range_width()?)
            } else {
                None
            };
            let name = self.ident()?;
            self.expect_sym(";")?;
            fields.push(Field { name, width, signed, user_type });
        }
        self.expect_sym("}")?;
        let name = self.ident()?;
        self.expect_sym(";")?;
        Ok(StructDecl { name, is_union, fields })
    }

    /// `typedef enum [logic [w]] { A = 0, B = 1, ... } Name;`
    fn parse_typedef_enum(&mut self) -> Result<EnumDecl, String> {
        self.expect_kw("typedef")?;
        self.expect_kw("enum")?;
        if self.at_kw("logic") || self.at_kw("wire") || self.at_kw("reg") {
            self.next();
            if self.at_kw("signed") || self.at_kw("unsigned") {
                self.next();
            }
        }
        let width = if self.at_sym("[") {
            Some(self.parse_range_width()?)
        } else {
            None
        };
        self.expect_sym("{")?;
        let mut members = Vec::new();
        loop {
            let name = self.ident()?;
            let value = if self.at_sym("=") {
                self.next();
                Some(self.parse_expr()?)
            } else {
                None
            };
            members.push((name, value));
            if self.at_sym(",") {
                self.next();
                if self.at_sym("}") {
                    break; // trailing comma
                }
                continue;
            }
            break;
        }
        self.expect_sym("}")?;
        let name = self.ident()?;
        self.expect_sym(";")?;
        Ok(EnumDecl { name, width, members })
    }

    /// Parse a single module.
    pub fn parse_module(&mut self) -> Result<Module, String> {
        self.expect_kw("module")?;
        let name = self.ident()?;
        let params = if self.at_sym("#") {
            self.parse_params()?
        } else {
            Vec::new()
        };
        let ports = self.parse_ports()?;
        self.expect_sym(";")?;

        let mut items = Vec::new();
        while !self.at_kw("endmodule") {
            if self.at_end() {
                return Err("unexpected end of input before 'endmodule'".to_string());
            }
            items.push(self.parse_item()?);
        }
        self.expect_kw("endmodule")?;
        Ok(Module { name, params, ports, items })
    }

    /// `#( parameter [type] Name [= default], ... )`
    fn parse_params(&mut self) -> Result<Vec<Param>, String> {
        self.expect_sym("#")?;
        self.expect_sym("(")?;
        let mut params = Vec::new();
        if self.at_sym(")") {
            self.next();
            return Ok(params);
        }
        loop {
            if self.at_kw("parameter") || self.at_kw("localparam") {
                self.next();
            }
            // Optional type. An `int`/`integer` parameter is unconstrained; a
            // `logic` vector must be at least one bit.
            let mut constrained = true;
            if self.at_kw("int") || self.at_kw("integer") {
                self.next();
                constrained = false;
            } else if self.at_kw("logic") || self.at_kw("wire") || self.at_kw("reg") {
                self.next();
            }
            if self.at_kw("signed") || self.at_kw("unsigned") {
                self.next();
            }
            if self.at_sym("[") {
                self.parse_range_width()?; // width not represented on a param
            }
            let name = self.ident()?;
            let default = if self.at_sym("=") {
                self.next();
                Some(self.parse_expr()?)
            } else {
                None
            };
            params.push(Param { name, default, constrained });
            if self.at_sym(",") {
                self.next();
                continue;
            }
            break;
        }
        self.expect_sym(")")?;
        Ok(params)
    }

    fn parse_ports(&mut self) -> Result<Vec<Port>, String> {
        self.expect_sym("(")?;
        let mut ports = Vec::new();
        if self.at_sym(")") {
            self.next();
            return Ok(ports);
        }
        loop {
            ports.push(self.parse_port()?);
            if self.at_sym(",") {
                self.next();
                continue;
            }
            break;
        }
        self.expect_sym(")")?;
        Ok(ports)
    }

    fn parse_port(&mut self) -> Result<Port, String> {
        let dir = match self.ident()?.as_str() {
            "input" => Dir::In,
            "output" => Dir::Out,
            "inout" => Dir::Inout,
            other => {
                return Err(format!(
                    "line {}: expected a port direction (input/output/inout), found '{}'",
                    self.line(),
                    other
                ))
            }
        };
        // A `shortreal`/`real` port is an IEEE-754 float, not a bit vector.
        if let Some(bits) = self.take_float_type() {
            let name = self.ident()?;
            return Ok(Port { dir, width: None, signed: false, float: Some(bits), name });
        }
        // Optional net or variable type: logic, wire, reg.
        if self.at_kw("logic") || self.at_kw("wire") || self.at_kw("reg") {
            self.next();
        }
        // Optional signedness.
        let mut signed = false;
        if self.at_kw("signed") {
            self.next();
            signed = true;
        } else if self.at_kw("unsigned") {
            self.next();
        }
        // Optional packed range [msb:lsb].
        let width = if self.at_sym("[") {
            Some(self.parse_range_width()?)
        } else {
            None
        };
        let name = self.ident()?;
        Ok(Port { dir, width, signed, float: None, name })
    }

    /// Consume a `shortreal`/`real` keyword, returning its IEEE-754 bit count.
    fn take_float_type(&mut self) -> Option<usize> {
        if self.at_kw("shortreal") {
            self.next();
            Some(32)
        } else if self.at_kw("real") {
            self.next();
            Some(64)
        } else {
            None
        }
    }

    /// Read `[msb:lsb]`. A literal range becomes a bit count; a parametric one
    /// keeps its bounds.
    fn parse_range_width(&mut self) -> Result<Width, String> {
        self.expect_sym("[")?;
        let hi = self.parse_expr()?;
        self.expect_sym(":")?;
        let lo = self.parse_expr()?;
        self.expect_sym("]")?;
        match (literal_usize(&hi), literal_usize(&lo)) {
            (Ok(msb), Ok(lsb)) if msb >= lsb => Ok(Width::Bits(msb - lsb + 1)),
            (Ok(msb), Ok(lsb)) => {
                Err(format!("line {}: range [{}:{}] is inverted", self.line(), msb, lsb))
            }
            _ => Ok(Width::Range { hi, lo }),
        }
    }

    fn parse_item(&mut self) -> Result<Item, String> {
        if self.at_kw("assign") {
            self.next();
            let target = self.ident()?;
            self.expect_sym("=")?;
            let expr = self.parse_expr()?;
            self.expect_sym(";")?;
            return Ok(Item::ContinuousAssign { target, expr });
        }
        if self.at_kw("logic") || self.at_kw("wire") || self.at_kw("reg") {
            return self.parse_net_decl();
        }
        if self.at_kw("shortreal") || self.at_kw("real") {
            return self.parse_float_net_decl();
        }
        if self.at_kw("always_ff") || self.at_kw("always") {
            return self.parse_always_ff();
        }
        if self.at_kw("always_comb") || self.at_kw("always_latch") {
            self.next();
            let body = self.parse_stmt_or_block()?;
            return Ok(Item::AlwaysComb { body });
        }
        // A module instance: `Module name ( ... );`. Detected by two
        // identifiers in a row followed by `(`.
        if self.is_instance_ahead() {
            return self.parse_instance();
        }
        // A user-typed declaration: `TypeName name [= init];` (e.g. an enum).
        if self.is_user_decl_ahead() {
            return self.parse_user_net_decl();
        }
        Err(format!(
            "line {}: unsupported construct '{}'",
            self.line(),
            self.peek_text()
        ))
    }

    /// Is the cursor at `Ident Ident (`, a module instantiation?
    fn is_instance_ahead(&self) -> bool {
        matches!(self.tokens.get(self.pos), Some(Token { tok: Tok::Ident(_), .. }))
            && matches!(self.tokens.get(self.pos + 1), Some(Token { tok: Tok::Ident(_), .. }))
            && matches!(self.tokens.get(self.pos + 2), Some(Token { tok: Tok::Sym(s), .. }) if s == "(")
    }

    /// Is the cursor at `TypeName name` followed by `=`, `;`, or `[`, where the
    /// first identifier is a real type name and not a reserved word?
    fn is_user_decl_ahead(&self) -> bool {
        let first_is_type = matches!(
            self.tokens.get(self.pos),
            Some(Token { tok: Tok::Ident(s), .. }) if !is_reserved(s)
        );
        first_is_type
            && matches!(self.tokens.get(self.pos + 1), Some(Token { tok: Tok::Ident(_), .. }))
            && matches!(
                self.tokens.get(self.pos + 2),
                Some(Token { tok: Tok::Sym(s), .. }) if s == "=" || s == ";" || s == "["
            )
    }

    fn parse_user_net_decl(&mut self) -> Result<Item, String> {
        let user_type = self.ident()?;
        let name = self.ident()?;
        let init = if self.at_sym("=") {
            self.next();
            Some(self.parse_expr()?)
        } else {
            None
        };
        self.expect_sym(";")?;
        Ok(Item::NetDecl {
            width: None,
            signed: false,
            user_type: Some(user_type),
            float: None,
            name,
            init,
        })
    }

    fn parse_instance(&mut self) -> Result<Item, String> {
        let module = self.ident()?;
        let name = self.ident()?;
        self.expect_sym("(")?;
        let mut connections = Vec::new();
        if !self.at_sym(")") {
            loop {
                self.expect_sym(".")?;
                let port = self.ident()?;
                self.expect_sym("(")?;
                let expr = self.parse_expr()?;
                self.expect_sym(")")?;
                connections.push((port, expr));
                if self.at_sym(",") {
                    self.next();
                    continue;
                }
                break;
            }
        }
        self.expect_sym(")")?;
        self.expect_sym(";")?;
        Ok(Item::Instance { module, name, connections })
    }

    /// `logic [signed] [msb:lsb] name [= init];` — an internal declaration.
    fn parse_net_decl(&mut self) -> Result<Item, String> {
        self.next(); // logic / wire / reg
        let mut signed = false;
        if self.at_kw("signed") {
            self.next();
            signed = true;
        } else if self.at_kw("unsigned") {
            self.next();
        }
        let width = if self.at_sym("[") {
            Some(self.parse_range_width()?)
        } else {
            None
        };
        let name = self.ident()?;
        // An unpacked dimension after the name makes this a memory.
        if self.at_sym("[") {
            let depth = self.parse_unpacked_depth()?;
            self.expect_sym(";")?;
            return Ok(Item::MemDecl { element_width: width, signed, depth, name });
        }
        let init = if self.at_sym("=") {
            self.next();
            Some(self.parse_expr()?)
        } else {
            None
        };
        self.expect_sym(";")?;
        Ok(Item::NetDecl { width, signed, user_type: None, float: None, name, init })
    }

    /// `shortreal|real name [= init];` — an internal float declaration.
    fn parse_float_net_decl(&mut self) -> Result<Item, String> {
        let bits = self.take_float_type();
        let name = self.ident()?;
        let init = if self.at_sym("=") {
            self.next();
            Some(self.parse_expr()?)
        } else {
            None
        };
        self.expect_sym(";")?;
        Ok(Item::NetDecl { width: None, signed: false, user_type: None, float: bits, name, init })
    }

    /// An unpacked dimension: `[depth]`, `[msb:lsb]`, or `[param]`, giving the
    /// depth as an expression (a literal count, or a parameter name).
    fn parse_unpacked_depth(&mut self) -> Result<Expr, String> {
        self.expect_sym("[")?;
        let first = self.parse_expr()?;
        let depth = if self.at_sym(":") {
            self.next();
            let second = self.parse_expr()?;
            let a = literal_usize(&first)?;
            let b = literal_usize(&second)?;
            let n = if a >= b { a - b + 1 } else { b - a + 1 };
            Expr::Number(n.to_string())
        } else {
            first
        };
        self.expect_sym("]")?;
        Ok(depth)
    }

    /// `always_ff @(edge or edge ...) body` (or a bare `always @(...)`).
    fn parse_always_ff(&mut self) -> Result<Item, String> {
        self.next(); // always_ff / always
        self.expect_sym("@")?;
        self.expect_sym("(")?;
        let mut edges = Vec::new();
        loop {
            let negedge = match self.ident()?.as_str() {
                "posedge" => false,
                "negedge" => true,
                other => {
                    return Err(format!(
                        "line {}: expected posedge or negedge, found '{}'",
                        self.line(),
                        other
                    ))
                }
            };
            let signal = self.ident()?;
            edges.push(Edge { signal, negedge });
            if self.at_kw("or") {
                self.next();
                continue;
            }
            if self.at_sym(",") {
                self.next();
                continue;
            }
            break;
        }
        self.expect_sym(")")?;
        let body = self.parse_stmt_or_block()?;
        Ok(Item::AlwaysFf { edges, body })
    }

    /// A `begin ... end` block, or a single statement.
    fn parse_stmt_or_block(&mut self) -> Result<Vec<Stmt>, String> {
        if self.at_kw("begin") {
            self.next();
            let mut stmts = Vec::new();
            while !self.at_kw("end") {
                if self.at_end() {
                    return Err("unexpected end of input before 'end'".to_string());
                }
                stmts.push(self.parse_stmt()?);
            }
            self.expect_kw("end")?;
            Ok(stmts)
        } else {
            Ok(vec![self.parse_stmt()?])
        }
    }

    fn parse_stmt(&mut self) -> Result<Stmt, String> {
        if self.at_kw("return") {
            self.next();
            let expr = self.parse_expr()?;
            self.expect_sym(";")?;
            return Ok(Stmt::Return(expr));
        }
        if self.at_kw("case") {
            self.next();
            self.expect_sym("(")?;
            let scrutinee = self.parse_expr()?;
            self.expect_sym(")")?;
            let mut arms = Vec::new();
            while !self.at_kw("endcase") {
                if self.at_end() {
                    return Err("unexpected end of input before 'endcase'".to_string());
                }
                let label = if self.at_kw("default") {
                    self.next();
                    None
                } else {
                    Some(self.parse_expr()?)
                };
                self.expect_sym(":")?;
                // An empty arm (`default:` right before `endcase`) has no body.
                let body = if self.at_kw("endcase") {
                    Vec::new()
                } else {
                    self.parse_stmt_or_block()?
                };
                arms.push(CaseArm { label, body });
            }
            self.expect_kw("endcase")?;
            return Ok(Stmt::Case { scrutinee, arms });
        }
        if self.at_kw("if") {
            self.next();
            self.expect_sym("(")?;
            let cond = self.parse_expr()?;
            self.expect_sym(")")?;
            let then = self.parse_stmt_or_block()?;
            let els = if self.at_kw("else") {
                self.next();
                Some(self.parse_stmt_or_block()?)
            } else {
                None
            };
            return Ok(Stmt::If { cond, then, els });
        }
        // An assignment: `target = expr;` or `target <= expr;`. The target may
        // be indexed, as in a memory write `regs[a] <= d`.
        let target = self.parse_primary()?;
        if self.at_sym("<=") || self.at_sym("=") {
            self.next();
        } else {
            return Err(format!(
                "line {}: expected '=' or '<=' in an assignment",
                self.line()
            ));
        }
        let expr = self.parse_expr()?;
        self.expect_sym(";")?;
        Ok(Stmt::Assign { target, expr })
    }

    // ---- expressions, by precedence ----

    fn parse_expr(&mut self) -> Result<Expr, String> {
        self.parse_ternary()
    }

    fn parse_ternary(&mut self) -> Result<Expr, String> {
        let cond = self.parse_binary(0)?;
        if self.at_sym("?") {
            self.next();
            let then = self.parse_expr()?;
            self.expect_sym(":")?;
            let els = self.parse_expr()?;
            return Ok(Expr::Ternary {
                cond: Box::new(cond),
                then: Box::new(then),
                els: Box::new(els),
            });
        }
        Ok(cond)
    }

    /// Precedence-climbing for binary operators. Higher binds tighter.
    fn parse_binary(&mut self, min_prec: u8) -> Result<Expr, String> {
        let mut lhs = self.parse_unary()?;
        while let Some(op) = self.peek_binop() {
            let prec = binop_prec(&op);
            if prec < min_prec {
                break;
            }
            self.next();
            let rhs = self.parse_binary(prec + 1)?;
            lhs = Expr::Binary {
                op,
                lhs: Box::new(lhs),
                rhs: Box::new(rhs),
            };
        }
        Ok(lhs)
    }

    fn parse_unary(&mut self) -> Result<Expr, String> {
        // `!` `~` `-` `+`, plus the reduction operators `^` `&` `|` in prefix
        // position (`^bus`). A reduction only appears at the start of an operand,
        // so it does not clash with the binary `^`/`&`/`|` handled after this.
        for op in ["!", "~", "-", "+", "^", "&", "|"] {
            if self.at_sym(op) {
                self.next();
                let expr = self.parse_unary()?;
                // A unary plus is a no-op; drop it.
                if op == "+" {
                    return Ok(expr);
                }
                return Ok(Expr::Unary { op: op.to_string(), expr: Box::new(expr) });
            }
        }
        self.parse_primary()
    }

    fn parse_primary(&mut self) -> Result<Expr, String> {
        let base = self.parse_atom()?;
        self.parse_postfix(base)
    }

    fn parse_atom(&mut self) -> Result<Expr, String> {
        if self.at_sym("(") {
            self.next();
            let inner = self.parse_expr()?;
            self.expect_sym(")")?;
            return Ok(Expr::Paren(Box::new(inner)));
        }
        // A concatenation `{a, b, ...}`.
        if self.at_sym("{") {
            self.next();
            let mut parts = Vec::new();
            loop {
                parts.push(self.parse_expr()?);
                if self.at_sym(",") {
                    self.next();
                    continue;
                }
                break;
            }
            self.expect_sym("}")?;
            return Ok(Expr::Concat(parts));
        }
        match self.peek().cloned() {
            Some(Token { tok: Tok::Number(text), .. }) => {
                self.next();
                // A size cast `N'(expr)`; the quote is its own token because no
                // base letter followed it.
                if self.at_sym("'") {
                    return self.parse_cast(Expr::Number(text));
                }
                Ok(Expr::Number(text))
            }
            Some(Token { tok: Tok::Ident(name), .. }) => {
                self.next();
                // A system-function call, `$signed(expr)`.
                if name.starts_with('$') {
                    self.expect_sym("(")?;
                    let arg = self.parse_expr()?;
                    self.expect_sym(")")?;
                    return Ok(Expr::SysCall { name, arg: Box::new(arg) });
                }
                // A parameter-width size cast, `PtrWidth'(expr)`.
                if self.at_sym("'") {
                    return self.parse_cast(Expr::Ident(name));
                }
                // A function call, `name(args)`.
                if self.at_sym("(") {
                    self.next();
                    let mut args = Vec::new();
                    if !self.at_sym(")") {
                        loop {
                            args.push(self.parse_expr()?);
                            if self.at_sym(",") {
                                self.next();
                                continue;
                            }
                            break;
                        }
                    }
                    self.expect_sym(")")?;
                    return Ok(Expr::Call { name, args });
                }
                Ok(Expr::Ident(name))
            }
            _ => Err(format!(
                "line {}: expected an expression, found '{}'",
                self.line(),
                self.peek_text()
            )),
        }
    }

    /// Parse the rest of a size cast, `'(expr)`, given the already-parsed width.
    fn parse_cast(&mut self, width: Expr) -> Result<Expr, String> {
        self.expect_sym("'")?;
        self.expect_sym("(")?;
        let inner = self.parse_expr()?;
        self.expect_sym(")")?;
        Ok(Expr::Cast { width: Box::new(width), expr: Box::new(inner) })
    }

    /// A bit select `base[i]` or part select `base[hi:lo]` following a primary.
    fn parse_postfix(&mut self, mut base: Expr) -> Result<Expr, String> {
        loop {
            // A member access, `base.field`.
            if self.at_sym(".") {
                self.next();
                let field = self.ident()?;
                base = Expr::Member { base: Box::new(base), field };
                continue;
            }
            if !self.at_sym("[") {
                break;
            }
            self.next();
            let first = self.parse_expr()?;
            if self.at_sym(":") {
                self.next();
                let lo = self.parse_expr()?;
                self.expect_sym("]")?;
                base = Expr::Part {
                    base: Box::new(base),
                    hi: Box::new(first),
                    lo: Box::new(lo),
                };
            } else if self.at_sym("+:") || self.at_sym("-:") {
                let up = self.at_sym("+:");
                self.next();
                let width = self.parse_expr()?;
                self.expect_sym("]")?;
                base = Expr::IndexPart {
                    base: Box::new(base),
                    index: Box::new(first),
                    width: Box::new(width),
                    up,
                };
            } else {
                self.expect_sym("]")?;
                base = Expr::Bit {
                    base: Box::new(base),
                    index: Box::new(first),
                };
            }
        }
        Ok(base)
    }

    // ---- token helpers ----

    fn peek(&self) -> Option<&Token> {
        self.tokens.get(self.pos)
    }

    fn next(&mut self) -> Option<Token> {
        let t = self.tokens.get(self.pos).cloned();
        self.pos += 1;
        t
    }

    fn at_end(&self) -> bool {
        self.pos >= self.tokens.len()
    }

    fn line(&self) -> usize {
        self.peek().map(|t| t.line).unwrap_or(0)
    }

    fn peek_text(&self) -> String {
        match self.peek() {
            Some(Token { tok: Tok::Ident(s), .. }) => s.clone(),
            Some(Token { tok: Tok::Number(s), .. }) => s.clone(),
            Some(Token { tok: Tok::Sym(s), .. }) => s.clone(),
            None => "<end of input>".to_string(),
        }
    }

    fn at_kw(&self, kw: &str) -> bool {
        matches!(self.peek(), Some(Token { tok: Tok::Ident(s), .. }) if s == kw)
    }

    fn at_sym(&self, s: &str) -> bool {
        matches!(self.peek(), Some(Token { tok: Tok::Sym(t), .. }) if t == s)
    }

    fn ident(&mut self) -> Result<String, String> {
        match self.next() {
            Some(Token { tok: Tok::Ident(s), .. }) => Ok(s),
            other => Err(format!(
                "line {}: expected an identifier, found '{}'",
                other.as_ref().map(|t| t.line).unwrap_or(0),
                text_of(other.as_ref())
            )),
        }
    }


    fn expect_kw(&mut self, kw: &str) -> Result<(), String> {
        if self.at_kw(kw) {
            self.next();
            Ok(())
        } else {
            Err(format!("line {}: expected '{}', found '{}'", self.line(), kw, self.peek_text()))
        }
    }

    fn expect_sym(&mut self, s: &str) -> Result<(), String> {
        if self.at_sym(s) {
            self.next();
            Ok(())
        } else {
            Err(format!("line {}: expected '{}', found '{}'", self.line(), s, self.peek_text()))
        }
    }

    /// The binary operator at the cursor, if any.
    fn peek_binop(&self) -> Option<String> {
        match self.peek() {
            Some(Token { tok: Tok::Sym(s), .. }) if is_binop(s) => Some(s.clone()),
            _ => None,
        }
    }
}

fn text_of(t: Option<&Token>) -> String {
    match t {
        Some(Token { tok: Tok::Ident(s), .. }) => s.clone(),
        Some(Token { tok: Tok::Number(s), .. }) => s.clone(),
        Some(Token { tok: Tok::Sym(s), .. }) => s.clone(),
        None => "<end of input>".to_string(),
    }
}

/// SystemVerilog keywords that can begin a module item but are not type names,
/// so they must not be mistaken for a user-typed declaration.
fn is_reserved(word: &str) -> bool {
    matches!(
        word,
        "initial"
            | "final"
            | "generate"
            | "endgenerate"
            | "assign"
            | "always"
            | "always_ff"
            | "always_comb"
            | "always_latch"
            | "module"
            | "endmodule"
            | "begin"
            | "end"
            | "case"
            | "endcase"
            | "if"
            | "else"
            | "for"
            | "while"
            | "function"
            | "endfunction"
            | "task"
            | "endtask"
            | "typedef"
            | "parameter"
            | "localparam"
            | "logic"
            | "wire"
            | "reg"
    )
}

/// The value of a plain-decimal literal expression, for a range bound.
fn literal_usize(expr: &Expr) -> Result<usize, String> {
    match expr {
        Expr::Number(text) => text
            .parse::<usize>()
            .map_err(|_| format!("range bound '{}' must be a plain integer", text)),
        _ => Err("a range bound must be a literal".to_string()),
    }
}

fn is_binop(s: &str) -> bool {
    matches!(
        s,
        "+" | "-" | "*" | "/" | "%" | "&" | "|" | "^" | "<<" | ">>" | ">>>" | "<<<"
            | "&&" | "||" | "==" | "!=" | "<" | "<=" | ">" | ">="
    )
}

/// Binding power of a binary operator; higher binds tighter. Modelled on
/// Verilog precedence.
fn binop_prec(op: &str) -> u8 {
    match op {
        "||" => 1,
        "&&" => 2,
        "|" => 3,
        "^" => 4,
        "&" => 5,
        "==" | "!=" => 6,
        "<" | "<=" | ">" | ">=" => 7,
        "<<" | ">>" | ">>>" | "<<<" => 8,
        "+" | "-" => 9,
        "*" | "/" | "%" => 10,
        _ => 0,
    }
}
