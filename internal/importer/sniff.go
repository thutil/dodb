package importer

import (
	"io"
	"path/filepath"
	"strings"
	"unicode/utf8"

	"golang.org/x/text/encoding/charmap"
	"golang.org/x/text/transform"
)

// DetectFormat picks a format from the file name, falling back to its contents.
func DetectFormat(path, head string) Format {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".sql":
		return FormatSQL
	case ".json", ".jsonl", ".ndjson":
		return FormatJSON
	case ".csv", ".tsv":
		return FormatCSV
	}

	// Unknown extension: go by content.
	t := strings.TrimLeft(head, " \t\r\n")
	if strings.HasPrefix(t, "{") || strings.HasPrefix(t, "[") {
		return FormatJSON
	}
	upper := strings.ToUpper(t)
	for _, kw := range []string{
		"CREATE TABLE", "INSERT INTO", "DROP TABLE", "ALTER TABLE", "SET ", "-- ", "/*",
	} {
		if strings.HasPrefix(upper, kw) {
			return FormatSQL
		}
	}
	return FormatCSV
}

// SniffDelimiter guesses the delimiter from the first non-empty line.
func SniffDelimiter(head string) rune {
	line := ""
	for _, l := range strings.Split(head, "\n") {
		if strings.TrimSpace(l) != "" {
			line = l
			break
		}
	}
	best, bestCount := ',', 0
	for _, cand := range []rune{',', '\t', ';', '|'} {
		if n := strings.Count(line, string(cand)); n > bestCount {
			best, bestCount = cand, n
		}
	}
	return best
}

// LooksUTF8 reports whether bytes are valid UTF-8, tolerating a sequence cut
// off at the end of the sample.
//
// This picks the default encoding, and the tolerance matters: a 2 MB sample of a
// Thai UTF-8 file will usually end mid-character, and calling that "not UTF-8"
// would default the import to CP874 and mangle every Thai column.
func LooksUTF8(b []byte) bool {
	for len(b) > 0 {
		r, size := utf8.DecodeRune(b)
		if r == utf8.RuneError && size <= 1 {
			// Could be a genuine error, or a truncated final sequence.
			return isTruncatedTail(b)
		}
		b = b[size:]
	}
	return true
}

// isTruncatedTail reports whether the remaining bytes are the start of a valid
// multi-byte sequence that the sample simply cut short.
func isTruncatedTail(b []byte) bool {
	if len(b) == 0 || len(b) > 3 {
		return false
	}
	lead := b[0]
	var want int
	switch {
	case lead&0xE0 == 0xC0:
		want = 2
	case lead&0xF0 == 0xE0:
		want = 3
	case lead&0xF8 == 0xF0:
		want = 4
	default:
		return false
	}
	if len(b) >= want {
		return false
	}
	for _, c := range b[1:] {
		if c&0xC0 != 0x80 {
			return false
		}
	}
	return true
}

// DecodeBytes converts source bytes to UTF-8.
func DecodeBytes(b []byte, encoding SourceEncoding) string {
	decoder := decoderFor(encoding)
	if decoder == nil {
		return string(b)
	}
	out, _, err := transform.Bytes(decoder, b)
	if err != nil {
		// A byte the table cannot map is replaced rather than failing the whole
		// preview; the user needs to SEE the mojibake to pick another encoding.
		return string(b)
	}
	return string(out)
}

func decoderFor(encoding SourceEncoding) transform.Transformer {
	switch encoding {
	case EncodingTIS620:
		// Windows-874 is the superset of TIS-620 that Excel actually writes.
		return charmap.Windows874.NewDecoder()
	case EncodingWindows1252:
		return charmap.Windows1252.NewDecoder()
	default:
		return nil
	}
}

// transformReader applies a character-set decoder to a stream.
func transformReader(r io.Reader, t transform.Transformer) io.Reader {
	return transform.NewReader(r, t)
}
