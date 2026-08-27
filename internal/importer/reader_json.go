package importer

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"strings"

	"github.com/thutil/dodb/internal/orderedjson"
)

// jsonReader streams records from a JSON source.
//
// Two shapes are accepted: one object per line (.jsonl/.ndjson) and a single
// top-level array. Unlike the Rust build, which had to parse a whole array into
// memory and refused anything over 256 MB, this streams array elements one at a
// time through json.Decoder -- so a 2 GB export loads, and progress is real
// rather than interpolated from the element index.
type jsonReader struct {
	dec     *json.Decoder
	inArray bool
	// header is the union of keys seen so far, in first-seen order. Callers that
	// need the full set must sniff first; see SniffJSONKeys.
	header    []string
	headerSet map[string]bool
	line      uint64
	scanner   *bufio.Scanner
	closed    bool
	// bytesFromLines tracks progress on the JSONL path, where there is no
	// decoder offset to read.
	bytesFromLines uint64
}

// newJSONReader decides between the two shapes by peeking at the first
// non-whitespace byte.
func newJSONReader(r io.Reader) (*jsonReader, error) {
	buffered := bufio.NewReaderSize(r, 256*1024)

	// Skip leading whitespace so the discriminating byte is the real first one.
	for {
		b, err := buffered.Peek(1)
		if err != nil {
			if err == io.EOF {
				return &jsonReader{closed: true, headerSet: map[string]bool{}}, nil
			}
			return nil, err
		}
		if b[0] == ' ' || b[0] == '\t' || b[0] == '\r' || b[0] == '\n' {
			_, _ = buffered.ReadByte()
			continue
		}
		break
	}

	head, err := buffered.Peek(1)
	if err != nil {
		return nil, err
	}

	j := &jsonReader{headerSet: map[string]bool{}}

	if head[0] == '[' {
		j.dec = json.NewDecoder(buffered)
		j.dec.UseNumber()
		// Consume the opening bracket so Decode reads elements, not the array.
		if _, err := j.dec.Token(); err != nil {
			return nil, fmt.Errorf("could not read the opening of the JSON array: %w", err)
		}
		j.inArray = true
		return j, nil
	}

	// JSONL: a scanner keeps each line's own boundaries, which makes the error
	// message able to name the offending line.
	j.scanner = bufio.NewScanner(buffered)
	j.scanner.Buffer(make([]byte, 0, 256*1024), 64*1024*1024)
	return j, nil
}

func (j *jsonReader) Header() []string { return j.header }

func (j *jsonReader) BytesRead() uint64 {
	if j.dec != nil {
		return uint64(j.dec.InputOffset())
	}
	return j.bytesFromLines
}

func (j *jsonReader) recordKeys(obj *orderedjson.Object) {
	for _, k := range obj.Keys() {
		if !j.headerSet[k] {
			j.headerSet[k] = true
			j.header = append(j.header, k)
		}
	}
}

// NextObject returns the next record as an ordered object.
func (j *jsonReader) NextObject() (*orderedjson.Object, uint64, error) {
	if j.closed {
		return nil, 0, nil
	}

	if j.inArray {
		if !j.dec.More() {
			j.closed = true
			return nil, 0, nil
		}
		var raw json.RawMessage
		if err := j.dec.Decode(&raw); err != nil {
			return nil, 0, fmt.Errorf("malformed JSON array element: %w", err)
		}
		j.line++
		obj, err := decodeObject(raw)
		if err != nil {
			return nil, j.line, err
		}
		j.recordKeys(obj)
		return obj, j.line, nil
	}

	for {
		if !j.scanner.Scan() {
			if err := j.scanner.Err(); err != nil {
				return nil, 0, err
			}
			j.closed = true
			return nil, 0, nil
		}
		text := j.scanner.Text()
		j.line++
		j.bytesFromLines += uint64(len(text)) + 1
		trimmed := strings.TrimSpace(text)
		if trimmed == "" {
			continue
		}
		// A JSONL file whose first line is "[" is really an array that was
		// pretty-printed; the bracket lines are skipped rather than failing.
		if trimmed == "[" || trimmed == "]" {
			continue
		}
		trimmed = strings.TrimSuffix(trimmed, ",")

		obj, err := decodeObject(json.RawMessage(trimmed))
		if err != nil {
			return nil, j.line, fmt.Errorf("line %d: %w", j.line, err)
		}
		j.recordKeys(obj)
		return obj, j.line, nil
	}
}

// decodeObject parses one record, keeping key order and numeric text intact.
//
// Both matter: Go maps have no order, so a straight unmarshal would reshuffle
// the columns of every imported row, and the default float64 would turn
// 12345678901234.5678 into something else on its way into a DECIMAL column.
func decodeObject(raw json.RawMessage) (*orderedjson.Object, error) {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || trimmed[0] != '{' {
		return nil, fmt.Errorf("expected a JSON object, got %s", Excerpt(string(trimmed), 60))
	}
	obj := orderedjson.NewObject(0)
	if err := obj.UnmarshalJSON(trimmed); err != nil {
		return nil, err
	}
	return obj, nil
}

// jsonValueToCell renders one JSON value as the text a SQL literal is built
// from, so a nested object reaches a JSON column as its own document rather
// than as Go's %v rendering of a map.
func jsonValueToCell(v any) *string {
	switch t := v.(type) {
	case nil:
		return nil
	case string:
		return &t
	case json.Number:
		s := t.String()
		return &s
	case bool:
		s := "false"
		if t {
			s = "true"
		}
		return &s
	default:
		encoded, err := orderedjson.Marshal(v)
		if err != nil {
			s := fmt.Sprint(v)
			return &s
		}
		s := string(encoded)
		return &s
	}
}
