# dodb

**A native database manager for macOS.**

> **dodb — “ดู DB”**
> *See your data. Understand your database.*

dodb is a modern, native macOS database manager built around a simple idea: **working with a database should start with seeing it clearly.**

The name **dodb** comes from the Thai pronunciation of “do,” meaning **“to see”**, combined with **DB** for database.

It represents what dodb is about:

**See the data. See the structure. See what is happening.**

dodb is designed to make databases feel less intimidating and more approachable without hiding the power that developers need.

---

## Why dodb?

Database tools often become complicated as more features are added.

dodb takes a different approach.

Instead of building another application filled with panels, dashboards, and abstractions, dodb focuses on the core things developers actually do with databases:

* Connect
* Explore
* Query
* Edit
* Visualize (ER & GIS Maps)
* Understand
* Commit

Everything is designed around clarity, speed, and a native macOS experience.

**No unnecessary clutter. No artificial complexity. Just your database.**

---

## ✨ Features

### 📊 Interactive Data Explorer
Explore and manage database records through a clean, high-performance table interface:
* **Browse rows & columns** with smooth virtualization and adjustable page sizes
* **Database-aware cell rendering** with specialized badges for DateTime, Booleans, JSON, Binary/BLOB, Enums, UUIDs, Auto-increment, and Spatial GIS geometries
* **Inline Cell Editing** — Edit values directly inside cells with double-click without modal friction
* **Transactional Commit Bar** — Changes are staged locally (Edit → Review → Commit) with full rollback and diff inspection before writing to the database
* **Multi-column sorting & advanced filtering** with operators (`equals`, `contains`, `startsWith`, `endsWith`, `gt`, `gte`, `lt`, `lte`, `isNull`, `isNotNull`)
* **Quick search** across rows and columns
* **Export records** to CSV, JSON, and SQL `INSERT` statements
* **Soft-delete & restoration** with staged deletion indicators

### 🖱️ Row Context Menu & Searchable Detailed Inspector
Right-click on any table row to access instant contextual actions:
* 🔍 **Detailed Record Inspector** — Full-screen searchable record modal with real-time field/value search, type badges, JSON viewers, and quick-copy buttons
* ✏️ **Edit Record** — Comprehensive modal editor with auto-increment toggles and NULL switches
* 🗺️ **View on Map** — Directly open spatial features on the interactive GIS map
* 📑 **Duplicate Row** — 1-click clone row into the pending insert batch
* 📋 **Copy as JSON & SQL** — Fast clipboard export of row data
* 🗑️ **Delete / Restore Record** — Stage row deletion or restore marked rows

### 🗺️ GIS & Spatial Data Support (Powered by MapLibre GL)
First-class support for spatial databases and geometry types:
* **Multi-Engine Spatial Support** — PostGIS (`geometry`, `geography`), MySQL Spatial (`GEOMETRY`, `POINT`, `LINESTRING`, `POLYGON`, `MULTIPOINT`, `MULTIPOLYGON`), and SpatiaLite
* **Universal Format Parser** — Automatically recognizes and decodes WKT (Well-Known Text), GeoJSON, and EWKB/WKB Hex binary formats
* **Interactive Map Viewer (MapLibre GL)**:
  * High-performance vector & raster map rendering
  * Multiple basemap layers: Dark Matter, Positron Light, OpenStreetMap, and Satellite Imagery
  * Single geometry inspection mode & table-wide multi-record layer view
  * Auto-fit bounding box (`fitBounds`), zoom controls, and cursor coordinate HUD
  * **Interactive Coordinate Picker** — Click on the map to pick coordinates when inserting or editing records
  * **Export to GeoJSON** — Export spatial table layers directly into standard `.geojson` files

### 💻 Multi-Tab SQL Console
A powerful SQL workspace built for speed:
* **Monaco-powered SQL Editor** with syntax highlighting, auto-complete, and query formatting
* **Multi-tab workspace** to write and run multiple queries concurrently
* **Execution diagnostics** — Real-time query execution timing, affected rows, and returned record counters
* **Query history** and log tracking
* **Export query results** to CSV, JSON, and SQL

### 🕸️ Visual Schema & ER Diagram
Understand your database architecture visually:
* **Interactive ER Diagram** powered by modern node-graph canvas (`@xyflow/react`)
* **Automatic relationship discovery** — Visualizes foreign key connections and routing between tables
* **Table cards** with column types, primary key badges, and spatial GIS indicators
* **Canvas controls** — Zoom, pan, minimap, and search filter across diagram tables

### 🛠️ Table Structure & Visual Designer
Design and modify database tables with safety:
* **Visual Table Designer** for creating new tables or altering existing schemas
* **Column editor** with type suggestions (including GIS spatial types), nullability, defaults, primary keys, and auto-increment
* **Foreign keys & index managers**
* **DDL Preview & Verification** — Generates clean SQL DDL and prompts with confirmation before running destructive schema changes

### 🖥️ Database Administration & Monitoring (Admin Panel)
Monitor and manage your database servers in real-time:
* **Server Health & Metrics** — Database engine version, uptime, connection pool statistics
* **Process & Connection Manager** — View active queries and terminate rogue connections (Kill Process)
* **Storage Metrics** — Database size, table storage usage, and index sizes
* **Configuration Variables** viewer

### 📜 Audit Log & Action Trail
Track and inspect all operations performed through dodb:
* Comprehensive audit logging for queries, mutations (`INSERT`/`UPDATE`/`DELETE`), DDL changes, and connection events
* Filter by status (`SUCCESS`/`ERROR`), connection profile, action type, and date range
* Execution duration and error stack trace inspection

### ⌨️ Native macOS Ergonomics & Shortcuts
* **Command Palette (`Cmd+K` / `Ctrl+K`)** for rapid navigation, switching tables, and running actions
* **Theme customizer** — Seamless Dark Mode and Light Mode matching macOS system appearance
* **GUI scale adjustments** for custom screen resolutions
* **Encrypted connection credentials** stored safely using AES-256-GCM encryption

---

## 🗄 Supported Database Engines

| Engine | Version | Spatial / GIS Support |
| :--- | :--- | :--- |
| **PostgreSQL** | 10+ / 14 / 15 / 16 / 17 | ✅ PostGIS (`geometry`, `geography`, WKT, EWKB) |
| **MySQL** | 5.7 / 8.0+ | ✅ MySQL Spatial (`GEOMETRY`, `POINT`, `POLYGON`, etc.) |
| **MariaDB** | 10.3+ | ✅ MariaDB Spatial |
| **SQLite** | 3.x | ✅ SpatiaLite & WKT / GeoJSON |

---

## 🏗 Architecture

dodb is built with a high-performance native stack:

| Layer            | Technology            |
| ---------------- | --------------------- |
| Desktop Shell    | Tauri 2               |
| Frontend         | Next.js 15 · React 19 |
| Map Engine       | MapLibre GL           |
| Diagram Engine   | React Flow (xyflow)   |
| Editor           | Monaco Editor         |
| Application Core | Rust · Tokio          |
| Database Access  | SQLx                  |
| Communication    | Tauri IPC             |
| Platform         | macOS                 |

### Why Rust & Tauri?

Database applications deal with network connections, concurrent queries, large datasets, and long-running operations.

Rust provides dodb with a foundation that is:
* **Memory safe** and lightweight
* **Efficient** with zero garbage-collection pauses
* **Concurrent** using Tokio asynchronous runtime
* **Predictable** for native desktop performance

---

## 🔐 Privacy & Security

Your database is your data.

* **Direct connections** — Direct socket connection from your Mac to your database.
* **No cloud proxy** — dodb never sends your database credentials, schema, or records to external servers.
* **Encrypted storage** — Connection passwords and sensitive profile metadata are encrypted locally using AES-256-GCM.

---

## 🚀 Getting Started

### Requirements

* macOS 11.0 or later (Apple Silicon or Intel)
* Rust toolchain (`cargo`, `rustc`)
* Node.js 18 or later
* pnpm 8 or later

### Clone the repository

```bash
git clone https://github.com/bankjirapan/dodb.git
cd dodb
```

### Install dependencies

```bash
pnpm install
```

### Start development

```bash
pnpm dev
```

This starts the Tauri application with hot-reload frontend and dev Rust core.

---

## 📦 Production Build

Build the optimized macOS application bundle:

```bash
pnpm tauri build
```

Build artifacts are generated under:

```text
src-tauri/target/release/bundle/
```

* `.app` — macOS application bundle
* `.dmg` — macOS disk image

---

## 📄 License

dodb is distributed under the [MIT License](LICENSE).

---

## Made by thutil

dodb is designed and developed by **thutil**.

Built in 2026 for developers who want a database tool that stays out of the way.

**dodb — See your data. Understand your database.**
