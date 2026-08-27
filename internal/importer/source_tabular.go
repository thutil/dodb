package importer

import (
	"fmt"
	"io"
	"os"

	"github.com/thutil/dodb/internal/model"
)

// tabularSource turns CSV or JSON records into multi-row INSERTs.
type tabularSource struct {
	file    *os.File
	total   uint64
	db      model.SupportedDB
	table   string
	request Request

	csv  *csvReader
	json *jsonReader

	// columns are the target column names, in the order values are emitted.
	columns []string
	// mappings parallel columns and carry the coercion rule for each.
	mappings  []ColumnMapping
	pkColumns []string

	rowIndex  uint64
	batchIdx  uint64
	failures  []Failure
	exhausted bool
}

// newTabularSource opens the file and resolves the column mapping.
func newTabularSource(
	db model.SupportedDB,
	table string,
	req Request,
	mappings []ColumnMapping,
	pkColumns []string,
) (*tabularSource, error) {
	file, err := os.Open(req.FilePath)
	if err != nil {
		return nil, fmt.Errorf("could not open %s: %w", req.FilePath, err)
	}
	info, err := file.Stat()
	if err != nil {
		_ = file.Close()
		return nil, err
	}

	s := &tabularSource{
		file:      file,
		total:     uint64(info.Size()),
		db:        db,
		table:     table,
		request:   req,
		pkColumns: pkColumns,
	}

	// Only mapped columns take part; a mapping with no target is a column the
	// user chose to leave out of the INSERT entirely.
	for _, m := range mappings {
		if m.Target == nil || *m.Target == "" {
			continue
		}
		s.columns = append(s.columns, *m.Target)
		s.mappings = append(s.mappings, m)
	}
	if len(s.columns) == 0 {
		_ = file.Close()
		return nil, fmt.Errorf("No columns are mapped, so there is nothing to insert.")
	}

	reader := decodedReader(file, req.CSV.Encoding)

	switch req.Format {
	case FormatCSV:
		s.csv, err = newCSVReader(reader, req.CSV)
	case FormatJSON:
		s.json, err = newJSONReader(reader)
	default:
		err = fmt.Errorf("tabular source cannot read format %q", req.Format)
	}
	if err != nil {
		_ = file.Close()
		return nil, err
	}
	return s, nil
}

func (s *tabularSource) BytesRead() uint64 {
	switch {
	case s.csv != nil:
		return s.csv.BytesRead()
	case s.json != nil:
		return s.json.BytesRead()
	default:
		return 0
	}
}

func (s *tabularSource) TotalBytes() uint64      { return s.total }
func (s *tabularSource) TablesTouched() []string { return []string{s.table} }
func (s *tabularSource) Stats() SourceStats      { return SourceStats{} }
func (s *tabularSource) Close() error            { return s.file.Close() }

func (s *tabularSource) TakeFailures() []Failure {
	out := s.failures
	s.failures = nil
	return out
}

// NextBatch reads up to BatchSize records and emits one INSERT for them.
//
// A row whose values cannot be coerced is recorded as a failure and skipped
// rather than aborting: the point of importing 500,000 rows is not to lose all
// of them to one bad cell. An empty batch is returned (not nil) when every row
// in the window failed, so the caller keeps reading instead of treating it as
// end of file.
func (s *tabularSource) NextBatch() ([]BatchItem, error) {
	if s.exhausted {
		return nil, nil
	}

	rows := make([][]string, 0, s.request.BatchSize)
	read := 0

	for read < s.request.BatchSize {
		cells, line, ok, err := s.nextRecord()
		if err != nil {
			return nil, err
		}
		if !ok {
			s.exhausted = true
			break
		}
		read++
		s.rowIndex++

		literals, failure := s.coerce(cells, line)
		if failure != nil {
			s.failures = append(s.failures, *failure)
			continue
		}
		rows = append(rows, literals)
	}

	if len(rows) == 0 {
		if s.exhausted && read == 0 {
			return nil, nil
		}
		// Every row in this window failed. Returning an empty batch rather than
		// nil keeps the loop going.
		return []BatchItem{}, nil
	}

	sql, err := BuildInsertBatch(s.db, s.table, s.columns, rows, s.request.Conflict, s.pkColumns)
	if err != nil {
		return nil, err
	}
	s.batchIdx++
	return []BatchItem{{SQL: sql, Rows: uint64(len(rows)), Index: s.batchIdx}}, nil
}

// nextRecord pulls one record and lines its cells up with the mapped columns.
func (s *tabularSource) nextRecord() ([]*string, uint64, bool, error) {
	if s.csv != nil {
		row, err := s.csv.Next()
		if err != nil {
			return nil, 0, false, err
		}
		if row == nil {
			return nil, 0, false, nil
		}
		header := s.csv.Header()
		cells := make([]*string, len(s.mappings))
		for i, m := range s.mappings {
			if idx := indexOfFold(header, m.Source); idx >= 0 && idx < len(row.Fields) {
				cells[i] = row.Fields[idx]
			}
		}
		if row.Extra > 0 {
			// Counted, not swallowed: extra fields nearly always mean the
			// delimiter is wrong, and truncating the row would hide that.
			s.failures = append(s.failures, NewFailure(s.rowIndex+1, &row.Line, "",
				fmt.Sprintf("row has %d more fields than the header - check the delimiter", row.Extra)))
		}
		return cells, row.Line, true, nil
	}

	obj, line, err := s.json.NextObject()
	if err != nil {
		return nil, line, false, err
	}
	if obj == nil {
		return nil, 0, false, nil
	}
	cells := make([]*string, len(s.mappings))
	for i, m := range s.mappings {
		if v, ok := obj.Get(m.Source); ok {
			cells[i] = jsonValueToCell(v)
		}
	}
	return cells, line, true, nil
}

// coerce turns one record's cells into SQL literals.
func (s *tabularSource) coerce(cells []*string, line uint64) ([]string, *Failure) {
	literals := make([]string, len(s.mappings))
	for i, m := range s.mappings {
		lit, err := FormatValue(s.db, s.columns[i], m.ValueType, cells[i], s.request.CSV.NullLiteral)
		if err != nil {
			l := line
			f := NewFailure(s.rowIndex, &l, "", err.Error())
			return nil, &f
		}
		literals[i] = lit
	}
	return literals, nil
}

func indexOfFold(list []string, needle string) int {
	for i, item := range list {
		if item == needle {
			return i
		}
	}
	// Fall back to a case-insensitive match: a header sanitised to "user_id"
	// should still match a mapping that named "User_ID".
	for i, item := range list {
		if equalFold(item, needle) {
			return i
		}
	}
	return -1
}

func equalFold(a, b string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := 0; i < len(a); i++ {
		if lowerByte(a[i]) != lowerByte(b[i]) {
			return false
		}
	}
	return true
}

// decodedReader wraps a reader so non-UTF-8 sources arrive as UTF-8.
func decodedReader(r io.Reader, encoding SourceEncoding) io.Reader {
	if decoder := decoderFor(encoding); decoder != nil {
		return transformReader(r, decoder)
	}
	return r
}
