package dbcore

import (
	"testing"
	"time"

	"github.com/thutil/dodb/internal/orderedjson"
)

// The expected strings here were read straight out of
// testdata/golden/queries.json, i.e. produced by chrono in the Rust build.
func TestTimestampFormattingMatchesChrono(t *testing.T) {
	utc := time.UTC
	cases := []struct {
		nanos               int
		rfc3339, naive, tim string
	}{
		{0, "2026-08-27T03:30:00+00:00", "2026-08-27 03:30:00", "03:30:00"},
		{123_000_000, "2026-08-27T03:30:00.123+00:00", "2026-08-27 03:30:00.123", "03:30:00.123"},
		{123_456_000, "2026-08-27T03:30:00.123456+00:00", "2026-08-27 03:30:00.123456", "03:30:00.123456"},
		{1_000, "2026-08-27T03:30:00.000001+00:00", "2026-08-27 03:30:00.000001", "03:30:00.000001"},
		{123_456_789, "2026-08-27T03:30:00.123456789+00:00", "2026-08-27 03:30:00.123456789", "03:30:00.123456789"},
	}
	for _, c := range cases {
		ts := time.Date(2026, 8, 27, 3, 30, 0, c.nanos, utc)
		if got := FormatRFC3339(ts); got != c.rfc3339 {
			t.Errorf("FormatRFC3339(%d ns) = %q, want %q", c.nanos, got, c.rfc3339)
		}
		if got := FormatNaiveDateTime(ts); got != c.naive {
			t.Errorf("FormatNaiveDateTime(%d ns) = %q, want %q", c.nanos, got, c.naive)
		}
		if got := FormatNaiveTime(ts); got != c.tim {
			t.Errorf("FormatNaiveTime(%d ns) = %q, want %q", c.nanos, got, c.tim)
		}
	}
}

// A non-UTC offset must render as the offset, not be normalised away.
func TestFormatRFC3339KeepsOffset(t *testing.T) {
	bangkok := time.FixedZone("+07", 7*3600)
	ts := time.Date(2026, 8, 27, 10, 30, 0, 0, bangkok)
	if got, want := FormatRFC3339(ts), "2026-08-27T10:30:00+07:00"; got != want {
		t.Errorf("got %q want %q", got, want)
	}
}

func TestDecodeBytesOrHex(t *testing.T) {
	cases := []struct {
		in   []byte
		want string
	}{
		{[]byte{0x00, 0xFF, 0x10}, "00FF10"}, // not valid UTF-8 -> hex
		{[]byte{}, ""},                       // empty stays empty
		{[]byte("hello"), "hello"},           // plain text passes through
		{[]byte("ทดสอบ"), "ทดสอบ"},           // multi-byte UTF-8 passes through
		{[]byte("a\tb\nc\rd"), "a\tb\nc\rd"}, // the three allowed controls
		{[]byte{'a', 0x00, 'b'}, "610062"},   // an embedded NUL forces hex
		{[]byte{'a', 0x07, 'b'}, "610762"},   // BEL is a control character
		{[]byte{0x01, 0x01, 0x00, 0x00, 0x20}, "0101000020"},
	}
	for _, c := range cases {
		if got := DecodeBytesOrHex(c.in); got != c.want {
			t.Errorf("DecodeBytesOrHex(%v) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestUniqueColName(t *testing.T) {
	row := orderedjson.NewObject(4)
	row.Set(UniqueColName(row, "id"), 1)
	row.Set(UniqueColName(row, "label"), "first")
	row.Set(UniqueColName(row, "id"), 2)
	row.Set(UniqueColName(row, "label"), 3)
	row.Set(UniqueColName(row, "id"), 4)

	want := []string{"id", "label", "id_1", "label_1", "id_2"}
	got := row.Keys()
	if len(got) != len(want) {
		t.Fatalf("got keys %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("got keys %v, want %v", got, want)
		}
	}
}
