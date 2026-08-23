//! Waveform recording and VCD output
//!
//! Both the interpreter and a compiled simulation record into a `SignalTrace`
//! and write it out with `write_vcd`, so the two produce byte-identical
//! waveforms for the same design.

use std::collections::HashMap;
use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::Path;

use crate::value::{BitValue, FloatFmt, SignalValue};
use crate::SimTime;

/// Recorded value changes, per signal
#[derive(Clone, Debug, Default)]
pub struct SignalTrace {
    /// Value changes, in the order they were recorded
    signals: HashMap<String, Vec<(SimTime, SignalValue)>>,
    /// Declared width of each signal
    widths: HashMap<String, usize>,
    /// Signals whose IRIS type is signed
    signed: HashMap<String, bool>,
    /// Floating-point format of each signal, when it has one
    float: HashMap<String, Option<FloatFmt>>,
    /// Signal names in the order they were first recorded
    order: Vec<String>,
}

impl SignalTrace {
    /// Create an empty trace
    pub fn new() -> Self {
        Self::default()
    }

    /// Record a value change. Repeating the current value is ignored.
    pub fn record(&mut self, name: &str, time: SimTime, value: SignalValue) {
        self.widths.insert(name.to_string(), value.width());
        self.signed.insert(name.to_string(), value.is_signed());
        // A float format, once seen for a signal, stays with it. Reset and
        // memory-clear writes may carry a plain integer zero; they must not
        // erase the format the declaration gave the signal.
        match value.float_fmt() {
            Some(fmt) => {
                self.float.insert(name.to_string(), Some(fmt));
            }
            None => {
                self.float.entry(name.to_string()).or_insert(None);
            }
        }

        let changes = match self.signals.get_mut(name) {
            Some(changes) => changes,
            None => {
                self.order.push(name.to_string());
                self.signals.entry(name.to_string()).or_default()
            }
        };

        if changes.is_empty() || changes.last().map(|(_, v)| v != &value).unwrap_or(true) {
            changes.push((time, value));
        }
    }

    /// Changes recorded for one signal
    pub fn get_changes(&self, name: &str) -> Option<&Vec<(SimTime, SignalValue)>> {
        self.signals.get(name)
    }

    /// Every signal name, in the order first recorded
    pub fn signal_names(&self) -> impl Iterator<Item = &String> {
        self.order.iter()
    }

    /// Declared width of a signal
    pub fn get_width(&self, name: &str) -> Option<usize> {
        self.widths.get(name).copied()
    }

    /// Whether the signal's IRIS type is signed.
    ///
    /// VCD has no field for a source-language type, but it does distinguish
    /// `wire` from `integer`, and a reader passes that distinction on. It is
    /// the only place the signedness of an `int[N]` survives into the file.
    pub fn is_signed(&self, name: &str) -> bool {
        self.signed.get(name).copied().unwrap_or(false)
    }

    /// The signal's floating-point format, if it has one.
    pub fn float_fmt(&self, name: &str) -> Option<FloatFmt> {
        self.float.get(name).copied().flatten()
    }

    /// Every signal with its changes
    pub fn signals(&self) -> impl Iterator<Item = (&String, &Vec<(SimTime, SignalValue)>)> {
        self.signals.iter()
    }

    /// Time of the last recorded change
    pub fn end_time(&self) -> SimTime {
        self.signals
            .values()
            .filter_map(|changes| changes.last().map(|(t, _)| *t))
            .max()
            .unwrap_or(0)
    }

    /// Write the trace as a VCD file
    pub fn write_vcd(&self, path: &Path, module_name: &str) -> std::io::Result<()> {
        let mut writer = BufWriter::new(File::create(path)?);
        write_vcd_to(&mut writer, self, module_name, "1ps")?;
        writer.flush()
    }
}

/// VCD identifier code for the `n`-th signal.
///
/// A VCD identifier is a *string* of printable ASCII, not a single character.
/// Emitting one character caps a file at 94 signals; beyond that the codes
/// wrap and two signals share one code, which no reader can tell apart and
/// which no diagnostic reports. `n` below 94 yields the same single character
/// as before, so files that never reached the cap are unchanged.
pub fn vcd_ident(mut n: usize) -> String {
    const FIRST: u8 = b'!';
    const COUNT: usize = (b'~' - b'!' + 1) as usize; // 94 printable codes

    let mut chars = Vec::new();
    loop {
        chars.push((FIRST + (n % COUNT) as u8) as char);
        if n < COUNT {
            break;
        }
        n = n / COUNT - 1;
    }
    chars.iter().rev().collect()
}

/// A floating-point value rendered as a VCD real, e.g. `1.5`, or `None` when
/// the value is not tagged as floating point.
///
/// VCD's real values are decimal, not bit patterns: a viewer shows `1.5`, not
/// `0x3FC00000`. The bits are read back through the value's own format so an
/// `f32` and an `f64` both print as the number they stand for.
pub fn vcd_real_value(value: &SignalValue) -> Option<String> {
    match value.float_fmt()? {
        FloatFmt::F32 => value.as_f32().map(|x| format!("{}", x)),
        FloatFmt::F64 => value.as_f64().map(|x| format!("{}", x)),
    }
}

/// One `$var` declaration: full dotted name, identifier code, bit width,
/// whether the IRIS type is signed, and whether it is floating point.
pub type VarDecl = (String, String, usize, bool, bool);

/// A level of the `$scope` tree, holding the variables declared at this level
/// and the child scopes below it, both in first-seen order.
#[derive(Default)]
struct ScopeNode {
    /// Child scopes, in the order their first signal appeared
    children: Vec<(String, ScopeNode)>,
    /// Variables at this level: leaf name, identifier, width, signedness
    vars: Vec<VarDecl>,
}

impl ScopeNode {
    fn child_mut(&mut self, name: &str) -> &mut ScopeNode {
        if let Some(pos) = self.children.iter().position(|(n, _)| n == name) {
            return &mut self.children[pos].1;
        }
        self.children.push((name.to_string(), ScopeNode::default()));
        &mut self.children.last_mut().expect("just pushed").1
    }

    fn insert(&mut self, path: &[&str], leaf: &str, id: &str, width: usize, signed: bool, is_float: bool) {
        match path.split_first() {
            None => self
                .vars
                .push((leaf.to_string(), id.to_string(), width, signed, is_float)),
            Some((head, rest)) => self.child_mut(head).insert(rest, leaf, id, width, signed, is_float),
        }
    }

    fn emit<W: Write>(&self, out: &mut W) -> std::io::Result<()> {
        for (name, id, width, signed, is_float) in &self.vars {
            // A floating-point signal is a VCD `real`: its value changes are
            // decimal (`r1.5`), so the reader must be told the type up front.
            // VCD carries no bit range for a real; its size field is 1.
            if *is_float {
                writeln!(out, "$var real 1 {} {} $end", id, name)?;
                continue;
            }
            // `integer` is VCD's own word for a signed quantity. Emitting it
            // is what lets a viewer, or a plugin behind one, render `int[32]`
            // as a negative number rather than a large positive one.
            let kind = if *signed { "integer" } else { "wire" };
            if *width == 1 {
                writeln!(out, "$var {} {} {} {} $end", kind, width, id, name)?;
            } else {
                writeln!(
                    out,
                    "$var {} {} {} {} [{}:0] $end",
                    kind,
                    width,
                    id,
                    name,
                    width - 1
                )?;
            }
        }
        for (name, child) in &self.children {
            writeln!(out, "$scope module {} $end", name)?;
            child.emit(out)?;
            writeln!(out, "$upscope $end")?;
        }
        Ok(())
    }
}

/// Write `$var` declarations with hierarchy expressed as nested `$scope`
/// blocks.
///
/// A recorded name already carries its hierarchy as dot-separated segments
/// (`dut.wr_ptr`). Emitting that verbatim inside a single scope leaves every
/// signal in one flat list, which is not how VCD represents a hierarchy and
/// not what a viewer can navigate. The leading segments become scopes and the
/// last segment becomes the signal name.
pub fn write_scoped_vars<W: Write>(out: &mut W, decls: &[VarDecl]) -> std::io::Result<()> {
    let mut root = ScopeNode::default();
    for (full_name, id, width, signed, is_float) in decls {
        let parts: Vec<&str> = full_name.split('.').collect();
        let (leaf, path) = parts.split_last().expect("split always yields one part");
        root.insert(path, leaf, id, *width, *signed, *is_float);
    }
    root.emit(out)
}

/// Render a trace in VCD form
pub fn write_vcd_to<W: Write>(
    out: &mut W,
    trace: &SignalTrace,
    module_name: &str,
    timescale: &str,
) -> std::io::Result<()> {
    writeln!(out, "$date")?;
    writeln!(out, "   Simulation output")?;
    writeln!(out, "$end")?;
    writeln!(out, "$version")?;
    writeln!(out, "   IRIS-SIM 0.1.0")?;
    writeln!(out, "$end")?;
    writeln!(out, "$timescale")?;
    writeln!(out, "   {}", timescale)?;
    writeln!(out, "$end")?;
    writeln!(out, "$scope module {} $end", module_name)?;

    // VCD identifies signals by a short printable code
    let names: Vec<String> = trace.signal_names().cloned().collect();
    let mut ids: HashMap<String, String> = HashMap::new();
    let mut decls: Vec<VarDecl> = Vec::with_capacity(names.len());
    for (index, name) in names.iter().enumerate() {
        let id = vcd_ident(index);
        let width = trace.get_width(name).unwrap_or(1);
        let is_float = trace.float_fmt(name).is_some();
        decls.push((name.clone(), id.clone(), width, trace.is_signed(name), is_float));
        ids.insert(name.clone(), id);
    }
    write_scoped_vars(out, &decls)?;

    writeln!(out, "$upscope $end")?;
    writeln!(out, "$enddefinitions $end")?;

    let mut all_times: Vec<SimTime> = Vec::new();
    for (_, changes) in trace.signals() {
        for (time, _) in changes {
            all_times.push(*time);
        }
    }
    all_times.sort_unstable();
    all_times.dedup();

    writeln!(out, "$dumpvars")?;
    for name in &names {
        if let (Some(id), Some(changes)) = (ids.get(name), trace.get_changes(name)) {
            if let Some((_, value)) = changes.first() {
                write_value(out, id, value)?;
            }
        }
    }
    writeln!(out, "$end")?;

    let mut current: HashMap<&str, &SignalValue> = HashMap::new();
    for name in &names {
        if let Some(changes) = trace.get_changes(name) {
            if let Some((_, value)) = changes.first() {
                current.insert(name.as_str(), value);
            }
        }
    }

    for time in &all_times {
        let mut time_written = false;
        for name in &names {
            let Some(changes) = trace.get_changes(name) else {
                continue;
            };
            for (t, value) in changes {
                if t != time {
                    continue;
                }
                let changed = current.get(name.as_str()).map(|v| *v != value).unwrap_or(true);
                if changed || *time == 0 {
                    if !time_written {
                        writeln!(out, "#{}", time)?;
                        time_written = true;
                    }
                    if let Some(id) = ids.get(name) {
                        write_value(out, id, value)?;
                    }
                    current.insert(name.as_str(), value);
                }
            }
        }
    }

    Ok(())
}

fn write_value<W: Write>(out: &mut W, id: &str, value: &SignalValue) -> std::io::Result<()> {
    // A floating-point value is written as a VCD real (`r1.5 <id>`).
    if let Some(real) = vcd_real_value(value) {
        return writeln!(out, "r{} {}", real, id);
    }
    let width = value.width();
    if width == 1 {
        let bit = value.get_bit(0).unwrap_or(BitValue::X);
        writeln!(out, "{}{}", bit.to_char(), id)
    } else {
        write!(out, "b")?;
        for i in (0..width).rev() {
            let bit = value.get_bit(i).unwrap_or(BitValue::X);
            write!(out, "{}", bit.to_char())?;
        }
        writeln!(out, " {}", id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    /// Below the 94-code ceiling the identifier is a single character, so
    /// waveforms that never reached the ceiling are byte-identical to those
    /// written before multi-character codes existed.
    #[test]
    fn short_identifiers_are_unchanged() {
        assert_eq!(vcd_ident(0), "!");
        assert_eq!(vcd_ident(1), "\"");
        assert_eq!(vcd_ident(93), "~");
    }

    /// Past the ceiling the code grows instead of wrapping onto a code that
    /// is already in use.
    #[test]
    fn identifiers_grow_past_the_ceiling() {
        assert_eq!(vcd_ident(94), "!!");
        assert_eq!(vcd_ident(95), "!\"");
        assert!(vcd_ident(10_000).len() > 1);
    }

    /// The defect this guards: signal 94 once received the same code as
    /// signal 0, and no diagnostic reported it.
    #[test]
    fn identifiers_never_collide() {
        let mut seen = HashSet::new();
        for n in 0..20_000 {
            assert!(seen.insert(vcd_ident(n)), "code reused at index {}", n);
        }
    }

    /// Every code must be printable ASCII, as VCD requires.
    #[test]
    fn identifiers_are_printable() {
        for n in 0..5_000 {
            for c in vcd_ident(n).chars() {
                assert!(('!'..='~').contains(&c), "index {} produced {:?}", n, c);
            }
        }
    }
}
