package importer

import (
	"bufio"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf8"

	"github.com/thutil/dodb/internal/dialect"
	"github.com/thutil/dodb/internal/model"
)

// sqlSource replays a .sql script, handling pg_dump's COPY blocks.
type sqlSource struct {
	file      *os.File
	reader    *bufio.Reader
	total     uint64
	bytesRead uint64
	db        model.SupportedDB
	batchSize int

	splitter *SqlSplitter
	queued   []SplitStatement
	eof      bool
	index    uint64

	// copy is non-nil while consuming a COPY ... FROM stdin data block.
	copy *copyState
	// discardCopy swallows a COPY block that was refused, so the user gets one
	// error instead of a syntax error per data line.
	discardCopy bool

	failures []Failure
	tables   map[string]bool
	stats    SourceStats
	// line counts physical lines, for the UTF-8 error message.
	line uint64
	// name is the file's base name, so the error names the file the user picked
	// rather than an absolute path.
	name string
}

type copyState struct {
	header  CopyHeader
	pending [][]*string
}

func newSQLSource(db model.SupportedDB, req Request) (*sqlSource, error) {
	file, err := os.Open(req.FilePath)
	if err != nil {
		return nil, fmt.Errorf("could not open %s: %w", req.FilePath, err)
	}
	info, err := file.Stat()
	if err != nil {
		_ = file.Close()
		return nil, err
	}
	return &sqlSource{
		name:      filepath.Base(req.FilePath),
		file:      file,
		reader:    bufio.NewReaderSize(decodedReader(file, req.CSV.Encoding), 256*1024),
		total:     uint64(info.Size()),
		db:        db,
		batchSize: req.BatchSize,
		splitter:  SplitterForDialect(db),
		tables:    map[string]bool{},
	}, nil
}

func (s *sqlSource) BytesRead() uint64  { return s.bytesRead }
func (s *sqlSource) TotalBytes() uint64 { return s.total }
func (s *sqlSource) Close() error       { return s.file.Close() }

func (s *sqlSource) TakeFailures() []Failure {
	out := s.failures
	s.failures = nil
	return out
}

func (s *sqlSource) TablesTouched() []string {
	out := make([]string, 0, len(s.tables))
	for t := range s.tables {
		out = append(out, t)
	}
	return out
}

func (s *sqlSource) Stats() SourceStats {
	s.stats.SkippedVersionComments = s.splitter.SkippedVersionComments()
	s.stats.SkippedMetaCommands = s.splitter.SkippedMetaCommands()
	return s.stats
}

// NextBatch returns up to batchSize statements from the script.
//
// The script is pumped into the splitter ONE LINE AT A TIME, and the queue is
// drained before another line is read. That is not a style choice: a COPY block
// puts its rows in the file as tab-separated text AFTER the statement, so a
// splitter fed 64 KB chunks would already have swallowed those data lines as SQL
// by the time the COPY header surfaced -- which is exactly the bug this shape
// avoids.
func (s *sqlSource) NextBatch() ([]BatchItem, error) {
	var out []BatchItem

	for len(out) < s.batchSize {
		// Inside a COPY block the lines are data, not SQL.
		if s.copy != nil || s.discardCopy {
			items, err := s.pumpCopy()
			if err != nil {
				return nil, err
			}
			out = append(out, items...)
			continue
		}

		if len(s.queued) > 0 {
			stmt := s.queued[0]
			s.queued = s.queued[1:]

			header, err := ParseCopyHeader(stmt.SQL)
			if err != nil {
				// A COPY this reader cannot decode: report once, then swallow
				// its data lines so the user gets one error instead of a syntax
				// error per row.
				line := stmt.Line
				s.failures = append(s.failures, NewFailure(s.index+1, &line, stmt.SQL, err.Error()))
				s.discardCopy = true
				continue
			}
			if header != nil {
				s.copy = &copyState{header: *header}
				s.tables[header.Table] = true
				continue
			}

			s.index++
			line := stmt.Line
			out = append(out, BatchItem{SQL: stmt.SQL, Rows: 1, Line: &line, Index: s.index})
			if t := tableFromStatement(stmt.SQL); t != "" {
				s.tables[t] = true
			}
			continue
		}

		if s.eof {
			break
		}
		line, err := s.readLine()
		if err != nil {
			return nil, err
		}
		if line == nil {
			s.queued = append(s.queued, s.splitter.Finish()...)
			continue
		}
		s.queued = append(s.queued, s.splitter.Feed([]byte(*line+"\n"))...)
	}

	if len(out) == 0 {
		return nil, nil
	}
	return out, nil
}

// pumpCopy consumes COPY data lines, emitting an INSERT when a batch fills or
// the block ends.
func (s *sqlSource) pumpCopy() ([]BatchItem, error) {
	for {
		line, err := s.readLine()
		if err != nil {
			return nil, err
		}
		if line == nil {
			// The file ended inside a COPY block; flush what there is rather
			// than discarding rows the dump did contain.
			items := s.flushCopy()
			s.copy, s.discardCopy = nil, false
			return items, nil
		}
		if IsCopyTerminator(*line) {
			items := s.flushCopy()
			s.copy, s.discardCopy = nil, false
			return items, nil
		}
		if s.discardCopy {
			continue
		}
		if strings.TrimSpace(*line) == "" {
			continue
		}

		s.copy.pending = append(s.copy.pending, SplitCopyRow(*line))
		if len(s.copy.pending) >= s.batchSize {
			return s.flushCopy(), nil
		}
	}
}

// flushCopy turns buffered COPY rows into one INSERT.
//
// Every value is written as a string literal and the server coerces it: the
// text format carries no type information, and guessing would get a date or a
// numeric wrong far more often than the server does.
func (s *sqlSource) flushCopy() []BatchItem {
	if s.copy == nil || len(s.copy.pending) == 0 {
		return nil
	}
	rows := s.copy.pending
	s.copy.pending = nil

	columns := s.copy.header.Columns
	width := len(columns)
	if width == 0 {
		// A COPY that named no columns: infer the width from the data and let
		// the server match them positionally.
		for _, r := range rows {
			if len(r) > width {
				width = len(r)
			}
		}
	}

	literals := make([][]string, 0, len(rows))
	for _, r := range rows {
		row := make([]string, 0, width)
		for i := 0; i < width; i++ {
			if i >= len(r) || r[i] == nil {
				row = append(row, "NULL")
				continue
			}
			row = append(row, "'"+dialect.EscapeLiteral(s.db, *r[i])+"'")
		}
		literals = append(literals, row)
	}

	table := dialect.QuoteTable(s.db, s.copy.header.Table)
	var sql strings.Builder
	sql.WriteString("INSERT INTO " + table)
	if len(columns) > 0 {
		quoted := make([]string, 0, len(columns))
		for _, c := range columns {
			quoted = append(quoted, dialect.QuoteColumn(s.db, c))
		}
		sql.WriteString(" (" + strings.Join(quoted, ", ") + ")")
	}
	tuples := make([]string, 0, len(literals))
	for _, r := range literals {
		tuples = append(tuples, "("+strings.Join(r, ", ")+")")
	}
	sql.WriteString(" VALUES\n  " + strings.Join(tuples, ",\n  "))

	s.index++
	s.stats.CopyRows += uint64(len(rows))
	return []BatchItem{{SQL: sql.String(), Rows: uint64(len(rows)), Index: s.index}}
}

// readLine reads one line, tracking progress. Returns nil at end of file.
//
// A line that is not valid UTF-8 stops the import rather than being repaired.
// \n is ASCII, so a line read this way always holds whole characters: invalid
// UTF-8 here means the file genuinely carries raw bytes. Replacing them with
// U+FFFD would corrupt the data silently -- a mysqldump written without
// --hex-blob stores BLOB columns as raw bytes, and those cannot be sent as a
// query string at all. Writing something that merely looks like the original is
// the worst available outcome.
func (s *sqlSource) readLine() (*string, error) {
	line, err := s.reader.ReadString('\n')
	s.bytesRead += uint64(len(line))
	if err != nil && err != io.EOF {
		return nil, err
	}
	if err == io.EOF {
		s.eof = true
		if line == "" {
			return nil, nil
		}
	}
	s.line++

	if !utf8.ValidString(line) {
		return nil, fmt.Errorf(
			"Line %d of %s is not valid UTF-8, so this file carries raw binary data. "+
				"A mysqldump written without --hex-blob stores BLOB and BINARY columns as raw "+
				"bytes, which cannot be replayed as text without corrupting them. Re-export "+
				"with `mysqldump --hex-blob` and import that file instead.",
			s.line, s.name)
	}

	trimmed := strings.TrimRight(line, "\n")
	return &trimmed, nil
}

// tableFromStatement pulls the table name out of an INSERT so the report can
// list which tables an import touched. Best effort: a name it cannot find just
// means one fewer entry in that list.
func tableFromStatement(sql string) string {
	upper := strings.ToUpper(strings.TrimSpace(sql))
	for _, prefix := range []string{"INSERT INTO ", "INSERT IGNORE INTO ", "REPLACE INTO "} {
		if !strings.HasPrefix(upper, prefix) {
			continue
		}
		rest := strings.TrimSpace(sql[len(prefix):])
		end := strings.IndexAny(rest, " (\n\t")
		if end < 0 {
			end = len(rest)
		}
		return stripIdent(strings.Trim(rest[:end], "`\""))
	}
	return ""
}
