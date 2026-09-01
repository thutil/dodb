# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.3.9] - 2026-09-01

### Added

- **Smart Content Type Detection & Rich Content Editor**:
  - Automatically identifies whether cell values or columns contain **Markdown**, **HTML**, **JSON**, or **Plaintext** based on heuristics, column names (e.g. `content`, `body`, `notes`, `description`, `summary`), and data formats.
  - Adds compact, intuitive type badges (`MD`, `JSON`, `HTML`, `TXT`) directly in data grid and SQL console cells, accompanied by header title tags / counts where applicable.
  - Launches a powerful Monaco-based modal text editor on button click, double-click, or right-click context menu (`Open in Text Editor`).
  - Supports switching content types (`Markdown | HTML | JSON | Plaintext`) on the fly.
  - **Fullscreen Focus Mode**: Toggle fullscreen to focus solely on drafting and editing expansive text, with word, character, and line count statistics.
  - **Split / Preview View**: Live preview renderer for Markdown and HTML (with asset/image tags safely bypassed for clean, text-centric editing).
  - **JSON Prettify, Minify & Validation**: Built-in JSON formatting, minification, and real-time syntax error validation.
  - Keyboard shortcut `⌘Enter` / `Ctrl+Enter` to quickly apply edits.

### Fixed

- **Boolean Inline Editing & Type Coercion**:
  - Resolved an issue where inline boolean edits in MySQL/MariaDB (which use `tinyint(1)` or `bit`) and PostgreSQL were erroneously coerced to string `'true'` / `'false'`, preventing successful updates.
  - Improved `coerceCellValue` to prioritize boolean types (`bool`, `boolean`, `tinyint(1)`, `bit`) before generic numeric integer matches, guaranteeing native boolean primitives are sent.
  - Added dedicated inline `<select>` dropdown editor for boolean fields in DataGrid, SQL Console, and Row Edit Modals.
  - Styled visual boolean badge pills (`true` in green, `false` in subtle neutral/gray) for clear readability.

---

## [0.3.8] - 2026-08-31

### Added

- **In-App Soft Reload (`⌘R` / `Ctrl+R` / `F5`)**:
  - Intercepts reload shortcuts globally to prevent destructive full-page browser reloads that cause connection drops.
  - Automatically triggers an in-app soft reload that refreshes active table data, table lists, and database lists while keeping the active connection completely intact.
  - Displays a clean, non-intrusive feedback toast (`Data refreshed (⌘R)`). Hard reload remains accessible via `⌘ + Shift + R` / `Ctrl + Shift + R`.
- **Persistent Connection & View Recovery Across Browser Reloads**:
  - Automatically reconnects to the last active profile upon page refresh without disconnecting to a blank state.
  - Restores both the active database and the active table seamlessly from local storage.
  - Manual disconnect cleanly purges cached session keys to present the connection dialog when desired.
- **Database Charset & Collation Configuration**:
  - Added support for selecting Character Set / Encoding and Collation when creating new databases on MySQL, MariaDB, and PostgreSQL.
  - Includes presets for MySQL/MariaDB (`utf8mb4` with `utf8mb4_unicode_ci`, `utf8mb4_0900_ai_ci`, `utf8mb4_thai_520_w2`, `utf8mb4_bin`, `utf8mb4_general_ci`, plus `utf8mb3`, `latin1`, `ascii`, `binary`) and PostgreSQL (`UTF8`, `LATIN1`, `SQL_ASCII`, `WIN1252`, `EUC_JP` with collation choices).
  - Dedicated **Create Database Modal** featuring live DDL SQL preview, copy SQL button, and keyboard `Esc` closing.
  - Quick `+` button directly in the sidebar database section header to launch database creation with auto-switch upon success.

### Changed

- **Minimalist Toast & Status Bar Redesign**:
  - Removed loud green/red borders, glowing outlines, and reddish background cards from status messages and toasts in DataGrid and SQL Console.
  - Adopted a clean, neutral card styling (`border: 1px solid var(--border-medium)`) with subtle status icons for a distraction-free, native look.
- **Admin Panel Create Database Layout**:
  - Streamlined the inline database creation form into a unified, balanced row (`Database Name` | `Charset/Encoding` | `Collation` | `Create Database`).
  - Removed redundant action buttons to reduce visual noise.

### Fixed

- **Friendly MySQL / Database Add Row Error Reporting**:
  - Replaced raw, screen-overflowing database error strings with clean, human-readable error summaries and a persistent Error Details modal so users can inspect and copy full error traces.
  - Preserved pending draft rows and error contexts across table and view navigation so work is never lost.

---

## [0.3.7] - 2026-08-29

### Added

- **Dialect-Aware SQL Dump & Restore**:
  - Every SQL dump is now written in the dialect of the connection it came from. Session flags are emitted per engine — `SET NAMES utf8mb4` / `SET FOREIGN_KEY_CHECKS` for MySQL/MariaDB, `PRAGMA foreign_keys` for SQLite, and nothing privileged for PostgreSQL.
  - PostgreSQL dumps deliberately avoid `SET session_replication_role`, which requires superuser and fails on managed instances (RDS, Cloud SQL, Supabase).
- **Complete Table Structure in Dumps**: `CREATE TABLE` is now generated by the shared DDL builder, so dumps carry primary keys, `AUTO_INCREMENT` / `GENERATED BY DEFAULT AS IDENTITY` / SQLite `AUTOINCREMENT`, unique and secondary indexes, `ENGINE=InnoDB`, and the PostGIS extension line where needed.
- **Order-Independent Restore**: Foreign keys are collected and emitted as an `ALTER TABLE ... ADD CONSTRAINT` section at the end of the file, so tables can be restored in any order without elevated privileges. SQLite keeps them inline, since it cannot add constraints after the fact.
- **PostgreSQL Sequence Reset**: Dumps end with `setval()` statements that move identity/serial sequences past the restored rows, so the first insert after a restore no longer fails with a duplicate key.
- **Self-Identifying Dumps**: Files carry a `-- DODB-Dialect:` header that the import wizard reads to warn about a dialect mismatch before a single statement runs.
- **Dump Flavour Indicator**: The Admin dump panel now shows which SQL flavour will be produced next to the file format selector (e.g. `File Format · PostgreSQL`).

### Changed

- **Shared Dialect Helpers**: Introduced `toDialect()` and `sqlLiteral()` in the DDL builder and adopted them across the Admin panel, DataGrid, SQL Console, Visual Query Builder, Sidebar Explorer, Table Structure modal, and the visual SQL builder, replacing six hand-rolled copies of the same dialect ternary and value-escaping expression.
- **macOS Minimum Version**: Raised to Sonoma 14.0 (from Big Sur 11.0) in the Cask, the release workflow, and `Info.plist`.

### Fixed

- **SQL Export Ignored the Database Engine**: Exporting from PostgreSQL produced a MySQL-only script whose first statement aborted the import with `ERROR: unrecognized configuration parameter "foreign_key_checks" (SQLSTATE 42704)`. Identifier quoting, session flags, and DDL now all follow the source connection.
- **Dumps Contained No Schema**: The column fetch unwrapped the wrong response shape, so `Full` and `Schema Only` dumps silently emitted no `CREATE TABLE` at all and `INSERT` column lists fell back to the keys of the first row.
- **Backslash Corruption on MySQL/MariaDB**: String values were escaped for quotes only. Because MySQL treats `\` as an escape character, any value containing a backslash was mangled — in dumps, in _Copy as SQL INSERT_, in DataGrid and SQL Console inline edits committed to the live database, and in Visual Query Builder filter values.
- **Schema-Qualified Table Names in Dumps**: `DROP TABLE` and `CREATE TABLE` quoted `public.users` as a single identifier (`"public.users"`) instead of quoting each part.
- **False Dialect-Mismatch Warning**: A MySQL dump imported into a MariaDB connection always raised a mismatch banner, because the dump's `mysql` fingerprint was compared against the profile's `mariadb` type without normalisation.

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
