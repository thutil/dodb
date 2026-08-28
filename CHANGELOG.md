# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.3.3] - 2026-08-28

### Added
- **Multi-Table Foreign Key Management**: Added interactive sub-tabs in the Foreign Keys designer with single-click `+` constraint creation, column pairing controls, and real-time React Flow visual relationship linking.
- **Custom Monaco Editor Themes**: Added built-in dark themes (`Monokai` by default, `Dracula`, `One Dark`, `dodb-dark`, and `VS Dark`) with toolbar switcher and `localStorage` persistence.
- **SQL Console Quick-Select**: Clicking a table in the database sidebar while on the SQL Console automatically populates a dialect-quoted `SELECT * FROM <table> LIMIT 50;` query directly into Monaco.
- **Collapsible Canvases & Sidebars**:
  - **Schema Diagram**: Added column collapse toggle on individual table cards and collapsible left tables drawer to maximize the canvas workspace.
  - **Visual Query Builder**: Added collapsible tables sidebar for distraction-free visual query construction.
- **Enhanced GIS Map Viewer & MultiPolygon Support**:
  - Full decoding support for PostGIS EWKB Hex binary strings (SRID 4326).
  - WKT parser upgrade with nested parenthesis depth-tracking for complex MultiPolygons and polygon holes.
  - Dynamic vector layer synchronization with auto-fit bounds on feature updates.
  - Interactive polygon click popup and hover states.

### Changed
- **MapLibre GL Stability**: Pinned `maplibre-gl` to stable `v5.24.0` with optimized pure expression layer filters.

### Fixed
- **GIS MultiPolygon Rendering**: Resolved an issue where MultiPolygon shapes in WKT and EWKB formats failed to parse or render on the map canvas.
- **React Flow Warning #002**: Fixed dynamic node types object recreation by memoizing `nodeTypes` outside component lifecycle in Schema Diagram and Foreign Key Editor.

---

## [0.3.1] - 2026-08-27

### Added
- **Dialect-Aware SQL Generation**: Automatic database driver detection (MySQL/MariaDB, PostgreSQL, SQLite) for table and column identifier quoting (backticks `` ` `` for MySQL, double quotes `"` for PostgreSQL).
- **Windows Inno Setup Installer**: Native `.exe` setup package with custom branding and installation wizard.
- **Configurable SQL Query History**: Persistent query log with customizable retention limit (50, 100, 200, 500, or unlimited), search filters, and single-click rerun.
- **Export Formats**: Enhanced SQL INSERT dump, CSV, and JSON streaming export with automatic schema-aware column quoting.

### Changed
- **Framework Migration**: Ported desktop application core from Tauri/Rust to Wails v3 + Go (`pgx`, `go-sql-driver/mysql`, `modernc.org/sqlite`) for faster native startup and smaller memory footprint.
- **Animated Floating Action Docks**: Converted transaction commit bars and status messages into modern floating docks across DataGrid and SQL Console.
- **Optimized GIS Map Viewer**: Simplified offline/online vector tile management powered by MapLibre GL.

### Fixed
- **MySQL Error 1064**: Fixed SQL generation syntax error in MySQL caused by hardcoded PostgreSQL double-quote identifier escaping in `UPDATE`, `DELETE`, `INSERT`, and DDL statements.
- **Hydration Warning**: Resolved Next.js SSR hydration warnings on document body and sidebar panels.

---

## [0.2.4] - 2026-08-26

### Added
- Multi-row batch deletion and rollback in DataGrid.
- Spatial GeoJSON/WKT auto-detection and geometry preview modal.

### Fixed
- Fixed connection pooling timeouts during heavy import operations.

---

## [0.2.3] - 2026-08-25

### Added
- Visual ER Diagram auto-layout and relationship highlighting.
- PostGIS spatial column inspector.

---

## [0.2.0] - 2026-08-20

### Added
- **Visual SQL Query Builder**: Interactive canvas for composing multi-table queries with draggable table nodes, join connections, and where-clause filters.
- **Monaco SQL Console**: IntelliSense autocomplete, query formatting, and multi-statement runner.
- **Connection Profile Manager**: Encrypted credential storage using AES-256-GCM.

---

## [0.1.0] - 2026-08-10

### Added
- Initial release of **dodb** with PostgreSQL, MariaDB, MySQL, and SQLite support.
- Virtual DataGrid with inline editing and staged commits.
- Dark and Light theme support.
