-- Postgres fixture: one row per decoding hazard identified in db_core.rs:461-540.
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TYPE mood AS ENUM ('sad', 'ok', 'happy');

CREATE TABLE hazards (
    id            serial PRIMARY KEY,
    -- must serialise as a STRING: routing through float64 silently rounds it
    exact_money   numeric(30,10),
    big_int       bigint,
    small_int     smallint,
    real_num      double precision,
    -- a real boolean, next to an int that must NOT decode as one
    is_true       boolean,
    int_not_bool  integer,
    -- RFC3339 with zone vs naive: two different output formats
    ts_zoned      timestamptz,
    ts_naive      timestamp,
    d             date,
    t             time,
    ident         uuid,
    doc           jsonb,
    tags          text[],
    nums          bigint[],
    raw           bytea,
    -- no Go driver decodes these; they must fall through to hex, as Rust does
    geom          geometry(Point, 4326),
    geog          geography(Point, 4326),
    feeling       mood,
    plain_text       text
);

INSERT INTO hazards (
    exact_money, big_int, small_int, real_num, is_true, int_not_bool,
    ts_zoned, ts_naive, d, t, ident, doc, tags, nums, raw, geom, geog, feeling, plain_text
) VALUES
(
    12345678901234.5678901234, 9223372036854775807, -32768, 0.1,
    true, 1,
    '2026-08-27 10:30:00+07', '2026-08-27 10:30:00', '2026-08-27', '10:30:00',
    '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
    '{"z":1,"a":{"nested":[1,2,3]},"m":"ก ไก่"}'::jsonb,
    ARRAY['ก','ข','ค'], ARRAY[1,2,3]::bigint[],
    '\x00ff10'::bytea,
    ST_SetSRID(ST_MakePoint(100.5018, 13.7563), 4326),
    ST_SetSRID(ST_MakePoint(100.5018, 13.7563), 4326)::geography,
    'happy', 'ทดสอบภาษาไทย'
),
(
    -0.0000000001, -9223372036854775808, 32767, -0.0,
    false, 0,
    '1970-01-01 00:00:00+00', '1970-01-01 00:00:00', '1970-01-01', '00:00:00',
    '00000000-0000-0000-0000-000000000000',
    '[]'::jsonb, ARRAY[]::text[], ARRAY[]::bigint[],
    ''::bytea,
    ST_SetSRID(ST_MakePoint(0, 0), 4326),
    ST_SetSRID(ST_MakePoint(0, 0), 4326)::geography,
    'sad', ''
),
(
    NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
);

-- FK topology for get_schema_diagram, including a composite FK
CREATE TABLE parent (
    a int, b int, label text,
    PRIMARY KEY (a, b)
);
CREATE TABLE child (
    id serial PRIMARY KEY,
    pa int, pb int,
    CONSTRAINT child_parent_fk FOREIGN KEY (pa, pb)
        REFERENCES parent (a, b) ON DELETE CASCADE ON UPDATE SET NULL
);
INSERT INTO parent VALUES (1, 1, 'first'), (2, 2, 'second');
INSERT INTO child (pa, pb) VALUES (1, 1), (2, 2);

-- NOTE: the unique_col_name case (a join exposing "id" and "label" twice) cannot
-- be a view -- Postgres rejects duplicate output column names at CREATE VIEW.
-- It lives in the golden query list as a raw SELECT instead.

-- a non-public schema, to exercise the qualification rule
CREATE SCHEMA extra;
CREATE TABLE extra.elsewhere (id int PRIMARY KEY, note text);
INSERT INTO extra.elsewhere VALUES (1, 'not in public');

-- Fractional seconds pin the timestamp formatting. chrono's to_rfc3339 prints
-- 0, 3, 6 or 9 decimal places depending on the value and writes "+00:00" for
-- UTC, where Go's time.RFC3339 writes "Z" and trims trailing zeros. Both
-- differences are silent, so they need a fixture.
CREATE TABLE ts_precision (
    id       int PRIMARY KEY,
    zoned    timestamptz,
    naive    timestamp,
    t_only   time
);
INSERT INTO ts_precision VALUES
    (1, '2026-08-27 10:30:00+07',            '2026-08-27 10:30:00',            '10:30:00'),
    (2, '2026-08-27 10:30:00.123+07',        '2026-08-27 10:30:00.123',        '10:30:00.123'),
    (3, '2026-08-27 10:30:00.123456+07',     '2026-08-27 10:30:00.123456',     '10:30:00.123456'),
    (4, '2026-08-27 10:30:00.000001+07',     '2026-08-27 10:30:00.000001',     '10:30:00.000001'),
    (5, '2026-08-27 10:30:00-05',            '2026-08-27 10:30:00',            '00:00:00');
