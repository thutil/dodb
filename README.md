# dodb — Modern macOS Native Database Manager

<p align="center">
  <img src="assets/icon.png" width="128" height="128" alt="dodb Logo" />
</p>

<p align="center">
  <strong>Modern, Lightning-Fast macOS Native Database Management Application for PostgreSQL & MySQL / MariaDB</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Platform-macOS%20Native-blue?style=flat-square&logo=apple" alt="Platform" />
  <img src="https://img.shields.io/badge/Electron-v43.4.0-47848F?style=flat-square&logo=electron" alt="Electron" />
  <img src="https://img.shields.io/badge/Next.js-v15.3.3-000000?style=flat-square&logo=next.js" alt="Next.js" />
  <img src="https://img.shields.io/badge/PostgreSQL-Supported-4169E1?style=flat-square&logo=postgresql" alt="PostgreSQL" />
  <img src="https://img.shields.io/badge/MySQL%20%2F%20MariaDB-Supported-00758F?style=flat-square&logo=mysql" alt="MySQL" />
  <img src="https://img.shields.io/badge/License-MIT-green?style=flat-square" alt="License" />
</p>

---

## 🌟 Overview

**dodb** is a high-performance, native macOS database management tool engineered for developer productivity. Designed around macOS native design language (glassmorphism, vibrant dark mode, and seamless `hiddenInset` traffic lights), **dodb** provides complete control over **PostgreSQL** and **MySQL/MariaDB** databases with zero clutter.

Features include an **Interactive Data Explorer (Full CRUD)**, **Inline Cell Editor**, **Atomic Transactional Commit Bar**, **Interactive Drag & Drop ER Diagram Visualizer**, **Process Manager**, and **SQL & CSV Exporters**.

---

## ✨ Key Features

### 🔌 1. Multi-Engine Connection Manager
- Native support for **PostgreSQL** and **MySQL / MariaDB**.
- Save and manage multiple connection profiles with connection testing (`Test Connection`).
- Real-time database switcher in the header and sidebar.
- Dedicated background connection pooling for low latency and high efficiency.

### ⚡ 2. Conflict-Free Custom Ports
- Uses isolated custom ports specifically reserved for **dodb** to avoid collisions with local development tools (e.g. Nginx, React, or Grafana on port 3000):
  - **Backend API Server**: Port `5820`
  - **UI Production Server**: Port `5821`

### 📊 3. Data Explorer & Full CRUD
- **Paginated Data Grid**: High-performance pagination, column sorting, and multi-column filtering.
- **Inline Cell Editing**: Double-click any cell to update values directly.
- **Row Edit & View Modal**: Inspect complex data types (JSON, text blobs, timestamps) in a dedicated inspector.
- **Atomic Database Transaction Bar**: Changes (Inserts, Updates, Deletes) are queued in a pending changes bar. Apply changes atomically using **Commit Changes** (`BEGIN / COMMIT`) or revert with **Rollback**.

### 🕸️ 4. Drag & Drop ER Diagram Visualizer
- Powered by `@xyflow/react` (React Flow 12).
- Drag and position table nodes anywhere on a smooth canvas.
- Live animated foreign key relationship edges dynamically adapt to card positioning.
- Automatic theme adaptation for Light and Dark modes.

### 🛡️ 5. Database Admin & Process Manager
- **Database Management**: Create and drop databases directly from the GUI.
- **User & Privileges**: Manage database users and superuser privileges.
- **Active Process Monitor**: View running queries, client IPs, and connection durations with a one-click **Kill Process** button.

### 📥 6. SQL & CSV Export
- **Export SQL Dump**: Generate full ANSI SQL Dumps including `CREATE TABLE` DDL structures and `INSERT INTO` DML data statements.
- **Export CSV**: Export table data directly to CSV with instant file download.

### 🎨 7. Native macOS Aesthetics & Auto Theme Sync
- Features macOS `hiddenInset` native title bar styling.
- Automatically syncs with system theme preferences (`prefers-color-scheme`) with manual Dark/Light toggle.

---

## 🏗️ Architecture & Technology Stack

| Layer | Technology |
| :--- | :--- |
| **Desktop Shell** | Electron 43.4.0 (macOS Native Frameless `hiddenInset`) |
| **Frontend Framework** | Next.js 15.3.3 (React 19), React Flow (`@xyflow/react`), Lucide Icons |
| **Styling** | Custom Vanilla CSS Design System with System Tokens |
| **Backend REST API** | Express 5.x, TypeScript 5.8, Node.js |
| **Database Clients** | `pg` (PostgreSQL Client Pool), `mariadb` (MariaDB/MySQL Pool) |
| **API Port** | `http://localhost:5820` |
| **UI Port** | `http://localhost:5821` |

---

## 💾 Installation & macOS Gatekeeper Security Notice

Since **dodb** builds are ad-hoc packaged without an Apple Developer ID Code Signing Certificate, macOS Gatekeeper may flag the application as from an "unidentified developer" or "damaged" upon first launch.

### Step-by-Step Installation

1. Download the latest `dodb-*.dmg` installer from the [GitHub Releases](https://github.com/bankjirapan/dodb/releases) page.
2. Open the `.dmg` file and drag **`dodb.app`** into your `/Applications` folder.
3. Open **Terminal** and execute the following command to remove the macOS quarantine flag:

```bash
xattr -dr com.apple.quarantine /Applications/dodb.app
```

4. Open **dodb** from your Applications folder or via Spotlight (`Cmd + Space`).

---

## 💻 Prerequisites & System Requirements

- **Operating System**: macOS 11.0+ (Apple Silicon `arm64` or Intel `x64`)
- **Node.js**: v18.0.0 or higher
- **Package Manager**: `pnpm` (v8+)

---

## 🚀 Getting Started (Development Setup)

### 1. Clone the Repository & Install Dependencies

```bash
# Clone repository
git clone https://github.com/bankjirapan/dodb.git
cd dodb

# Install backend & desktop dependencies
pnpm install

# Install UI dependencies
pnpm --prefix ui install
```

### 2. Run in Development Mode

Run the complete Electron desktop app with live reload:

```bash
pnpm desktop
```

Or run the backend server and frontend UI independently:

```bash
# Start Express Backend Server (Port 5820)
pnpm dev

# Start Next.js Development UI (Port 5821)
pnpm ui:dev
```

---

## 📦 Building for Production

### Step 1: Compile Application Assets

Compile the Express TypeScript backend and Next.js frontend:

```bash
pnpm build
```

This generates:
- Backend JS output in `dist/server.js`
- UI Static Export in `ui/out/`

### Step 2: Build Packaged macOS Installer (`.dmg`)

Package the application into an executable macOS DMG installer using `electron-builder`:

```bash
pnpm dist:mac
```

> **Note**: If you encounter directory lock issues during rebuilds, clean previous output first:
> ```bash
> rm -rf dist-dmg && pnpm dist:mac
> ```

### Output Artifacts

Upon completion, the final installers are generated under `dist-dmg/`:
- **`dist-dmg/dodb-1.0.0-arm64.dmg`** — macOS Apple Silicon Installer (`arm64`)
- **`dist-dmg/mac-arm64/dodb.app`** — macOS Standalone Application Bundle

---

## 🤖 CI/CD Automated Release via Git Tag

This repository is configured with **GitHub Actions** ([`.github/workflows/release.yml`](file:///.github/workflows/release.yml)) to automatically build the project, package the macOS DMG, and create a GitHub Release whenever a new version tag (e.g. `v1.0.0`) is pushed.

### How to Trigger an Automated Release

1. **Tag your commit**:
   ```bash
   git tag v1.0.0
   ```

2. **Push the tag to GitHub**:
   ```bash
   git push origin v1.0.0
   ```

3. **Automated Release Process**:
   - GitHub Actions runner (`macos-latest`) will trigger the **Release macOS DMG** workflow.
   - It compiles all backend and frontend assets, runs `electron-builder` to package the DMG.
   - A new GitHub Release is created automatically with generated release notes and the `dodb-*.dmg` file attached!

---

## ⚙️ Configuration & Ports

The default ports used by **dodb** can be overridden via environment variables if required:

| Parameter | Environment Variable | Default Value | Description |
| :--- | :--- | :--- | :--- |
| **Backend API Port** | `PORT` | `5820` | Port for Express REST API server |
| **UI API Endpoint** | `NEXT_PUBLIC_API_BASE` | `http://localhost:5820/api` | Base URL used by UI to communicate with backend |
| **UI Server Port** | `PORT` | `5821` | Port for Electron internal UI static server |

---

## 📂 Project Structure

```
dodb/
├── assets/                  # App icons and graphics
├── dist/                    # Compiled backend TypeScript output
├── dist-dmg/                # Packaged macOS DMG installers & app bundles
├── electron/
│   └── main.js              # Electron main process & server lifecycle manager
├── src/                     # Express REST API backend
│   ├── config/              # Saved connection profile configurations
│   ├── db/                  # PostgreSQL & MariaDB pool managers
│   ├── routes/              # API Endpoints (database, command, list, admin, profile)
│   ├── app.ts               # Express middleware setup
│   └── server.ts            # Entrypoint for Express backend (Port 5820)
├── ui/                      # Next.js 15 Frontend UI
│   ├── src/
│   │   ├── components/      # DataGrid, Header, SidebarExplorer, ConnectionModal, ER Diagram
│   │   ├── pages/           # Main application page
│   │   └── types/           # TypeScript interfaces & types
│   ├── out/                 # Compiled static UI export for Electron
│   └── package.json         # UI dependencies & scripts
├── package.json             # Root scripts & electron-builder configuration
└── README.md                # Project documentation
```

---

## 📄 License

Distributed under the **MIT License**. See `LICENSE` for more information.

---

<p align="center">
  Designed & Developed with ❤️ by <strong>thutil</strong>
</p>
