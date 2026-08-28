# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.3.6] - 2026-08-28

### Added
- **Native 2-Page Executive Schema Report**:
  - Direct zero-dependency vector canvas rendering with paper size presets (`A4`, `A3`, `US Letter`, `Fit`) and orientation (`Landscape`, `Portrait`).
  - **Page 1 (Architecture Diagram)**: High-resolution visual entity relationship map with database metadata banner and keys legend.
  - **Page 2 (Executive Data Dictionary)**: Detailed schema specifications including table summaries, column data types, primary keys, and foreign key reference matrix.
- **Transparent PNG Export Mode**:
  - Transparent background option for PNG that automatically strips background fills, dot grids, title banners, and watermark/copyright text for clean embedding into Figma, Keynote, PowerPoint, and documentation.
- **Topological Sugiyama Auto-Layout**:
  - Upgraded ERD auto-layout algorithm with dependency hierarchy layering (Root/Parent tables on the left, Core entities in the middle, Child/Junction tables on the right).
  - Cross-reduction sorting to drastically minimize edge crossings and zigzag relationship lines.
  - Dynamic vertical stacking based on actual column count to eliminate table overlapping.
- **Seamless Canvas & Sidebar Selection**:
  - Multi-table selection via `Command + Click` (Mac) / `Ctrl + Click` (Win/Linux) on the left sidebar, or `Shift + Click` directly on canvas table cards.
  - Automatically synchronizes selection with the Export modal.
- **Smart Relationship Edge Filtering**:
  - Automatically omits relationship lines when exporting a single standalone table.
  - For multi-table exports, only draws relationship lines where both source and target tables are included in the export scope.
- **Visual Query Builder - GROUP BY Support**:
  - Added support for `GROUP BY` clause and aggregation functions (`COUNT`, `SUM`, `AVG`, `MIN`, `MAX`) across visual query builder.

### Fixed
- **Connection Explorer Folder Persistence**: Fixed connection folder collapse state to persist reliably without auto-expanding on reload.
- **React Flow Edge Handle Warning (#008)**: Added fallback handle bridges for all table columns to eliminate React Flow handle connection errors when columns are truncated in compact mode.
- **Suppressed Browser Header/Footer in Print & PDF**: Configured zero-margin print stylesheet with internal body padding to remove browser URL headers (`http://localhost:...`), document titles, and timestamps from generated PDFs.

---

## [0.3.5] - 2026-08-28

### Added
- **Horizontal Scroll Retention in DataGrid**: Preserves horizontal scroll position when sorting, filtering, or refreshing data across wide tables with many columns.
- **Non-Destructive Loading Indicator**: Added a slim, animated top loading bar in the DataGrid that keeps the table mounted and prevents layout collapse during data reloads.
- **Production Build Hardening**: Added `-tags production` to all macOS/Windows compilation scripts to disable devtools and secure production runtime binaries.
- **Indexes Editor Enhancements**: Improved index creation workflow with clearer tooltips and refined styling.

### Fixed
- **Scroll Left Jump on Sort**: Fixed an issue where clicking a column header on the right side of a scrolled table caused the horizontal scroll to jump back to `0` (far left).
- **Auto-Scroll Behavior on Table Switch**: Automatically resets scroll position cleanly to the top-left `(0, 0)` only when changing tables or switching databases.

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
