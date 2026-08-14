//! Surfer translator plugin for IRIS.
//!
//! Surfer shows a waveform value as raw bits unless a translator says what
//! the bits mean. IRIS knows more than the VCD file can carry: a `bit[8]` is
//! unsigned, an `int[32]` is two's complement, and a single `bit` is a
//! boolean. That knowledge is lost on the way into the file, and this plugin
//! puts it back.
//!
//! What this plugin does not do is expand memories. A memory reaches the
//! viewer as a scope with one variable per element, which Surfer already
//! expands on its own; a translator changes how a value is *shown*, and
//! cannot conjure a value the file does not contain.
//!
//! Surfer calls plugins through Extism. The four functions below are the ones
//! it requires; `new` and `set_wave_source` are optional and omitted.

use extism_pdk::*;
use surfer_translation_types::{
    TranslationPreference, TranslationResult, ValueKind, ValueRepr, VariableInfo, VariableMeta,
    VariableType, VariableValue,
};

use surfer_translation_types::plugin_types::TranslateParams;

/// Name shown in Surfer's translator menu.
#[plugin_fn]
pub fn name() -> FnResult<String> {
    Ok("IRIS".to_string())
}

/// Whether this translator is offered for a variable.
///
/// Offered but not preferred: the built-in translators stay the default, and
/// a reader chooses IRIS when they want the IRIS reading of the bits.
#[plugin_fn]
pub fn translates(variable: Json<VariableMeta<(), ()>>) -> FnResult<Json<TranslationPreference>> {
    let Json(variable) = variable;
    let preference = match variable.num_bits {
        Some(0) | None => TranslationPreference::No,
        Some(_) => TranslationPreference::Yes,
    };
    Ok(Json(preference))
}

/// Shape of the variable: a single bit is a boolean, anything wider is a
/// bit vector.
#[plugin_fn]
pub fn variable_info(variable: Json<VariableMeta<(), ()>>) -> FnResult<Json<VariableInfo>> {
    let Json(variable) = variable;
    let info = match variable.num_bits {
        Some(1) => VariableInfo::Bool,
        _ => VariableInfo::Bits,
    };
    Ok(Json(info))
}

/// Render one value.
#[plugin_fn]
pub fn translate(params: Json<TranslateParams>) -> FnResult<Json<TranslationResult>> {
    let Json(TranslateParams { variable, value }) = params;
    let width = variable.num_bits.unwrap_or(0);

    let rendered = match &value {
        // A value Surfer could not read as a number keeps whatever it had:
        // an `x` or `z` must not be rendered as if it were a number.
        VariableValue::String(text) => ValueRepr::String(text.clone()),
        VariableValue::BigUint(bits) => {
            if width == 1 {
                // A single bit reads as a bit, not as the number 0 or 1.
                let bit = if bits.bit(0) { '1' } else { '0' };
                ValueRepr::Bit(bit)
            } else if is_signed(&variable) {
                ValueRepr::String(format_signed(bits, width))
            } else {
                ValueRepr::String(bits.to_string())
            }
        }
    };

    Ok(Json(TranslationResult {
        val: rendered,
        subfields: vec![],
        kind: ValueKind::Normal,
    }))
}

/// Whether the IRIS type behind this variable is signed.
///
/// The obvious place to look, `variable_type_name`, is always empty for a VCD:
/// a viewer fills it from a VHDL type name, and there is none. What does
/// survive is the `$var` keyword, which `iris-sim` writes as `integer` for an
/// `int[N]` and `wire` for everything else.
fn is_signed(variable: &VariableMeta<(), ()>) -> bool {
    matches!(variable.variable_type, Some(VariableType::VCDInteger))
}

/// Render `bits` as a two's complement value of the given width.
fn format_signed(bits: &num_bigint::BigUint, width: u32) -> String {
    if width == 0 {
        return "0".to_string();
    }
    // The top bit set means the value is negative, and the magnitude is the
    // two's complement of what is stored.
    if bits.bit((width - 1) as u64) {
        let modulus = num_bigint::BigUint::from(1u8) << width;
        let magnitude = modulus - bits;
        format!("-{}", magnitude)
    } else {
        bits.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use num_bigint::BigUint;

    #[test]
    fn unsigned_values_read_as_written() {
        assert_eq!(format_signed(&BigUint::from(10u8), 8), "10");
    }

    #[test]
    fn signed_values_use_twos_complement() {
        // 0xF0 over 8 bits is -16, not 240.
        assert_eq!(format_signed(&BigUint::from(0xF0u8), 8), "-16");
        // The most negative value of a width is representable.
        assert_eq!(format_signed(&BigUint::from(0x80u8), 8), "-128");
        // A positive value is unchanged by the signed reading.
        assert_eq!(format_signed(&BigUint::from(0x7Fu8), 8), "127");
    }

    #[test]
    fn the_widest_negative_value_of_each_width_is_representable() {
        assert_eq!(format_signed(&BigUint::from(1u8), 1), "-1");
        assert_eq!(format_signed(&BigUint::from(0u8), 1), "0");
        assert_eq!(format_signed(&BigUint::from(0xFFFFFFFFu32), 32), "-1");
        assert_eq!(format_signed(&BigUint::from(0x80000000u32), 32), "-2147483648");
    }
}
