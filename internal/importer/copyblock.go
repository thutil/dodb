package importer

import (
	"fmt"
	"strconv"
	"strings"
)

// CopyHeader is the table and columns named by a COPY ... FROM stdin.
type CopyHeader struct {
	Table string
	// Columns is empty when the statement named none.
	Columns []string
}

// ParseCopyHeader recognises the COPY that opens a default pg_dump data block.
//
// This matters because a plain pg_dump puts rows in the file as tab-separated
// text AFTER the statement, not as INSERTs. Handing those lines to the server as
// SQL produces a wall of syntax errors, so the reader has to know where a COPY
// block begins and consume its data itself.
//
// The three results are distinct on purpose: not a COPY at all (nil, nil), a
// COPY this reader understands (header, nil), and a COPY whose data is in a
// format it does not (nil, error) -- parsing a CSV or binary block as tabs would
// quietly mangle every row, so it is refused instead.
func ParseCopyHeader(sql string) (*CopyHeader, error) {
	trimmed := strings.TrimSpace(sql)
	upper := strings.ToUpper(trimmed)

	if !strings.HasPrefix(upper, "COPY") {
		return nil, nil
	}
	// "COPYRIGHT" must not match.
	if len(upper) > 4 && !isSpaceByte(upper[4]) {
		return nil, nil
	}
	if !strings.Contains(upper, "FROM STDIN") {
		return nil, nil
	}
	if strings.Contains(upper, "FORMAT") &&
		(strings.Contains(upper, "CSV") || strings.Contains(upper, "BINARY")) {
		return nil, fmt.Errorf(
			"This COPY block is not in the default text format, so its rows cannot be read. " +
				"Re-dump with `pg_dump --inserts`.")
	}

	rest := strings.TrimLeft(trimmed[4:], " \t\r\n")
	offset := len(trimmed) - len(rest)

	paren := strings.Index(rest, "(")
	from := -1
	if i := findKeyword(upper, "FROM"); i >= 0 {
		from = i - offset
	}

	var (
		tableEnd int
		columns  []string
	)
	switch {
	case paren >= 0 && from >= 0 && paren < from:
		close := strings.Index(rest[paren:], ")")
		if close < 0 {
			return nil, nil
		}
		tableEnd = paren
		columns = splitIdentList(rest[paren+1 : paren+close])
	case from >= 0:
		tableEnd = from
	default:
		return nil, nil
	}

	table := stripIdent(strings.TrimSpace(rest[:tableEnd]))
	if table == "" {
		return nil, nil
	}
	return &CopyHeader{Table: table, Columns: columns}, nil
}

// findKeyword finds kw as a standalone word in already-upper-cased text.
func findKeyword(upper, kw string) int {
	for i := 0; i+len(kw) <= len(upper); i++ {
		if upper[i:i+len(kw)] != kw {
			continue
		}
		beforeOK := i == 0 || !isIdentByte(upper[i-1])
		after := i + len(kw)
		afterOK := after >= len(upper) || !isIdentByte(upper[after])
		if beforeOK && afterOK {
			return i
		}
	}
	return -1
}

func isIdentByte(c byte) bool {
	return isAlphaByte(c) || (c >= '0' && c <= '9') || c == '_'
}

func splitIdentList(list string) []string {
	var out []string
	for _, part := range strings.Split(list, ",") {
		if c := stripIdent(strings.TrimSpace(part)); c != "" {
			out = append(out, c)
		}
	}
	return out
}

// stripIdent removes the double quotes Postgres puts around an identifier that
// needs them.
func stripIdent(raw string) string {
	t := strings.TrimSpace(raw)
	if len(t) >= 2 && strings.HasPrefix(t, `"`) && strings.HasSuffix(t, `"`) {
		return strings.ReplaceAll(t[1:len(t)-1], `""`, `"`)
	}
	return t
}

// UnescapeCopyField decodes one field of a COPY text-format row.
//
// A bare \N is NULL, and that is checked BEFORE unescaping: a field holding the
// letter N is written \\N, and unescaping first would turn it into \N and then
// read it as NULL, silently replacing data with nothing.
func UnescapeCopyField(raw string) *string {
	if raw == `\N` {
		return nil
	}
	if !strings.Contains(raw, `\`) {
		v := raw
		return &v
	}

	var out strings.Builder
	out.Grow(len(raw))
	runes := []rune(raw)

	for i := 0; i < len(runes); i++ {
		c := runes[i]
		if c != '\\' {
			out.WriteRune(c)
			continue
		}
		i++
		if i >= len(runes) {
			// A trailing backslash: keep it rather than dropping a character.
			out.WriteRune('\\')
			break
		}
		switch runes[i] {
		case 'n':
			out.WriteRune('\n')
		case 't':
			out.WriteRune('\t')
		case 'r':
			out.WriteRune('\r')
		case 'b':
			out.WriteRune('\b')
		case 'f':
			out.WriteRune('\f')
		case 'v':
			out.WriteRune('\v')
		case '\\':
			out.WriteRune('\\')
		case 'x':
			// \xNN, one or two hex digits.
			hex := ""
			for len(hex) < 2 && i+1 < len(runes) && isHexRune(runes[i+1]) {
				i++
				hex += string(runes[i])
			}
			if hex == "" {
				out.WriteRune('x')
				break
			}
			if v, err := strconv.ParseUint(hex, 16, 8); err == nil {
				out.WriteRune(rune(v))
			} else {
				out.WriteString(hex)
			}
		default:
			if runes[i] >= '0' && runes[i] <= '7' {
				// Up to three octal digits.
				oct := string(runes[i])
				for len(oct) < 3 && i+1 < len(runes) && runes[i+1] >= '0' && runes[i+1] <= '7' {
					i++
					oct += string(runes[i])
				}
				if v, err := strconv.ParseUint(oct, 8, 8); err == nil {
					out.WriteRune(rune(v))
				} else {
					out.WriteString(oct)
				}
				break
			}
			// Postgres reads a backslash before anything else as that character.
			out.WriteRune(runes[i])
		}
	}

	v := out.String()
	return &v
}

func isHexRune(r rune) bool {
	return (r >= '0' && r <= '9') || (r >= 'a' && r <= 'f') || (r >= 'A' && r <= 'F')
}

// SplitCopyRow splits one COPY text-format line into its fields.
func SplitCopyRow(line string) []*string {
	parts := strings.Split(line, "\t")
	out := make([]*string, 0, len(parts))
	for _, p := range parts {
		out = append(out, UnescapeCopyField(p))
	}
	return out
}

// IsCopyTerminator reports the lone backslash-dot that ends a COPY data block.
func IsCopyTerminator(line string) bool {
	return strings.TrimRight(line, "\r") == `\.`
}
