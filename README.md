# dodb - Modern macOS Native Database Manager

dodb is a high-performance, native macOS database management tool engineered for developer productivity. Designed around macOS native design language, dodb provides complete control over PostgreSQL, MySQL/MariaDB, and SQLite databases with zero clutter.

Features include an Interactive Data Explorer (Full CRUD), Inline Cell Editor, Atomic Transactional Commit Bar, and more.

## Architecture & Technology Stack

The architecture has been completely rewritten from Node.js/Electron to a highly optimized native Rust stack.

| Layer | Technology |
| :--- | :--- |
| Desktop Shell | Tauri 2.0 (macOS Native Frameless window) |
| Frontend Framework | Next.js 15.3.3 (React 19), Tailwind CSS |
| Backend Core | Rust, Tokio |
| Database Clients | sqlx (AnyPool for connection pooling) |

## Prerequisites & System Requirements

- Operating System: macOS 11.0+ (Apple Silicon arm64 or Intel x64)
- Rust Toolchain: rustup, cargo
- Node.js: v18.0.0 or higher
- Package Manager: pnpm (v8+)

## Getting Started (Development Setup)

1. Clone the Repository & Install Dependencies

```bash
# Clone repository
git clone https://github.com/bankjirapan/dodb.git
cd dodb

# Install frontend dependencies
pnpm install
```

2. Run in Development Mode

Run the complete Tauri desktop app with live reload (Hot Module Replacement for UI and hot-reloading for Rust):

```bash
pnpm dev
```

Note: Development mode disables Rust compiler optimizations. The application might feel slower than usual during development due to the unoptimized binary.

## Building for Production

To experience the true speed and performance of the native Rust backend, you must compile the application in Release mode.

### Compile Application Assets and Build Packaged macOS App

Compile the Next.js frontend and build the optimized Rust binary:

```bash
pnpm tauri build
```

### Output Artifacts

Upon completion, the final installers and app bundles are generated under:
`src-tauri/target/release/bundle/`

You will find:
- `.dmg` - macOS Disk Image Installer
- `.app` - macOS Standalone Application Bundle

Simply drag and drop the `.app` file into your `/Applications` folder.

## Configuration & Ports

The Next.js development server runs on port 5821. The Tauri backend communicates natively over IPC (Inter-Process Communication) and does not require a local REST server port, avoiding any port conflicts.

## Project Structure

```
dodb/
├── src-tauri/               # Tauri Rust backend
│   ├── src/                 # Rust source code (db_core, profiles, main)
│   ├── Cargo.toml           # Rust dependencies
│   └── tauri.conf.json      # Tauri configuration
├── ui/                      # Next.js 15 Frontend UI
│   ├── src/                 # React components and pages
│   └── package.json         # UI dependencies & scripts
├── package.json             # Root scripts
└── README.md                # Project documentation
```

## License

Distributed under the MIT License. See LICENSE for more information.

Designed & Developed by thutil
