package dbcore

import (
	"context"
	"fmt"
	"math/big"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/thutil/dodb/internal/orderedjson"
)

// Postgres type OIDs the decoder has to tell apart by hand.
//
// pgx returns a plain time.Time for timestamptz, timestamp and date alike, and
// each one is rendered differently by the Rust build, so the Go value is not
// enough to decide -- the OID is.
const (
	oidJSON        = 114
	oidJSONB       = 3802
	oidDate        = 1082
	oidTimestamp   = 1114
	oidTimestamptz = 1184
)

// pgxQuerier is the shared surface of *pgxpool.Pool, *pgx.Conn and pgx.Tx.
type pgxQuerier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

// queryPostgres decodes a Postgres result to match db_core.rs's Postgres branch.
//
// Unregistered OIDs need no special handling: pgx only asks for binary format
// for types it knows, so PostGIS geometry and geography arrive as text, and
// PostGIS's text form for those is uppercase hex EWKB -- byte for byte what the
// Rust build produced by hexing the binary form.
func queryPostgres(ctx context.Context, conn pgxQuerier, sql string) ([]*orderedjson.Object, error) {
	rows, err := conn.Query(ctx, sql)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	fields := rows.FieldDescriptions()
	out := make([]*orderedjson.Object, 0, 16)

	for rows.Next() {
		values, err := rows.Values()
		if err != nil {
			return nil, err
		}
		// Raw bytes for the same row, used only for json/jsonb: pgx decodes
		// those into a Go map, and a Go map has no key order to preserve.
		raw := rows.RawValues()

		row := orderedjson.NewObject(len(fields))
		for i, f := range fields {
			name := UniqueColName(row, f.Name)
			var rawField []byte
			if i < len(raw) {
				rawField = raw[i]
			}
			decoded, err := pgValueToJSON(f.DataTypeOID, values[i], rawField)
			if err != nil {
				return nil, fmt.Errorf("column %q: %w", f.Name, err)
			}
			row.Set(name, decoded)
		}
		out = append(out, row)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

// pgValueToJSON maps one pgx-decoded value to the JSON the frontend expects.
func pgValueToJSON(oid uint32, v any, raw []byte) (any, error) {
	if v == nil {
		return nil, nil
	}

	// OID-driven cases first, where the Go type alone is ambiguous.
	switch oid {
	case oidJSON, oidJSONB:
		// Decoded from the raw text so the server's key order survives. This
		// matters for `json` columns, which keep the order they were written
		// in; `jsonb` is normalised by Postgres and would survive either way.
		if len(raw) > 0 {
			parsed, err := orderedjson.RawObject(raw)
			if err == nil {
				return parsed, nil
			}
		}
		return v, nil
	case oidDate:
		if t, ok := v.(time.Time); ok {
			return FormatNaiveDate(t), nil
		}
	case oidTimestamp:
		if t, ok := v.(time.Time); ok {
			return FormatNaiveDateTime(t), nil
		}
	case oidTimestamptz:
		if t, ok := v.(time.Time); ok {
			// Normalised to UTC before formatting. The binary wire form of
			// timestamptz carries no zone at all -- it is microseconds since
			// 2000-01-01 UTC -- so pgx materialises it in time.Local, and the
			// rendered offset would otherwise follow whatever zone the machine
			// running dodb happens to be in. The Rust build pins the session to
			// TimeZone=UTC and always emits +00:00; same instant, stable text.
			return FormatRFC3339(t.UTC()), nil
		}
	}

	switch t := v.(type) {
	case string:
		return t, nil
	case bool:
		return t, nil
	case int16:
		return int64(t), nil
	case int32:
		return int64(t), nil
	case int64:
		return t, nil
	case uint32:
		return int64(t), nil
	case float32:
		return float64(t), nil
	case float64:
		return t, nil

	case pgtype.Numeric:
		// numeric reaches the frontend as a string: 30 significant digits do not
		// survive a float64, and a database client that quietly rounds a
		// monetary value is worse than one that refuses.
		return numericToString(t), nil

	case pgtype.Time:
		return FormatNaiveTime(time.Unix(0, t.Microseconds*1000).UTC()), nil

	case time.Time:
		return FormatRFC3339(t), nil

	case [16]byte:
		return formatUUID(t), nil

	case []byte:
		return DecodeBytesOrHex(t), nil

	case []any:
		// Postgres arrays. Elements are recursively mapped so an array of
		// numerics or timestamps is rendered like its scalar counterpart.
		out := make([]any, len(t))
		for i, item := range t {
			mapped, err := pgValueToJSON(0, item, nil)
			if err != nil {
				return nil, err
			}
			out[i] = mapped
		}
		return out, nil

	case map[string]any:
		return t, nil

	default:
		return fmt.Sprint(v), nil
	}
}

// numericToString renders a pgtype.Numeric as plain decimal, preserving the
// column's scale, which is what rust_decimal's and BigDecimal's to_string do.
// Never exponent notation: the frontend displays this text verbatim.
func numericToString(n pgtype.Numeric) string {
	if !n.Valid {
		return ""
	}
	switch n.InfinityModifier {
	case pgtype.Infinity:
		return "Infinity"
	case pgtype.NegativeInfinity:
		return "-Infinity"
	}
	if n.NaN {
		return "NaN"
	}
	if n.Int == nil {
		return "0"
	}

	digits := new(big.Int).Abs(n.Int).String()
	sign := ""
	if n.Int.Sign() < 0 {
		sign = "-"
	}

	switch {
	case n.Exp == 0:
		return sign + digits
	case n.Exp > 0:
		return sign + digits + strings.Repeat("0", int(n.Exp))
	default:
		scale := int(-n.Exp)
		if len(digits) <= scale {
			digits = strings.Repeat("0", scale-len(digits)+1) + digits
		}
		cut := len(digits) - scale
		return sign + digits[:cut] + "." + digits[cut:]
	}
}

func formatUUID(b [16]byte) string {
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}
