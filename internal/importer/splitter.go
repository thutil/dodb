package importer

import (
	"bytes"
	"strings"

	"github.com/thutil/dodb/internal/model"
)

// scanState is where the splitter is inside the script.
type scanState int

const (
	stateNormal scanState = iota
	stateLineComment
	// stateBlockComment covers /* ... */. The gated flag marks a mysqldump
	// /*!40101 ... */ block, which is skipped rather than executed: it is
	// version-conditional server configuration, not part of the data.
	stateBlockComment
	stateSingle
	stateDouble
	stateBacktick
	// stateDollar is inside $tag$ ... $tag$; the closing tag is held in dollarTag.
	stateDollar
)

// SplitStatement is one statement and where it started.
type SplitStatement struct {
	SQL string
	// Line is the 1-based line of the statement's first NON-COMMENT character,
	// so an error points at the SQL rather than at the licence header above it.
	Line uint64
}

// SqlSplitter splits a SQL script into statements, one chunk at a time.
//
// The frontend has its own splitter in ui/src/utils/sqlUtils.ts, but it needs
// the whole script in memory and recomputes line numbers in O(n^2), so a
// multi-hundred-megabyte dump has to be split here. Feeding is incremental:
// state and scan position survive between Feed calls, so a statement straddling
// two chunk boundaries is still reassembled correctly.
type SqlSplitter struct {
	pending    []byte
	scanPos    int
	stmtStart  int
	stmtLine   uint64
	curLine    uint64
	state      scanState
	gated      bool
	dollarTag  []byte
	delimiter  []byte
	hasContent bool
	// backslashEscapes follows the target dialect: MySQL/MariaDB treat \' as an
	// escaped quote, Postgres and SQLite do not, and guessing wrong swallows a
	// string terminator and merges two statements into one.
	backslashEscapes       bool
	skippedVersionComments uint64
	skippedMetaCommands    uint64
}

// NewSqlSplitter builds a splitter.
func NewSqlSplitter(backslashEscapes bool) *SqlSplitter {
	return &SqlSplitter{
		stmtLine:         1,
		curLine:          1,
		state:            stateNormal,
		delimiter:        []byte(";"),
		backslashEscapes: backslashEscapes,
	}
}

// SplitterForDialect builds a splitter configured for the target engine.
func SplitterForDialect(db model.SupportedDB) *SqlSplitter {
	return NewSqlSplitter(db == model.Mariadb)
}

// SkippedVersionComments counts mysqldump /*!...*/ blocks that were skipped.
func (s *SqlSplitter) SkippedVersionComments() uint64 { return s.skippedVersionComments }

// SkippedMetaCommands counts psql directives dropped because the server has no
// idea what they are.
func (s *SqlSplitter) SkippedMetaCommands() uint64 { return s.skippedMetaCommands }

// Feed adds a chunk and returns whatever statements completed.
func (s *SqlSplitter) Feed(chunk []byte) []SplitStatement {
	s.pending = append(s.pending, chunk...)
	return s.scan(false)
}

// Finish flushes what is left, including a final statement with no delimiter.
func (s *SqlSplitter) Finish() []SplitStatement {
	return s.scan(true)
}

func (s *SqlSplitter) scan(eof bool) []SplitStatement {
	b := s.pending
	n := len(b)

	var out []SplitStatement
	pos := s.scanPos
	state := s.state
	gated := s.gated
	dollarTag := s.dollarTag
	delimiter := s.delimiter
	curLine := s.curLine
	stmtStart := s.stmtStart
	stmtLine := s.stmtLine
	hasContent := s.hasContent

	// mark records where the statement's real content begins, so the reported
	// line skips the blank lines and comments in front of it.
	mark := func() {
		if !hasContent {
			hasContent = true
			stmtLine = curLine
		}
	}
	// syncStart drags the statement start forward past leading whitespace and
	// comments, which belong to no statement.
	syncStart := func() {
		if !hasContent {
			stmtStart = pos
		}
	}

scan:
	for pos < n {
		switch state {
		case stateNormal:
			// A psql meta-command (\restrict, \connect) is a client directive,
			// not SQL: pg_dump 17+ emits them and the server rejects them.
			if !hasContent && b[pos] == '\\' {
				nl := indexByteFrom(b, pos, '\n')
				switch {
				case nl >= 0:
					if isPsqlMetaCommand(string(b[pos:nl])) {
						s.skippedMetaCommands++
					}
					curLine++
					pos = nl + 1
					stmtStart = pos
					continue scan
				case eof:
					if isPsqlMetaCommand(string(b[pos:])) {
						s.skippedMetaCommands++
					}
					pos = n
					stmtStart = n
					continue scan
				default:
					break scan
				}
			}

			// DELIMITER ;; only means anything at a statement start.
			if !hasContent && startsWithDelimiterKeyword(b, pos) {
				nl := indexByteFrom(b, pos, '\n')
				switch {
				case nl >= 0:
					if d, ok := parseDelimiterLine(string(b[pos:nl])); ok {
						delimiter = []byte(d)
					}
					curLine++
					pos = nl + 1
					stmtStart = pos
					continue scan
				case eof:
					if d, ok := parseDelimiterLine(string(b[pos:])); ok {
						delimiter = []byte(d)
					}
					pos = n
					stmtStart = n
					continue scan
				default:
					break scan
				}
			}

			if bytes.HasPrefix(b[pos:], delimiter) {
				end := pos
				pos += len(delimiter)
				if hasContent {
					if sql := strings.TrimSpace(string(b[stmtStart:end])); sql != "" {
						out = append(out, SplitStatement{SQL: sql, Line: stmtLine})
					}
				}
				hasContent = false
				stmtStart = pos
				continue scan
			}
			// A multi-byte delimiter cut in half by the chunk boundary.
			if !eof && n-pos < len(delimiter) && bytes.HasPrefix(delimiter, b[pos:]) {
				break scan
			}

			switch b[pos] {
			case '\n':
				curLine++
				pos++
				syncStart()
			case ' ', '\t', '\r':
				pos++
				syncStart()
			case '-':
				if pos+1 >= n {
					if !eof {
						break scan
					}
					mark()
					pos++
				} else if b[pos+1] == '-' {
					state = stateLineComment
					pos += 2
				} else {
					mark()
					pos++
				}
			case '#':
				// Only a comment when it opens a token: Postgres uses #> as a
				// JSON path operator.
				if pos == 0 || isSpaceByte(b[pos-1]) {
					state = stateLineComment
					pos++
				} else {
					mark()
					pos++
				}
			case '/':
				if pos+1 >= n {
					if !eof {
						break scan
					}
					mark()
					pos++
				} else if b[pos+1] == '*' {
					if pos+3 >= n && !eof {
						break scan
					}
					// /*!...*/ is MySQL's conditional-execution comment and
					// /*M!...*/ MariaDB's. Both open every modern dump; running
					// them would apply the dump's server settings to this session.
					gated = (pos+2 < n && b[pos+2] == '!') ||
						(pos+3 < n && b[pos+2] == 'M' && b[pos+3] == '!')
					state = stateBlockComment
					pos += 2
				} else {
					mark()
					pos++
				}
			case '\'':
				mark()
				state = stateSingle
				pos++
			case '"':
				mark()
				state = stateDouble
				pos++
			case '`':
				mark()
				state = stateBacktick
				pos++
			case '$':
				end, kind := readDollarTag(b, pos, n)
				switch {
				case kind == dollarTagFound:
					mark()
					dollarTag = append(dollarTag[:0], b[pos:end]...)
					state = stateDollar
					pos = end
				case kind == dollarTagNeedMore && !eof:
					break scan
				default:
					// $1 is a placeholder, not a quote opener.
					mark()
					pos++
				}
			default:
				mark()
				pos++
			}

		case stateLineComment:
			if nl := indexByteFrom(b, pos, '\n'); nl >= 0 {
				curLine++
				pos = nl + 1
				state = stateNormal
				syncStart()
			} else {
				pos = n
				if eof {
					state = stateNormal
				}
				syncStart()
			}

		case stateBlockComment:
			if idx := indexPairFrom(b, pos, '*', '/'); idx >= 0 {
				curLine += countNewlines(b[pos:idx])
				if gated {
					s.skippedVersionComments++
				}
				pos = idx + 2
				state = stateNormal
				syncStart()
			} else {
				// Hold back a trailing '*' so a */ can span two chunks.
				stop := n
				if !eof && n > pos && b[n-1] == '*' {
					stop = n - 1
				}
				curLine += countNewlines(b[pos:stop])
				pos = stop
				if eof {
					state = stateNormal
				} else {
					break scan
				}
			}

		case stateSingle, stateDouble, stateBacktick:
			quote := byte('\'')
			backslash := s.backslashEscapes
			switch state {
			case stateDouble:
				quote, backslash = '"', false
			case stateBacktick:
				quote, backslash = '`', false
			}
			next, newlines, step := scanQuoted(b, n, pos, quote, backslash, eof)
			curLine += newlines
			pos = next
			switch step {
			case quotedClosed:
				state = stateNormal
			case quotedContinue:
				break scan
			}

		case stateDollar:
			if idx := indexSliceFrom(b, pos, dollarTag); idx >= 0 {
				curLine += countNewlines(b[pos:idx])
				pos = idx + len(dollarTag)
				state = stateNormal
			} else {
				// Keep back len(tag)-1 bytes so the closing tag can straddle chunks.
				stop := n
				if !eof {
					keep := len(dollarTag) - 1
					if keep < 0 {
						keep = 0
					}
					stop = n - keep
					if stop < pos {
						stop = pos
					}
				}
				curLine += countNewlines(b[pos:stop])
				pos = stop
				if eof {
					state = stateNormal
				} else {
					break scan
				}
			}
		}
	}

	if eof && hasContent && stmtStart < n {
		if sql := strings.TrimSpace(string(b[stmtStart:])); sql != "" {
			out = append(out, SplitStatement{SQL: sql, Line: stmtLine})
		}
		hasContent = false
		stmtStart = n
	}

	// Drop everything already turned into statements and keep the tail, so
	// memory does not grow with the size of the file.
	if stmtStart > 0 {
		s.pending = append(s.pending[:0], b[stmtStart:]...)
		pos -= stmtStart
		stmtStart = 0
	} else {
		s.pending = b
	}

	s.scanPos = pos
	s.state = state
	s.gated = gated
	s.dollarTag = dollarTag
	s.delimiter = delimiter
	s.curLine = curLine
	s.stmtStart = stmtStart
	s.stmtLine = stmtLine
	s.hasContent = hasContent

	return out
}

type quotedStep int

const (
	// quotedClosed means the quote ended; resume normal scanning.
	quotedClosed quotedStep = iota
	// quotedContinue means input ran out mid-decision; wait for more.
	quotedContinue
	// quotedAdvance means bytes were consumed and we are still inside the quote.
	quotedAdvance
)

// scanQuoted steps through a quoted run.
func scanQuoted(b []byte, n, from int, quote byte, backslash, eof bool) (int, uint64, quotedStep) {
	i := from
	var newlines uint64
	for i < n {
		c := b[i]
		if c == '\n' {
			newlines++
			i++
			continue
		}
		if backslash && c == '\\' {
			if i+1 >= n {
				if eof {
					return n, newlines, quotedAdvance
				}
				return i, newlines, quotedContinue
			}
			if b[i+1] == '\n' {
				newlines++
			}
			i += 2
			continue
		}
		if c == quote {
			if i+1 >= n {
				if eof {
					return n, newlines, quotedClosed
				}
				return i, newlines, quotedContinue
			}
			// A doubled quote is an escaped quote, not the end.
			if b[i+1] == quote {
				i += 2
				continue
			}
			return i + 1, newlines, quotedClosed
		}
		i++
	}
	return n, newlines, quotedAdvance
}

type dollarTagKind int

const (
	dollarTagFound dollarTagKind = iota
	dollarTagNeedMore
	dollarTagNone
)

// readDollarTag recognises a Postgres dollar-quote opener at pos.
func readDollarTag(b []byte, pos, n int) (int, dollarTagKind) {
	i := pos + 1
	for i < n {
		c := b[i]
		if c == '$' {
			return i + 1, dollarTagFound
		}
		first := i == pos+1
		ok := c == '_' || isAlphaByte(c) || (!first && c >= '0' && c <= '9')
		if !ok {
			return 0, dollarTagNone
		}
		i++
	}
	return 0, dollarTagNeedMore
}

// IsPsqlMetaCommand reports a psql client directive such as \restrict.
func isPsqlMetaCommand(line string) bool {
	t := strings.TrimLeft(line, " \t\r")
	if !strings.HasPrefix(t, `\`) || len(t) < 2 {
		return false
	}
	c := t[1]
	return isAlphaByte(c) || c == '.' || c == '?' || c == '!'
}

func startsWithDelimiterKeyword(b []byte, pos int) bool {
	const kw = "delimiter"
	if pos+len(kw) >= len(b) {
		return false
	}
	for i := 0; i < len(kw); i++ {
		if lowerByte(b[pos+i]) != kw[i] {
			return false
		}
	}
	return isSpaceByte(b[pos+len(kw)])
}

func parseDelimiterLine(line string) (string, bool) {
	t := strings.TrimSpace(line)
	if len(t) < 9 {
		return "", false
	}
	rest := strings.TrimSpace(t[9:])
	if rest == "" {
		return "", false
	}
	return rest, true
}

func indexByteFrom(b []byte, from int, needle byte) int {
	if from >= len(b) {
		return -1
	}
	if i := bytes.IndexByte(b[from:], needle); i >= 0 {
		return i + from
	}
	return -1
}

func indexPairFrom(b []byte, from int, a, c byte) int {
	if from+1 >= len(b) {
		return -1
	}
	for i := from; i < len(b)-1; i++ {
		if b[i] == a && b[i+1] == c {
			return i
		}
	}
	return -1
}

func indexSliceFrom(b []byte, from int, needle []byte) int {
	if len(needle) == 0 || len(b) < len(needle) || from > len(b)-len(needle) {
		return -1
	}
	if i := bytes.Index(b[from:], needle); i >= 0 {
		return i + from
	}
	return -1
}

func countNewlines(b []byte) uint64 {
	return uint64(bytes.Count(b, []byte{'\n'}))
}

func isSpaceByte(c byte) bool {
	return c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '\v' || c == '\f'
}

func isAlphaByte(c byte) bool {
	return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')
}

func lowerByte(c byte) byte {
	if c >= 'A' && c <= 'Z' {
		return c + 32
	}
	return c
}

// SplitSQL splits a whole script at once, for previews and tests.
func SplitSQL(script string, backslashEscapes bool) []SplitStatement {
	s := NewSqlSplitter(backslashEscapes)
	out := s.Feed([]byte(script))
	return append(out, s.Finish()...)
}
