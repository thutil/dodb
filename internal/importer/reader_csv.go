package importer

import (
	"bufio"
	"fmt"
	"io"
	"strings"
)

// SourceRow is one record read from a tabular file.
type SourceRow struct {
	// Fields are nil for a cell the reader saw as absent, distinct from a
	// present-but-empty cell.
	Fields []*string
	// Line is the 1-based line the record started on.
	Line uint64
	// Extra counts fields beyond the header's width. Counted rather than
	// silently dropped: extra fields almost always mean the delimiter is wrong,
	// and truncating the row would hide that behind plausible-looking data.
	Extra int
}

// RowReader streams records from a tabular or JSON source.
type RowReader interface {
	// Next returns the next row, or nil at end of input.
	Next() (*SourceRow, error)
	// Header is the column names, once known.
	Header() []string
	// BytesRead is progress through the file.
	BytesRead() uint64
}

// csvReader is a delimiter-separated reader.
//
// Not encoding/csv: that package hardcodes the double quote, and CsvOptions
// exposes a configurable quote character because single-quoted exports are real.
// It also cannot report extra fields, which is how a wrong delimiter is caught.
type csvReader struct {
	scanner   *bufio.Scanner
	delimiter byte
	quote     byte
	header    []string
	pending   *SourceRow
	line      uint64
	bytes     uint64
}

// newCSVReader reads the header (or synthesises one) and leaves the first data
// row queued.
func newCSVReader(r io.Reader, opts CsvOptions) (*csvReader, error) {
	scanner := bufio.NewScanner(r)
	// A single CSV field can be large; the default 64 KB token limit is not
	// enough for a row holding an embedded document.
	scanner.Buffer(make([]byte, 0, 256*1024), 16*1024*1024)

	c := &csvReader{
		scanner:   scanner,
		delimiter: opts.DelimiterByte(),
		quote:     opts.QuoteByte(),
	}

	first, err := c.readRecord()
	if err != nil {
		return nil, err
	}
	if first == nil {
		return c, nil
	}

	if opts.HasHeader {
		names := make([]string, 0, len(first.Fields))
		for i, f := range first.Fields {
			if f == nil || strings.TrimSpace(*f) == "" {
				names = append(names, fmt.Sprintf("column_%d", i+1))
				continue
			}
			names = append(names, *f)
		}
		c.header = SanitizeHeader(names)
	} else {
		// No header: name the columns positionally and keep the first record as
		// data, which is why it is peeked into `pending` rather than consumed.
		names := make([]string, len(first.Fields))
		for i := range names {
			names[i] = fmt.Sprintf("column_%d", i+1)
		}
		c.header = names
		c.pending = first
	}
	return c, nil
}

func (c *csvReader) Header() []string  { return c.header }
func (c *csvReader) BytesRead() uint64 { return c.bytes }

func (c *csvReader) Next() (*SourceRow, error) {
	if c.pending != nil {
		row := c.pending
		c.pending = nil
		return c.widen(row), nil
	}
	row, err := c.readRecord()
	if err != nil || row == nil {
		return nil, err
	}
	return c.widen(row), nil
}

// widen pads a short row to the header's width and records how many fields
// overflowed it.
func (c *csvReader) widen(row *SourceRow) *SourceRow {
	want := len(c.header)
	if want == 0 {
		return row
	}
	if len(row.Fields) > want {
		row.Extra = len(row.Fields) - want
		row.Fields = row.Fields[:want]
		return row
	}
	for len(row.Fields) < want {
		// A missing trailing cell is absent, not empty: an integer column would
		// reject '' but accepts NULL.
		row.Fields = append(row.Fields, nil)
	}
	return row
}

// readRecord reads one logical record, joining physical lines when a quoted
// field spans them.
func (c *csvReader) readRecord() (*SourceRow, error) {
	var (
		buf     strings.Builder
		started bool
		startAt uint64
	)

	for {
		if !c.scanner.Scan() {
			if err := c.scanner.Err(); err != nil {
				return nil, err
			}
			if !started {
				return nil, nil
			}
			// Input ended inside a quoted field; parse what there is rather than
			// discarding the last record.
			return c.parse(buf.String(), startAt), nil
		}

		text := c.scanner.Text()
		c.line++
		c.bytes += uint64(len(text)) + 1
		if !started {
			// Skip blank lines between records.
			if strings.TrimSpace(text) == "" {
				continue
			}
			started = true
			startAt = c.line
		} else {
			buf.WriteByte('\n')
		}
		buf.WriteString(text)

		if !c.insideQuotes(buf.String()) {
			return c.parse(buf.String(), startAt), nil
		}
	}
}

// insideQuotes reports whether the accumulated text ends inside a quoted field,
// which means the record continues on the next physical line.
func (c *csvReader) insideQuotes(s string) bool {
	inQuotes := false
	for i := 0; i < len(s); i++ {
		if s[i] != c.quote {
			continue
		}
		if inQuotes && i+1 < len(s) && s[i+1] == c.quote {
			// A doubled quote is an escaped quote, not a delimiter.
			i++
			continue
		}
		inQuotes = !inQuotes
	}
	return inQuotes
}

// parse splits one record into fields.
func (c *csvReader) parse(record string, line uint64) *SourceRow {
	var (
		fields   []*string
		cur      strings.Builder
		inQuotes bool
		quoted   bool
	)

	flush := func() {
		text := cur.String()
		cur.Reset()
		if !quoted && text == "" {
			// An unquoted empty cell is absent; `""` is a present empty string.
			fields = append(fields, nil)
		} else {
			v := text
			fields = append(fields, &v)
		}
		quoted = false
	}

	for i := 0; i < len(record); i++ {
		ch := record[i]
		switch {
		case inQuotes && ch == c.quote:
			if i+1 < len(record) && record[i+1] == c.quote {
				cur.WriteByte(c.quote)
				i++
				continue
			}
			inQuotes = false
		case !inQuotes && ch == c.quote:
			inQuotes, quoted = true, true
		case !inQuotes && ch == c.delimiter:
			flush()
		default:
			cur.WriteByte(ch)
		}
	}
	flush()

	return &SourceRow{Fields: fields, Line: line}
}
