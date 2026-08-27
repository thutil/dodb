-- SQLite fixture: the hazards from db_core.rs:627-687.
--
-- SQLite has no static column types, only affinities, so the decode chain keys
-- off the DECLARED type name. That is why there is both a column declared
-- BOOLEAN (which must decode to true/false) and an INTEGER holding 0/1 (which
-- must stay numeric) -- see is_boolean_column.
CREATE TABLE hazards (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    exact_money   NUMERIC,
    big_int       BIGINT,
    real_num      REAL,
    is_true       BOOLEAN,
    int_not_bool  INTEGER,
    dt_naive      DATETIME,
    d             DATE,
    ident         TEXT,
    doc           TEXT,
    raw           BLOB,
    -- a WKB blob standing in for a SpatiaLite geometry: the point is that a
    -- driver-unknown binary value must come back as uppercase hex, not null
    geom          BLOB,
    plain_text       TEXT
);

INSERT INTO hazards (exact_money, big_int, real_num, is_true, int_not_bool,
                     dt_naive, d, ident, doc, raw, geom, plain_text) VALUES
(
    12345678901234.5678901234, 9223372036854775807, 0.1, 1, 1,
    '2026-08-27 10:30:00', '2026-08-27',
    '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
    '{"z":1,"a":{"nested":[1,2,3]},"m":"ก ไก่"}',
    x'00FF10',
    x'0101000020E6100000B4C876BE9F214059A8C64B3789412B40',
    'ทดสอบภาษาไทย'
),
(
    -0.0000000001, -9223372036854775808, -0.0, 0, 0,
    '1970-01-01 00:00:00', '1970-01-01',
    '00000000-0000-0000-0000-000000000000',
    '[]', x'', x'', ''
),
(NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);

CREATE TABLE parent (a INTEGER, b INTEGER, label TEXT, PRIMARY KEY (a, b));
CREATE TABLE child (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pa INTEGER, pb INTEGER,
    FOREIGN KEY (pa, pb) REFERENCES parent (a, b) ON DELETE CASCADE ON UPDATE SET NULL
);
INSERT INTO parent VALUES (1, 1, 'first'), (2, 2, 'second');
INSERT INTO child (pa, pb) VALUES (1, 1), (2, 2);

CREATE TABLE already_that_value (id INTEGER PRIMARY KEY, v TEXT);
INSERT INTO already_that_value VALUES (1, 'same'), (2, 'other');

-- SQLite stores these as text; the decoder only sees the declared type.
CREATE TABLE ts_precision (
    id     INTEGER PRIMARY KEY,
    zoned  DATETIME,
    naive  DATETIME,
    t_only TEXT
);
INSERT INTO ts_precision VALUES
    (1, '2026-08-27 03:30:00',        '2026-08-27 10:30:00',        '10:30:00'),
    (2, '2026-08-27 03:30:00.123',    '2026-08-27 10:30:00.123',    '10:30:00.123'),
    (3, '2026-08-27 03:30:00.123456', '2026-08-27 10:30:00.123456', '10:30:00.123456'),
    (4, '2026-08-27 03:30:00.000001', '2026-08-27 10:30:00.000001', '10:30:00.000001'),
    (5, '2026-08-27 15:30:00',        '2026-08-27 10:30:00',        '00:00:00');
