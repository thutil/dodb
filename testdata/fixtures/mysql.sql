-- The MySQL entrypoint client connects as latin1, which double-encodes every
-- UTF-8 byte in this file on the way in (Thai text arrives as C3A0C2B8..., not
-- E0B897...). MariaDB's client does not. Without this line the fixture teaches
-- the parity suite to expect mojibake.
SET NAMES utf8mb4;

-- MySQL / MariaDB fixture: the hazards from db_core.rs:541-626.
-- Note tinyint(1) sitting next to a real BOOLEAN column: MySQL has no distinct
-- boolean type, which is exactly why is_boolean_column keys off the driver's
-- reported type name rather than the value's width.
CREATE TABLE hazards (
    id            int AUTO_INCREMENT PRIMARY KEY,
    exact_money   decimal(30,10),
    big_int       bigint,
    ubig_int      bigint unsigned,
    small_int     smallint,
    real_num      double,
    is_true       boolean,
    int_not_bool  tinyint,
    ts_zoned      timestamp NULL,
    dt_naive      datetime,
    d             date,
    t             time,
    ident         char(36),
    doc           json,
    raw           varbinary(16),
    blob_col      blob,
    geom          geometry,
    feeling       enum('sad','ok','happy'),
    plain_text       text
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO hazards (
    exact_money, big_int, ubig_int, small_int, real_num, is_true, int_not_bool,
    ts_zoned, dt_naive, d, t, ident, doc, raw, blob_col, geom, feeling, plain_text
) VALUES
(
    12345678901234.5678901234, 9223372036854775807, 18446744073709551615, -32768, 0.1,
    true, 1,
    '2026-08-27 03:30:00', '2026-08-27 10:30:00', '2026-08-27', '10:30:00',
    '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
    '{"z":1,"a":{"nested":[1,2,3]},"m":"ก ไก่"}',
    UNHEX('00FF10'), UNHEX('00FF10'),
    -- MySQL 8 enforces the SRS's declared axis order, so a 4326 POINT is
    -- (latitude longitude) -- the reverse of the (x y) order Postgres/PostGIS
    -- takes. MariaDB does not enforce it. Written lat-first so both accept it;
    -- the point is the geometry wire format, not the coordinates.
    ST_GeomFromText('POINT(13.7563 100.5018)', 4326),
    'happy', 'ทดสอบภาษาไทย'
),
(
    -0.0000000001, -9223372036854775808, 0, 32767, -0.0,
    false, 0,
    '1970-01-02 00:00:01', '1970-01-01 00:00:00', '1970-01-01', '00:00:00',
    '00000000-0000-0000-0000-000000000000',
    JSON_ARRAY(),
    '', '',
    ST_GeomFromText('POINT(0 0)', 4326),
    'sad', ''
),
(
    NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
);

CREATE TABLE parent (
    a int, b int, label varchar(64),
    PRIMARY KEY (a, b)
) ENGINE=InnoDB;
CREATE TABLE child (
    id int AUTO_INCREMENT PRIMARY KEY,
    pa int, pb int,
    KEY pa_pb (pa, pb),
    CONSTRAINT child_parent_fk FOREIGN KEY (pa, pb)
        REFERENCES parent (a, b) ON DELETE CASCADE ON UPDATE SET NULL
) ENGINE=InnoDB;
INSERT INTO parent VALUES (1, 1, 'first'), (2, 2, 'second');
INSERT INTO child (pa, pb) VALUES (1, 1), (2, 2);

-- rows_affected reports *changed*, not *matched* — the reason every grid
-- UPDATE/DELETE carries a COUNT(*) guard (TxStep::RequireOne).
CREATE TABLE already_that_value (
    id int PRIMARY KEY,
    v  varchar(16)
) ENGINE=InnoDB;
INSERT INTO already_that_value VALUES (1, 'same'), (2, 'other');

-- See the Postgres fixture: fractional-second rendering is silently
-- inconsistent between chrono and Go's time package.
CREATE TABLE ts_precision (
    id     int PRIMARY KEY,
    zoned  timestamp(6) NULL,
    naive  datetime(6),
    t_only time(6)
) ENGINE=InnoDB;
INSERT INTO ts_precision VALUES
    (1, '2026-08-27 03:30:00',        '2026-08-27 10:30:00',        '10:30:00'),
    (2, '2026-08-27 03:30:00.123',    '2026-08-27 10:30:00.123',    '10:30:00.123'),
    (3, '2026-08-27 03:30:00.123456', '2026-08-27 10:30:00.123456', '10:30:00.123456'),
    (4, '2026-08-27 03:30:00.000001', '2026-08-27 10:30:00.000001', '10:30:00.000001'),
    (5, '2026-08-27 15:30:00',        '2026-08-27 10:30:00',        '00:00:00');
