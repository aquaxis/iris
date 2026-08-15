//! The spellings that differ between the two languages.
//!
//! Both languages are close enough that most tokens carry across unchanged.
//! The ones that do not are listed here rather than scattered through the
//! walk, so the whole set can be read at once and checked against the grammar.

/// The IRIS spelling of a Veryl token, or the token itself.
pub fn to_iris(veryl: &str) -> &str {
    match veryl {
        // Veryl writes the ordering comparisons with a colon so that `<` stays
        // free for generic arguments. IRIS has no such conflict.
        "<:" => "<",
        ">:" => ">",
        // Type keywords that appear inside expressions, as in a cast.
        "logic" => "bit",
        other => other,
    }
}

/// The Veryl spelling of an IRIS token, or the token itself.
///
/// The inverse of [`to_iris`], kept beside it so the two cannot drift.
pub fn to_veryl(iris: &str) -> &str {
    match iris {
        "<" => "<:",
        ">" => ">:",
        other => other,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_ordering_comparisons_swap_spelling() {
        assert_eq!(to_iris("<:"), "<");
        assert_eq!(to_iris(">:"), ">");
        assert_eq!(to_veryl("<"), "<:");
        assert_eq!(to_veryl(">"), ">:");
    }

    #[test]
    fn the_two_directions_are_inverses_where_both_are_defined() {
        // If they were not, a round trip would change the operator.
        for veryl in ["<:", ">:"] {
            assert_eq!(to_veryl(to_iris(veryl)), veryl);
        }
    }

    #[test]
    fn an_ordinary_token_is_left_alone() {
        for token in ["a", "+", "8", "always_comb", "==", ">>>"] {
            assert_eq!(to_iris(token), token);
        }
    }
}
