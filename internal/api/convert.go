package api

import (
	"encoding/json"
	"fmt"
	"strconv"
)

// asString renders a decoded JSON value as text, for reading catalog rows whose
// column types vary between servers.
func asString(v any) string {
	switch t := v.(type) {
	case nil:
		return ""
	case string:
		return t
	case json.Number:
		return t.String()
	case bool:
		return strconv.FormatBool(t)
	case int64:
		return strconv.FormatInt(t, 10)
	case uint64:
		return strconv.FormatUint(t, 10)
	case float64:
		return strconv.FormatFloat(t, 'g', -1, 64)
	default:
		return fmt.Sprint(v)
	}
}

// asBoolish reads a truth value however the server spelled it.
//
// The catalogs are inconsistent about this: Postgres returns a real boolean,
// SQLite's PRAGMA returns 0/1 as an integer, and a driver may hand either back
// as text. Accepting all three is what the Rust build does.
func asBoolish(v any) bool {
	switch t := v.(type) {
	case bool:
		return t
	case int64:
		return t != 0
	case uint64:
		return t != 0
	case float64:
		return t != 0
	case json.Number:
		n, err := t.Int64()
		return err == nil && n != 0
	case string:
		return t == "true" || t == "1" || t == "YES" || t == "t"
	default:
		return false
	}
}

// mustGet reads a column from a decoded row, returning nil when absent. Catalog
// queries alias their columns, so a missing key means the server shaped the
// result differently, not that the caller made a mistake.
func mustGet(row interface{ Get(string) (any, bool) }, key string) any {
	v, _ := row.Get(key)
	return v
}

// asSeq reads a 1-based sequence number, which servers report as an integer or
// as text depending on the catalog view.
func asSeq(v any) int64 {
	if n, err := strconv.ParseInt(asString(v), 10, 64); err == nil {
		return n
	}
	return 0
}
