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
* Understand
* Commit

Everything is designed around clarity, speed, and a native macOS experience.

**No unnecessary clutter. No artificial complexity. Just your database.**

---

## ✨ Features

### Interactive Data Explorer

Explore and manage database records through a familiar table interface.

* Browse rows and columns
* Create records
* Edit records
* Delete records
* Sort and filter data
* Pagination
* Database-aware cell rendering

### Inline Cell Editing

Edit values directly inside the data grid.

No unnecessary dialogs or multi-step forms when all you need to do is change a value.

### Transactional Commit Bar

Changes are clearly separated from the database until you decide to commit them.

**Edit → Review → Commit**

This makes data editing more deliberate, transparent, and predictable.

### Multi-Database Support

dodb currently supports:

* PostgreSQL
* MySQL
* MariaDB
* SQLite

The database layer is designed to make adding additional engines possible as the project evolves.

### Native macOS Experience

dodb is built with macOS as the primary platform.

The goal isn't to make a web application look like a Mac application.

The goal is to build a database application that **feels at home on macOS**.

From window behavior and keyboard interaction to layout, typography, and performance, dodb is designed with the platform in mind.

---

## 🏗 Architecture

dodb was completely rewritten from its original Node.js/Electron architecture into a Rust-based native stack.

| Layer            | Technology            |
| ---------------- | --------------------- |
| Desktop Shell    | Tauri 2               |
| Frontend         | Next.js 15 · React 19 |
| Styling          | Tailwind CSS          |
| Application Core | Rust · Tokio          |
| Database Access  | SQLx                  |
| Communication    | Tauri IPC             |
| Platform         | macOS                 |

### Why Rust?

Database applications deal with network connections, concurrent queries, large datasets, and long-running operations.

Rust provides dodb with a foundation that is:

* Memory safe
* Efficient
* Concurrent
* Predictable
* Well suited for native applications

The goal is not simply to make dodb fast.

It is to give the application a solid foundation that can scale with the features we want to build next.

---

## 🔐 Privacy

Your database is your data.

dodb is designed around direct connections from your Mac to your database.

There is no requirement for a cloud account just to connect to a database, and dodb does not need to upload your database contents to a remote service in order to function.

**Your databases stay yours.**

---

## 🚀 Getting Started

### Requirements

* macOS 11.0 or later
* Apple Silicon or Intel
* Rust toolchain
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

This starts the Tauri application with frontend hot reload and a development Rust build.

> Development builds are intentionally unoptimized, so the application may feel slower than a production build.

---

## 📦 Production Build

Build the optimized macOS application with:

```bash
pnpm tauri build
```

Build artifacts are generated under:

```text
src-tauri/target/release/bundle/
```

This includes:

* `.app` — macOS application bundle
* `.dmg` — macOS disk image

---

## 📁 Project Structure

```text
dodb/
├── src-tauri/
│   ├── src/
│   │   ├── db_core/
│   │   ├── profiles/
│   │   └── main.rs
│   ├── Cargo.toml
│   └── tauri.conf.json
│
├── ui/
│   ├── src/
│   └── package.json
│
├── package.json
└── README.md
```

The project is separated into two primary layers:

**UI**
Handles presentation, interaction, and the user experience.

**Rust Core**
Handles database connections, queries, application logic, and native functionality.

Communication between the two layers happens through Tauri's IPC layer rather than a local REST server.

---

## 🛣 Roadmap

dodb is actively evolving.

Areas currently being explored include:

* [ ] Advanced SQL editor
* [ ] Query history
* [ ] Multiple database connections
* [ ] Improved schema browser
* [ ] Relationship visualization
* [ ] Import and export workflows
* [ ] Database comparison
* [ ] Migration tools
* [ ] Additional database engines
* [ ] Advanced keyboard workflows
* [ ] Large dataset performance improvements

The roadmap is intentionally flexible.

New features should make dodb **more useful**, not simply **more complicated**.

---

## 🤝 Contributing

dodb is open source and contributions are welcome.

You can contribute by:

* Reporting bugs
* Suggesting improvements
* Improving the UI
* Optimizing the Rust core
* Adding database support
* Improving documentation
* Submitting pull requests

For larger changes, opening an issue before starting implementation is encouraged so the direction can be discussed first.

---

## 🧭 Design Principles

dodb is built around a few principles.

### Clarity over complexity

A powerful database tool does not need a complicated interface.

### Native over wrapped

Desktop applications should feel like desktop applications.

### Visible over hidden

Users should understand what their database tool is doing.

### Fast over flashy

Performance is part of the experience.

### Open over locked-in

Your database belongs to you.

### Useful over feature-heavy

Every feature should solve a real problem.

---

## The idea behind dodb

The name started with a simple word:

**ดู**

In Thai, *ดู* means **to see, to look, or to watch**.

And that's exactly what we want dodb to help you do.

**See your data.**
**See your schema.**
**See your changes.**
**See your database.**

Then, when you're ready:

**Change it.**

---

## 📄 License

dodb is distributed under the [MIT License](LICENSE).

---

## Made by thutil

dodb is designed and developed by **thutil**.

Built in 2026 for developers who want a database tool that stays out of the way.

**dodb — See your data. Understand your database.**
