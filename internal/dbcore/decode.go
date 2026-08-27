// Package dbcore owns connections, query execution and the row -> JSON mapping.
//
// Ported from src-tauri/src/db_core.rs, but the row decoding is a
// re-derivation rather than a translation. sqlx decides what a value is by
// trying Rust types in order and consulting its own compatibility table; Go's
// database/sql has no equivalent, so the Go decoders key off the driver's
// reported column type instead. That means the two implementations can only be
// shown to agree empirically -- see internal/dbcore/parity_test.go, which
// diffs every decoded row against output captured from the Rust build.
package dbcore

import (
	"fmt"
	"strings"
	"time"

	"github.com/thutil/dodb/internal/orderedjson"
)

// DecodeBytesOrHex renders a byte column the way decode_bytes_or_hex does:
// readable UTF-8 stays text, anything else becomes uppercase hex.
//
// This is the branch that keeps PostGIS and MySQL Spatial values alive. Neither
// driver knows those types, and without a bytes fallback they would arrive as
// null -- so the frontend's WKB/EWKB decoder is fed hex from here, and no
// geometry library is needed on the Go side at all.
func DecodeBytesOrHex(b []byte) string {
	if s := string(b); isPrintableUTF8(s) {
		return s
	}
	var sb strings.Builder
	sb.Grow(len(b) * 2)
	for _, c := range b {
		fmt.Fprintf(&sb, "%02X", c)
	}
	return sb.String()
}

// isPrintableUTF8 mirrors the Rust guard: valid UTF-8 containing no control
// characters other than tab, newline and carriage return.
func isPrintableUTF8(s string) bool {
	for i, r := range s {
		if r == 0xFFFD {
			// A replacement rune from an invalid byte. Confirm it is genuine
			// rather than a literal U+FFFD in the input.
			if s[i] != 0xEF {
				return false
			}
		}
		if isControl(r) && r != '\n' && r != '\r' && r != '\t' {
			return false
		}
	}
	return true
}

// isControl matches Rust's char::is_control, which is the Unicode Cc category:
// U+0000..U+001F and U+007F..U+009F.
func isControl(r rune) bool {
	return r <= 0x1F || (r >= 0x7F && r <= 0x9F)
}

// UniqueColName resolves a duplicate column label to name_1, name_2, ...
//
// A join like `SELECT p.id, c.id` yields two columns called "id"; without this
// the second would overwrite the first and a column would vanish from the grid.
func UniqueColName(row *orderedjson.Object, raw string) string {
	if !row.Has(raw) {
		return raw
	}
	for suffix := 1; ; suffix++ {
		candidate := fmt.Sprintf("%s_%d", raw, suffix)
		if !row.Has(candidate) {
			return candidate
		}
	}
}

// fracSuffix reproduces chrono's SecondsFormat::AutoSi, which is what
// to_rfc3339 and NaiveDateTime::to_string use: the fraction is printed with 0,
// 3, 6 or 9 digits -- the fewest that represent the value exactly.
//
// Go's own formatters do the opposite (".000" pads, ".999" trims every trailing
// zero), so neither can be used directly: chrono renders one microsecond as
// ".000001" where Go's ".999999" would give the same but ".999" would give "",
// and chrono renders 123ms as ".123" where Go's ".000000" would give ".123000".
func fracSuffix(nanos int) string {
	switch {
	case nanos == 0:
		return ""
	case nanos%1_000_000 == 0:
		return fmt.Sprintf(".%03d", nanos/1_000_000)
	case nanos%1_000 == 0:
		return fmt.Sprintf(".%06d", nanos/1_000)
	default:
		return fmt.Sprintf(".%09d", nanos)
	}
}

// FormatRFC3339 renders a zoned timestamp the way chrono's to_rfc3339 does.
//
// Note "+00:00" rather than "Z": Go's time.RFC3339 layout collapses UTC to "Z",
// chrono never does. The frontend parses both, but the parity suite does not.
func FormatRFC3339(t time.Time) string {
	return t.Format("2006-01-02T15:04:05") + fracSuffix(t.Nanosecond()) + t.Format("-07:00")
}

// FormatNaiveDateTime renders an unzoned timestamp as NaiveDateTime::to_string
// does: a space separator and no offset.
func FormatNaiveDateTime(t time.Time) string {
	return t.Format("2006-01-02 15:04:05") + fracSuffix(t.Nanosecond())
}

// FormatNaiveDate renders NaiveDate::to_string.
func FormatNaiveDate(t time.Time) string { return t.Format("2006-01-02") }

// FormatNaiveTime renders NaiveTime::to_string.
func FormatNaiveTime(t time.Time) string {
	return t.Format("15:04:05") + fracSuffix(t.Nanosecond())
}
