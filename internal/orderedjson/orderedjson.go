// Package orderedjson provides a JSON object that remembers insertion order.
//
// The Rust build enables serde_json's "preserve_order" feature, so every result
// row reaches the frontend with its columns in SELECT order. Go's map is
// deliberately unordered and encoding/json sorts keys alphabetically, so a
// straight port would silently reshuffle every DataGrid column -- and a query
// like `SELECT name, id` would render as `id, name`.
//
// It is also what keeps a JSON document's own key order intact on the import
// path, where re-sorting the keys of a record being loaded would be worse than
// cosmetic.
package orderedjson

import (
	"bytes"
	"encoding/json"
	"fmt"
)

// Object is a JSON object preserving insertion order.
//
// A key set twice keeps its original position and takes the new value, which
// matches serde_json::Map's behaviour.
type Object struct {
	keys   []string
	values map[string]any
}

// NewObject returns an empty object, optionally pre-sized.
func NewObject(capacity int) *Object {
	return &Object{
		keys:   make([]string, 0, capacity),
		values: make(map[string]any, capacity),
	}
}

// Set inserts or replaces a key, preserving the position of an existing one.
func (o *Object) Set(key string, value any) {
	if _, exists := o.values[key]; !exists {
		o.keys = append(o.keys, key)
	}
	o.values[key] = value
}

// Get reports the value for a key.
func (o *Object) Get(key string) (any, bool) {
	v, ok := o.values[key]
	return v, ok
}

// Has reports whether the key is present. Used by the duplicate-label rule.
func (o *Object) Has(key string) bool {
	_, ok := o.values[key]
	return ok
}

// Keys returns the keys in insertion order.
func (o *Object) Keys() []string { return o.keys }

// Len reports the number of keys.
func (o *Object) Len() int { return len(o.keys) }

// MarshalJSON writes the object in insertion order.
func (o *Object) MarshalJSON() ([]byte, error) {
	if o == nil {
		return []byte("null"), nil
	}
	var buf bytes.Buffer
	buf.WriteByte('{')
	for i, k := range o.keys {
		if i > 0 {
			buf.WriteByte(',')
		}
		// Keys go through the encoder so escaping matches encoding/json.
		kb, err := marshalValue(k)
		if err != nil {
			return nil, err
		}
		buf.Write(kb)
		buf.WriteByte(':')
		vb, err := marshalValue(o.values[k])
		if err != nil {
			return nil, fmt.Errorf("orderedjson: key %q: %w", k, err)
		}
		buf.Write(vb)
	}
	buf.WriteByte('}')
	return buf.Bytes(), nil
}

// UnmarshalJSON reads an object, recording key order as it appears in the input.
func (o *Object) UnmarshalJSON(data []byte) error {
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.UseNumber()

	tok, err := dec.Token()
	if err != nil {
		return err
	}
	if tok == nil {
		*o = Object{}
		return nil
	}
	if d, ok := tok.(json.Delim); !ok || d != '{' {
		return fmt.Errorf("orderedjson: expected an object, got %v", tok)
	}

	o.keys = nil
	o.values = map[string]any{}
	for dec.More() {
		keyTok, err := dec.Token()
		if err != nil {
			return err
		}
		key, ok := keyTok.(string)
		if !ok {
			return fmt.Errorf("orderedjson: expected a string key, got %v", keyTok)
		}
		var raw json.RawMessage
		if err := dec.Decode(&raw); err != nil {
			return err
		}
		value, err := decodeValue(raw)
		if err != nil {
			return err
		}
		o.Set(key, value)
	}
	// consume the closing brace
	if _, err := dec.Token(); err != nil {
		return err
	}
	return nil
}

// marshalValue encodes one value with HTML escaping off, matching serde.
func marshalValue(v any) ([]byte, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		return nil, err
	}
	return bytes.TrimSuffix(buf.Bytes(), []byte("\n")), nil
}

// decodeValue turns raw JSON into Go values, keeping objects ordered and
// numbers as their original text so a large integer or a high-precision decimal
// is not rounded through float64.
func decodeValue(raw json.RawMessage) (any, error) {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 {
		return nil, nil
	}
	switch trimmed[0] {
	case '{':
		child := NewObject(0)
		if err := child.UnmarshalJSON(trimmed); err != nil {
			return nil, err
		}
		return child, nil
	case '[':
		var items []json.RawMessage
		if err := json.Unmarshal(trimmed, &items); err != nil {
			return nil, err
		}
		out := make([]any, 0, len(items))
		for _, item := range items {
			v, err := decodeValue(item)
			if err != nil {
				return nil, err
			}
			out = append(out, v)
		}
		return out, nil
	default:
		dec := json.NewDecoder(bytes.NewReader(trimmed))
		dec.UseNumber()
		var v any
		if err := dec.Decode(&v); err != nil {
			return nil, err
		}
		return v, nil
	}
}

// Marshal encodes any value with serde-compatible escaping (no HTML escaping).
func Marshal(v any) ([]byte, error) { return marshalValue(v) }

// RawObject parses a JSON document into an ordered value, for passing a json/jsonb
// column through untouched while keeping the server's key order.
func RawObject(data []byte) (any, error) { return decodeValue(json.RawMessage(data)) }
