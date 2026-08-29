package api

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/thutil/dodb/internal/dbcore"
	"github.com/thutil/dodb/internal/importer"
)

// Preview sampling limits, matching import_cmd.rs.
const (
	previewBytes      = 2 << 20 // 2 MB
	previewRows       = 200
	previewStatements = 50
)

// importState guards the single-run slot and carries the cancel signal.
//
// One import at a time on purpose: two concurrent runs against the same table
// would interleave their batches, and the progress stream has nowhere to say
// which run a tick belongs to.
type importState struct {
	mu      sync.Mutex
	running bool
	cancel  context.CancelFunc
}

// begin claims the slot, returning a context the caller must use.
func (s *importState) begin(parent context.Context) (context.Context, func(), error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.running {
		return nil, nil, fmt.Errorf("An import is already running. Wait for it to finish or cancel it first.")
	}
	ctx, cancel := context.WithCancel(parent)
	s.running = true
	s.cancel = cancel

	// The release closure frees the slot even when the caller returns early,
	// which is what the Rust RunGuard's Drop does.
	release := func() {
		s.mu.Lock()
		defer s.mu.Unlock()
		s.running = false
		s.cancel = nil
		cancel()
	}
	return ctx, release, nil
}

// requestCancel signals a running import to stop.
func (s *importState) requestCancel() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.cancel != nil {
		s.cancel()
	}
}

// PickImportFile opens a picker and describes what was chosen.
func (s *Service) PickImportFile() (*importer.FileInfo, error) {
	if s.dialogs == nil {
		return nil, ErrNoDialogs
	}
	path, err := s.dialogs.OpenFile("Select a file to import", []FileFilter{
		{DisplayName: "Importable", Pattern: "*.sql;*.csv;*.tsv;*.json;*.jsonl;*.ndjson"},
	})
	if err != nil {
		return nil, err
	}
	if path == "" {
		return nil, nil
	}
	info, err := s.DescribeImportFile(path)
	if err != nil {
		return nil, err
	}
	return &info, nil
}

// DescribeImportFile reports a file's size, detected format and delimiter.
func (s *Service) DescribeImportFile(path string) (importer.FileInfo, error) {
	stat, err := os.Stat(path)
	if err != nil {
		return importer.FileInfo{}, fmt.Errorf("could not read %s: %w", path, err)
	}
	head, err := readHead(path, 64*1024)
	if err != nil {
		return importer.FileInfo{}, err
	}

	format := importer.DetectFormat(path, string(head))
	return importer.FileInfo{
		Path:      path,
		Name:      filepath.Base(path),
		Size:      uint64(stat.Size()),
		Format:    format,
		Delimiter: string(importer.SniffDelimiter(string(head))),
		LooksUTF8: importer.LooksUTF8(head),
	}, nil
}

// PreviewImportFile samples the file so the user can check the mapping before
// committing to a run.
func (s *Service) PreviewImportFile(path string, format importer.Format, csv importer.CsvOptions) (importer.Preview, error) {
	stat, err := os.Stat(path)
	if err != nil {
		return importer.Preview{}, fmt.Errorf("could not read %s: %w", path, err)
	}
	preview := importer.Preview{
		Format:     format,
		TotalBytes: uint64(stat.Size()),
		Columns:    []importer.PreviewColumn{},
		Rows:       [][]*string{},
		Statements: []string{},
	}

	if format == importer.FormatSQL {
		head, err := readHead(path, previewBytes)
		if err != nil {
			return importer.Preview{}, err
		}
		text := importer.DecodeBytes(head, csv.Encoding)

		// Split with MySQL escaping on: it is the permissive reading, and a
		// preview only needs the statements to look right.
		stmts := importer.SplitSQL(text, true)
		for i, st := range stmts {
			if i >= previewStatements {
				break
			}
			preview.Statements = append(preview.Statements, st.SQL)
		}
		// Extrapolated from the sample rather than counted: counting means
		// reading the whole file, and this is only used to size a progress bar.
		if len(stmts) > 0 && len(head) > 0 {
			perByte := float64(len(stmts)) / float64(len(head))
			preview.EstimatedStatements = uint64(perByte * float64(stat.Size()))
		}
		preview.DialectHints = dialectHints(text)
		return preview, nil
	}

	rows, columns, err := importer.PreviewRows(path, format, csv, previewRows)
	if err != nil {
		return importer.Preview{}, err
	}
	preview.Columns = columns
	preview.Rows = rows
	return preview, nil
}

// CancelImport asks a running import to stop.
func (s *Service) CancelImport() error {
	s.imports.requestCancel()
	return nil
}

// RunImport drives a whole import, reporting progress through onProgress.
//
// onProgress may be nil. It is called from this goroutine, so the transport can
// write to its stream without extra synchronisation.
func (s *Service) RunImport(
	id, database string,
	req importer.Request,
	onProgress func(importer.Progress),
) (importer.Report, error) {
	started := time.Now()

	runCtx, release, err := s.imports.begin(context.Background())
	if err != nil {
		return importer.Report{}, err
	}
	defer release()

	profile, err := s.DB.ResolveProfile(id)
	if err != nil {
		return importer.Report{}, err
	}
	pool, err := s.DB.GetPool(runCtx, profile, database)
	if err != nil {
		return importer.Report{}, err
	}

	report, err := importer.Run(runCtx, pool, profile.Type, req, s.columnLookup(pool, database), onProgress)
	if err != nil {
		return importer.Report{}, err
	}
	report.ElapsedMs = uint64(time.Since(started).Milliseconds())

	// Column types may have changed if the run created a table.
	pool.InvalidateHints(database, "")
	return report, nil
}

// columnLookup lets the importer read a target table's real column types, so a
// mapping inferred from the file is corrected to what the table actually holds.
func (s *Service) columnLookup(pool *dbcore.Pool, database string) importer.ColumnLookup {
	return func(table string) ([]importer.TargetColumn, error) {
		rows, err := pool.Query(ctx(), columnsQuery(pool.Kind, table), nil)
		if err != nil {
			return nil, err
		}
		out := make([]importer.TargetColumn, 0, len(rows))
		for _, row := range rows {
			c := normaliseColumn(pool.Kind, row)
			out = append(out, importer.TargetColumn{
				Name:          c.Name,
				SQLType:       c.Type,
				PrimaryKey:    c.PrimaryKey,
				AutoIncrement: c.AutoIncrement,
			})
		}
		return out, nil
	}
}

// readHead reads at most n bytes from the start of a file.
func readHead(path string, n int) ([]byte, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("could not open %s: %w", path, err)
	}
	defer file.Close()

	buf := make([]byte, n)
	read, err := io.ReadFull(file, buf)
	if err != nil && err != io.EOF && err != io.ErrUnexpectedEOF {
		return nil, err
	}
	return buf[:read], nil
}

// dodbDialectRe matches the header DODB's own SQL export writes.
var dodbDialectRe = regexp.MustCompile(`(?im)^--\s*DODB-Dialect:\s*([A-Za-z0-9]+)\s*$`)

// dialectHints fingerprints a dump so the UI can warn about a mismatch before
// the user watches half a file fail.
func dialectHints(text string) []string {
	head := text
	if len(head) > 8192 {
		head = head[:8192]
	}
	// A dump DODB wrote says so outright; no need to guess.
	if m := dodbDialectRe.FindStringSubmatch(head); m != nil {
		return []string{strings.ToLower(m[1])}
	}

	upper := strings.ToUpper(head)
	var hints []string

	switch {
	case strings.Contains(head, "/*!") || strings.Contains(head, "/*M!"),
		strings.Contains(upper, "ENGINE=INNODB"),
		strings.Contains(upper, "AUTO_INCREMENT"):
		hints = append(hints, "mysql")
	}
	if strings.Contains(upper, "COPY ") && strings.Contains(upper, "FROM STDIN") ||
		strings.Contains(upper, "SET SEARCH_PATH") ||
		strings.Contains(head, "\\restrict") {
		hints = append(hints, "postgres")
	}
	if strings.Contains(upper, "PRAGMA ") || strings.Contains(upper, "AUTOINCREMENT") {
		hints = append(hints, "sqlite")
	}
	if hints == nil {
		hints = []string{}
	}
	return hints
}
