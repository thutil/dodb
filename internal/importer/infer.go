package importer

import (
	"strconv"
	"strings"
	"unicode"
)

// IsNullToken matches the spellings of NULL that every tabular exporter emits.
func IsNullToken(raw string) bool {
	t := strings.TrimSpace(raw)
	return t == `\N` || strings.EqualFold(t, "null")
}

func looksBoolean(t string) bool {
	switch strings.ToLower(t) {
	case "true", "false", "t", "f", "yes", "no", "y", "n":
		return true
	}
	return false
}

// looksDate matches YYYY-MM-DD exactly.
func looksDate(t string) bool {
	if len(t) != 10 || t[4] != '-' || t[7] != '-' {
		return false
	}
	for i, c := range []byte(t) {
		if i == 4 || i == 7 {
			continue
		}
		if c < '0' || c > '9' {
			return false
		}
	}
	return true
}

// looksTimestamp matches a date followed by a space, T or t and a digit.
func looksTimestamp(t string) bool {
	if len(t) < 16 || !looksDate(t[:10]) {
		return false
	}
	sep := t[10]
	if sep != ' ' && sep != 'T' && sep != 't' {
		return false
	}
	return t[11] >= '0' && t[11] <= '9'
}

func looksJSON(t string) bool {
	return (strings.HasPrefix(t, "{") && strings.HasSuffix(t, "}")) ||
		(strings.HasPrefix(t, "[") && strings.HasSuffix(t, "]"))
}

// InferType picks the narrowest type that holds every sample, and reports
// whether any sample was missing.
//
// Widening only ever goes one way (integer -> bigint -> double -> text), so a
// column of ids that ends with one free-text row comes back as Text rather than
// failing halfway through a 500,000-row import.
func InferType(samples []*string) (InferredType, bool) {
	nullable := false
	seen := 0

	allInt, fitsI32 := true, true
	allFloat, allBool, allDate, allTS, allJSON := true, true, true, true, true

	for _, s := range samples {
		if s == nil {
			nullable = true
			continue
		}
		t := strings.TrimSpace(*s)
		if t == "" || IsNullToken(t) {
			nullable = true
			continue
		}
		seen++

		if v, err := strconv.ParseInt(t, 10, 64); err == nil {
			if v < -2147483648 || v > 2147483647 {
				fitsI32 = false
			}
		} else {
			allInt = false
		}
		if f, err := strconv.ParseFloat(t, 64); err != nil || isNonFinite(f) {
			allFloat = false
		}
		if !looksBoolean(t) {
			allBool = false
		}
		if !looksDate(t) {
			allDate = false
		}
		if !looksTimestamp(t) {
			allTS = false
		}
		if !looksJSON(t) {
			allJSON = false
		}
	}

	if seen == 0 {
		// Nothing but blanks: text is the only safe guess, and it is nullable.
		return TypeText, true
	}

	// Integer is checked before boolean on purpose: "1"/"0" parse as both, and
	// a column of only 1/0 is more often a counter than a flag when it is
	// already numeric. The Rust build makes the same call.
	switch {
	case allInt && fitsI32:
		return TypeInteger, nullable
	case allInt:
		return TypeBigint, nullable
	case allBool:
		return TypeBoolean, nullable
	case allFloat:
		return TypeDouble, nullable
	case allDate:
		return TypeDate, nullable
	case allTS:
		return TypeTimestamp, nullable
	case allJSON:
		return TypeJSON, nullable
	default:
		return TypeText, nullable
	}
}

func isNonFinite(f float64) bool {
	return f != f || f > 1.797693134862315708145274237317043567981e+308 ||
		f < -1.797693134862315708145274237317043567981e+308
}

// ValueTypeFromSQLType maps a column type reported by get_columns back to a
// coercion rule.
//
// Importing into an existing table must follow the column that is actually
// there rather than what the file looked like, or a text-shaped CSV cell lands
// quoted in an integer column and the whole batch fails.
func ValueTypeFromSQLType(sqlType string) InferredType {
	t := strings.ToLower(strings.TrimSpace(sqlType))
	head := t
	if i := strings.IndexAny(t, "( "); i >= 0 {
		head = t[:i]
	}

	switch head {
	case "bool", "boolean":
		return TypeBoolean
	case "tinyint":
		// MySQL spells BOOLEAN as TINYINT(1); anything wider is a real integer.
		if strings.HasPrefix(t, "tinyint(1)") {
			return TypeBoolean
		}
		return TypeInteger
	case "bit":
		// BIT(1) is the other one-bit shape. A wider BIT(n) holds arbitrary
		// bits, which no boolean coercion would survive.
		if t == "bit" || strings.HasPrefix(t, "bit(1)") {
			return TypeBoolean
		}
		return TypeText
	case "smallint", "int2", "mediumint", "int", "integer", "int4", "serial":
		return TypeInteger
	case "bigint", "int8", "bigserial":
		return TypeBigint
	case "real", "float", "float4", "float8", "double", "numeric", "decimal":
		return TypeDouble
	case "money":
		// MONEY is written "$1,234.56", which no float parser accepts; the
		// server casts the string literal itself.
		return TypeText
	case "date":
		return TypeDate
	case "datetime", "timestamp", "timestamptz":
		return TypeTimestamp
	case "json", "jsonb":
		return TypeJSON
	default:
		return TypeText
	}
}

// SanitizeIdent turns a spreadsheet header into a usable column name.
func SanitizeIdent(raw string) string {
	var out []rune
	lastUnderscore := false

	for _, ch := range strings.TrimSpace(raw) {
		// Non-ASCII characters are kept deliberately: the engines accept them
		// once quoted, and unicode.IsLetter is false for Thai tone marks and
		// vowel signs, so filtering on it silently mangles a Thai header.
		keep := (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') ||
			(ch >= '0' && ch <= '9') || ch == '_' ||
			(ch > 0x7F && !unicode.IsSpace(ch) && !unicode.IsControl(ch))

		if keep {
			out = append(out, ch)
			lastUnderscore = false
			continue
		}
		if !lastUnderscore && len(out) > 0 {
			out = append(out, '_')
			lastUnderscore = true
		}
	}

	for len(out) > 0 && out[len(out)-1] == '_' {
		out = out[:len(out)-1]
	}
	if len(out) == 0 {
		return "column"
	}
	if out[0] >= '0' && out[0] <= '9' {
		// A leading digit is not a valid unquoted identifier on any of the three.
		out = append([]rune{'_'}, out...)
	}
	return string(out)
}

// SanitizeHeader sanitizes a whole header row, resolving collisions with a
// numeric suffix so two columns called "Total (%)" and "Total #" do not both
// become "Total".
func SanitizeHeader(raw []string) []string {
	out := make([]string, 0, len(raw))
	for _, h := range raw {
		base := SanitizeIdent(h)
		name := base
		for n := 2; containsFold(out, name); n++ {
			name = base + "_" + strconv.Itoa(n)
		}
		out = append(out, name)
	}
	return out
}

func containsFold(list []string, needle string) bool {
	for _, item := range list {
		if strings.EqualFold(item, needle) {
			return true
		}
	}
	return false
}
