# dodb

**A native database manager for macOS.**

> **dodb — “ดู DB”**
> *See your data. Understand your database.*

dodb is a modern, native macOS database manager built around a simple idea: **working with a database should start with seeing it clearly.**

The name **dodb** comes from the Thai pronunciation of “do,” meaning **“to see”**, combined with **DB** for database.

It represents what dodb is about: **See the data. See the structure. See what is happening.**

<p align="center">
  <img src="docs/screenshot/inline_editor.png" alt="dodb Data Explorer and Inline Editor" width="100%" />
</p>

---

## Why dodb?

Database tools often become complicated as more features are added.

dodb focuses on the core tasks developers actually do with databases:

* Connect & Inspect
* Explore & Inline Edit
* Query with Monaco Editor & Run Selected Text
* Visualize Schemas (ER Diagram) & Spatial GIS Data (MapLibre GL)
* Audit, Dump & Commit Transactions

**No unnecessary clutter. No artificial complexity. Just your database.**

---

## Features & Screenshots

### Connection Management & Profiles
Save and organize database connections with encrypted credentials (AES-256-GCM), group profiles, and single-click connect.

<p align="center">
  <img src="docs/screenshot/connection_group.png" alt="Connection Management" width="100%" />
</p>

---

### Interactive Data Explorer & Inline Editing
* **Virtual Data Grid** — Smooth scrolling across thousands of records with pagination support.
* **Database-Aware Cell Badges** — Distinct badges for DateTime, Booleans, JSON, Binary/BLOB, Enums, UUIDs, Primary Keys, and Spatial GIS geometries.
* **Inline Cell Editing** — Edit values directly with double-click and review changes before committing.
* **Transactional Staging Bar** — Staged mutations (Insert, Update, Delete) with diff review and atomic rollback.
* **Advanced Filters & Sorting** — Multi-column sorting with rich operators (`equals`, `contains`, `startsWith`, `endsWith`, `gt`, `gte`, `lt`, `lte`, `isNull`, `isNotNull`).
* **Search & Export** — Export table data to CSV, JSON, and SQL `INSERT` statements.

<p align="center">
  <img src="docs/screenshot/inline_editor.png" alt="Interactive Data Explorer" width="100%" />
</p>

---

### GIS & Spatial Data Support (MapLibre GL)
* **Engines Supported** — PostGIS (`geometry`, `geography`), MySQL Spatial (`GEOMETRY`, `POINT`, `POLYGON`, etc.), and SpatiaLite.
* **Universal Format Parser** — Automatically recognizes and decodes WKT (Well-Known Text), GeoJSON, and EWKB/WKB Hex binary formats.
* **Interactive Map Viewer**:
  * Vector & raster map rendering with Dark Matter, Positron Light, OpenStreetMap, and Satellite basemaps.
  * Spatial feature inspector & table-wide multi-feature rendering.
  * Interactive coordinate picker for inserting or editing geometries.
  * Export spatial layers to standard `.geojson` files.

<p align="center">
  <img src="docs/screenshot/gis_viewer.png" alt="GIS and Spatial Map Viewer" width="100%" />
</p>

---

### Monaco SQL Console & Auto-Completion
* **Monaco Editor** with intelligent auto-completion for tables, columns, keywords, and SQL functions.
* **Run Selection (Highlight to Run)** — Highlight any SQL query and run only the selected text with `Cmd + Enter`.
* **Multi-Statement Engine** — Sequentially execute multi-statement SQL scripts with separate result tabs.
* **Draggable Resizer** — Adjust editor pane height dynamically.
* **Execution Metrics** — Real-time execution duration, returned rows, and affected rows indicators.

<p align="center">
  <img src="docs/screenshot/autocomplete.png" alt="Monaco SQL Console and Autocomplete" width="100%" />
</p>

---

### Visual Schema & ER Diagram
* **Interactive Node Graph** powered by `@xyflow/react` to visualize tables, column types, and foreign key relationships.
* **Multi-directional Handles** for clean edge routing and relationship alignment.
* **Interactive Search & Relation Highlighting** — Highlight connected tables and foreign keys on click.
* **Auto Layout** — Organizes tables into clean topology columns.

<p align="center">
  <img src="docs/screenshot/erd.png" alt="Visual Schema and ER Diagram" width="100%" />
</p>

---

### Searchable Detailed Inspector & JSON View / Export
* Right-click any row to inspect fields in full-screen modal with instant search and formatted JSON view.
* Modal record editor with NULL toggles and auto-increment handling.
* 1-click duplicate row and fast clipboard export (JSON, CSV, SQL INSERT).
* View spatial geometry directly on the interactive map.

<p align="center">
  <img src="docs/screenshot/json_view_export.png" alt="Detailed Record Inspector and JSON View" width="100%" />
</p>

---

### Table Structure & Visual Designer
* Create new tables or alter existing schemas visually.
* Column editor with type suggestions, nullability, defaults, primary keys, and auto-increment.
* DDL Preview & Verification before executing destructive schema changes.

### Database Administration & Monitoring
* Server engine info, uptime, and connection metrics.
* Process & connection monitor with rogue query termination (`Kill Process`).
* Database and table storage metrics.

### Audit Log & Action Trail
* Comprehensive local audit logging for all queries, mutations, DDL executions, and connection events.
* Filter by status, profile, action type, and date range.

---

## Supported Database Engines

| Engine | Version | Spatial / GIS Support |
| :--- | :--- | :--- |
| **PostgreSQL** | 10+ / 14 / 15 / 16 / 17 | PostGIS (`geometry`, `geography`, WKT, EWKB) |
| **MySQL** | 5.7 / 8.0+ | MySQL Spatial (`GEOMETRY`, `POINT`, `POLYGON`, etc.) |
| **MariaDB** | 10.3+ | MariaDB Spatial |
| **SQLite** | 3.x | SpatiaLite & WKT / GeoJSON |

---

## Architecture

| Layer | Technology |
| :--- | :--- |
| Desktop Shell | Tauri 2 |
| Frontend | Next.js 16 · React 19 |
| Map Engine | MapLibre GL |
| Diagram Engine | React Flow (xyflow) |
| Editor | Monaco Editor |
| Application Core | Rust · Tokio |
| Database Access | SQLx |
| Communication | Tauri IPC |
| Platform | macOS (Apple Silicon & Intel) |

### Privacy & Security
* **Direct Socket Connections** — Connections are established directly from your machine to your database.
* **Zero Telemetry / No Cloud Proxy** — Credentials, schemas, and records are never transmitted to third-party servers.
* **Encrypted Storage** — Connection passwords and sensitive metadata are encrypted locally using AES-256-GCM.

---

## macOS Installation & Security Notice (Unsigned App Fix)

When downloading pre-built `.dmg` or `.app` releases from GitHub without Apple Developer ID notarization, macOS Gatekeeper may display security warnings:

* *“dodb is damaged and can’t be opened. You should move it to the Trash.”*
* *“dodb cannot be opened because the developer cannot be verified.”*
* *“Apple could not verify that dodb is free of malware.”*

### วิธีแก้ไข / How to open unsigned app on macOS:

#### Method 1: Terminal (Recommended / แนะนำ)
After moving `dodb.app` to `/Applications`, open **Terminal** (`Terminal.app`) and run:

```bash
xattr -cr /Applications/dodb.app
```

Or remove the quarantine attribute specifically:

```bash
xattr -d com.apple.quarantine /Applications/dodb.app
```

Then launch **dodb** normally from Applications or Spotlight (`Cmd + Space`).

---

#### Method 2: Right-Click Open (คลิกขวาเพื่อเปิด)
1. Open **Finder** and navigate to `/Applications`.
2. **Right-click** (or `Control + Click`) on **dodb.app**.
3. Click **Open** from the context menu.
4. Click **Open** in the confirmation dialog.

---

#### Method 3: System Settings (การตั้งค่าระบบ)
1. Open **System Settings** (การตั้งค่าระบบ).
2. Go to **Privacy & Security** (ความเป็นส่วนตัวและความปลอดภัย).
3. Scroll down to the **Security** (ความปลอดภัย) section.
4. Click **Open Anyway** (เปิดต่อไป) next to the message stating *“dodb was blocked from use because it is not from an identified developer”*.

---

## Getting Started (Development)

### Prerequisites
* macOS 11.0 or later (Apple Silicon or Intel)
* Rust toolchain (`rustc`, `cargo`): `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
* Node.js 18+ and pnpm 8+: `npm install -g pnpm`

### Clone & Install

```bash
git clone https://github.com/bankjirapan/dodb.git
cd dodb
pnpm install
```

### Start Development Mode

```bash
pnpm dev
```

---

## Production Build

To build the optimized `.app` bundle and `.dmg` installer:

```bash
pnpm tauri build
```

Generated artifacts:
* `src-tauri/target/release/bundle/macos/dodb.app`
* `src-tauri/target/release/bundle/dmg/dodb_<version>_<arch>.dmg`

---

## License

dodb is open source software distributed under the [MIT License](LICENSE).

---

## Made by thutil

Designed and developed by **thutil**.

**dodb — See your data. Understand your database.**
