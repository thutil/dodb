import express, { Request, Response } from "express";
import { DBConfig, DBPoolManager } from "../db/connections";
import { getProfileById } from "../config/dbProfiles";
import { decryptPassword } from "../utils/crypto";
import { addAuditLog } from "../db/auditLog";
import Database from "better-sqlite3";

const router = express.Router();

function getDBConfig(req: Request): DBConfig {
  const profileId = req.body.profileId || req.body.id;
  if (profileId) {
    const profile = getProfileById(profileId);
    if (profile) {
      const pass = (!req.body.password || req.body.password === "••••••••") ? profile.password : req.body.password;
      return {
        ...profile,
        database: req.body.database || profile.database || profile.filePath || "",
        filePath: req.body.filePath || profile.filePath,
        password: decryptPassword(pass),
      };
    }
  }
  const { type, host, port, user, password = "", database, filePath } = req.body;
  if (!type) {
    throw new Error("Missing database configuration parameter");
  }
  if (type === "sqlite") {
    const targetPath = filePath || database;
    if (!targetPath) {
      throw new Error("Missing SQLite file path");
    }
    return {
      id: "-",
      name: "-",
      type: "sqlite",
      host: "",
      port: 0,
      user: "",
      password: "",
      database: targetPath,
      filePath: targetPath,
      createdAt: "",
      updatedAt: "",
    };
  }
  if (!host || !port || !user || !database) {
    throw new Error("Missing database configuration parameter");
  }
  if (!(type === "mariadb" || type === "postgres")) {
    throw new Error("Database type must be 'mariadb', 'postgres', or 'sqlite'");
  }
  return {
    id: "-",
    name: "-",
    type,
    host,
    port,
    user,
    password: decryptPassword(password || ""),
    database,
    createdAt: "",
    updatedAt: "",
  };
}

function quoteIdent(name: string, type: "mariadb" | "postgres" | "sqlite"): string {
  const clean = name.replace(/[^a-zA-Z0-9_]/g, "");
  if (type === "mariadb") return `\`${clean}\``;
  return `"${clean}"`;
}

// List databases
router.post("/databases", async (req: Request, res: Response) => {
  try {
    const config = getDBConfig(req);
    const pool = DBPoolManager.getPool(config);
    if (config.type === "mariadb") {
      const conn = await (pool as any).getConnection();
      const result = await conn.query("SHOW DATABASES");
      await conn.release();
      res.json(result.map((row: any) => row.Database));
    } else if (config.type === "postgres") {
      const result = await (pool as any).query("SELECT datname FROM pg_database WHERE datistemplate = false;");
      res.json(result.rows.map((row: any) => row.datname));
    } else if (config.type === "sqlite") {
      const dbPath = config.filePath || config.database;
      res.json([dbPath]);
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// List tables
router.post("/tables", async (req: Request, res: Response) => {
  try {
    const config = getDBConfig(req);
    const { database } = req.body;
    const pool = DBPoolManager.getPool({ ...config, database: database || config.database });

    if (config.type === "mariadb") {
      const conn = await (pool as any).getConnection();
      await conn.query(`USE \`${database}\``);
      const result = await conn.query("SHOW TABLES");
      await conn.release();
      res.json({ tables: result.map((row: any) => Object.values(row)[0]) });
    } else if (config.type === "postgres") {
      const result = await (pool as any).query(`SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public';`);
      res.json({ tables: result.rows.map((row: any) => row.tablename) });
    } else if (config.type === "sqlite") {
      const db = pool as Database.Database;
      const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;").all() as any[];
      res.json({ tables: rows.map((r) => r.name) });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// List columns
router.post("/columns", async (req: Request, res: Response) => {
  try {
    const config = getDBConfig(req);
    const { database, table } = req.body;
    if (!table) {
      res.status(400).json({ error: "Missing 'table' in body" });
      return;
    }

    const pool = DBPoolManager.getPool({ ...config, database: database || config.database });

    if (config.type === "mariadb") {
      const conn = await (pool as any).getConnection();
      await conn.query(`USE \`${database}\``);
      const cols = await conn.query(`SHOW FULL COLUMNS FROM \`${table}\``);
      await conn.release();
      res.json({
        columns: cols.map((c: any) => ({
          name: c.Field,
          type: c.Type,
          nullable: c.Null === "YES",
          primaryKey: c.Key === "PRI",
          default: c.Default,
        })),
      });
    } else if (config.type === "postgres") {
      const sql = `
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_name = $1 AND table_schema = 'public'
        ORDER BY ordinal_position;
      `;
      const pkSql = `
        SELECT a.attname
        FROM pg_index i
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
        WHERE i.indrelid = $1::regclass AND i.indisprimary;
      `;
      const result = await (pool as any).query(sql, [table]);
      let pkCols: string[] = [];
      try {
        const pkRes = await (pool as any).query(pkSql, [table]);
        pkCols = pkRes.rows.map((r: any) => r.attname);
      } catch {}

      res.json({
        columns: result.rows.map((c: any) => ({
          name: c.column_name,
          type: c.data_type,
          nullable: c.is_nullable === "YES",
          primaryKey: pkCols.includes(c.column_name),
          default: c.column_default,
        })),
      });
    } else if (config.type === "sqlite") {
      const db = pool as Database.Database;
      const rows = db.prepare(`PRAGMA table_info("${table.replace(/"/g, '""')}")`).all() as any[];
      res.json({
        columns: rows.map((c: any) => ({
          name: c.name,
          type: c.type || "TEXT",
          nullable: c.notnull === 0,
          primaryKey: c.pk > 0,
          default: c.dflt_value,
        })),
      });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Fetch table rows with pagination, sorting, search, and filtering
router.post("/rows", async (req: Request, res: Response) => {
  try {
    const config = getDBConfig(req);
    const { database, table, limit = 50, offset = 0, sortColumn, sortOrder = "ASC", search, filters } = req.body;
    if (!table) {
      res.status(400).json({ error: "Missing 'table' in body" });
      return;
    }

    const pool = DBPoolManager.getPool({ ...config, database: database || config.database });

    if (config.type === "mariadb") {
      const conn = await (pool as any).getConnection();
      await conn.query(`USE \`${database}\``);

      const colsRes = await conn.query(`SHOW COLUMNS FROM \`${table}\``);
      const colNames: string[] = colsRes.map((c: any) => c.Field);

      const whereConditions: string[] = [];
      const whereParams: any[] = [];

      if (Array.isArray(filters)) {
        for (const f of filters) {
          if (!f.column || !colNames.includes(f.column)) continue;
          const qCol = quoteIdent(f.column, "mariadb");
          const op = f.operator || "equals";
          const val = f.value;

          if (op === "isNull") whereConditions.push(`${qCol} IS NULL`);
          else if (op === "isNotNull") whereConditions.push(`${qCol} IS NOT NULL`);
          else if (op === "contains") { whereConditions.push(`${qCol} LIKE ?`); whereParams.push(`%${val}%`); }
          else if (op === "startsWith") { whereConditions.push(`${qCol} LIKE ?`); whereParams.push(`${val}%`); }
          else if (op === "endsWith") { whereConditions.push(`${qCol} LIKE ?`); whereParams.push(`%${val}`); }
          else if (op === "gt") { whereConditions.push(`${qCol} > ?`); whereParams.push(val); }
          else if (op === "gte") { whereConditions.push(`${qCol} >= ?`); whereParams.push(val); }
          else if (op === "lt") { whereConditions.push(`${qCol} < ?`); whereParams.push(val); }
          else if (op === "lte") { whereConditions.push(`${qCol} <= ?`); whereParams.push(val); }
          else if (op === "neq") { whereConditions.push(`${qCol} != ?`); whereParams.push(val); }
          else { whereConditions.push(`${qCol} = ?`); whereParams.push(val); }
        }
      }

      if (search && typeof search === "string" && search.trim() !== "" && colNames.length > 0) {
        const searchVal = `%${search.trim()}%`;
        const searchOrs = colNames.map((c) => `CAST(${quoteIdent(c, "mariadb")} AS CHAR) LIKE ?`);
        whereConditions.push(`(${searchOrs.join(" OR ")})`);
        colNames.forEach(() => whereParams.push(searchVal));
      }

      const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(" AND ")}` : "";
      const orderClause = sortColumn && colNames.includes(sortColumn)
        ? `ORDER BY ${quoteIdent(sortColumn, "mariadb")} ${sortOrder === "DESC" ? "DESC" : "ASC"}`
        : "";

      const countRes = await conn.query(`SELECT COUNT(*) as total FROM \`${table}\` ${whereClause}`, whereParams);
      const total = Number(countRes[0]?.total || 0);

      const queryParams = [...whereParams, Number(limit), Number(offset)];
      const rows = await conn.query(`SELECT * FROM \`${table}\` ${whereClause} ${orderClause} LIMIT ? OFFSET ?`, queryParams);
      await conn.release();
      res.json({ rows, total });

    } else if (config.type === "postgres") {
      const client = pool as any;
      const colsRes = await client.query(
        "SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND table_schema = 'public'",
        [table]
      );
      const colNames: string[] = colsRes.rows.map((r: any) => r.column_name);

      const whereConditions: string[] = [];
      const whereParams: any[] = [];
      let paramIdx = 1;

      if (Array.isArray(filters)) {
        for (const f of filters) {
          if (!f.column || !colNames.includes(f.column)) continue;
          const qCol = quoteIdent(f.column, "postgres");
          const op = f.operator || "equals";
          const val = f.value;

          if (op === "isNull") whereConditions.push(`${qCol} IS NULL`);
          else if (op === "isNotNull") whereConditions.push(`${qCol} IS NOT NULL`);
          else if (op === "contains") { whereConditions.push(`${qCol}::text ILIKE $${paramIdx++}`); whereParams.push(`%${val}%`); }
          else if (op === "startsWith") { whereConditions.push(`${qCol}::text ILIKE $${paramIdx++}`); whereParams.push(`${val}%`); }
          else if (op === "endsWith") { whereConditions.push(`${qCol}::text ILIKE $${paramIdx++}`); whereParams.push(`%${val}`); }
          else if (op === "gt") { whereConditions.push(`${qCol} > $${paramIdx++}`); whereParams.push(val); }
          else if (op === "gte") { whereConditions.push(`${qCol} >= $${paramIdx++}`); whereParams.push(val); }
          else if (op === "lt") { whereConditions.push(`${qCol} < $${paramIdx++}`); whereParams.push(val); }
          else if (op === "lte") { whereConditions.push(`${qCol} <= $${paramIdx++}`); whereParams.push(val); }
          else if (op === "neq") { whereConditions.push(`${qCol} != $${paramIdx++}`); whereParams.push(val); }
          else { whereConditions.push(`${qCol} = $${paramIdx++}`); whereParams.push(val); }
        }
      }

      if (search && typeof search === "string" && search.trim() !== "" && colNames.length > 0) {
        const searchVal = `%${search.trim()}%`;
        const searchOrs = colNames.map((c) => `${quoteIdent(c, "postgres")}::text ILIKE $${paramIdx++}`);
        whereConditions.push(`(${searchOrs.join(" OR ")})`);
        colNames.forEach(() => whereParams.push(searchVal));
      }

      const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(" AND ")}` : "";
      const orderClause = sortColumn && colNames.includes(sortColumn)
        ? `ORDER BY ${quoteIdent(sortColumn, "postgres")} ${sortOrder === "DESC" ? "DESC" : "ASC"}`
        : "";

      const countRes = await client.query(`SELECT COUNT(*) as total FROM "${table}" ${whereClause}`, whereParams);
      const total = Number(countRes.rows[0]?.total || 0);

      const querySql = `SELECT * FROM "${table}" ${whereClause} ${orderClause} LIMIT $${paramIdx++} OFFSET $${paramIdx++}`;
      const rowsRes = await client.query(querySql, [...whereParams, Number(limit), Number(offset)]);
      res.json({ rows: rowsRes.rows, total });

    } else if (config.type === "sqlite") {
      const db = pool as Database.Database;
      const cols = db.prepare(`PRAGMA table_info("${table.replace(/"/g, '""')}")`).all() as any[];
      const colNames = cols.map((c: any) => c.name);

      const whereConditions: string[] = [];
      const whereParams: any[] = [];

      if (Array.isArray(filters)) {
        for (const f of filters) {
          if (!f.column || !colNames.includes(f.column)) continue;
          const qCol = quoteIdent(f.column, "sqlite");
          const op = f.operator || "equals";
          const val = f.value;

          if (op === "isNull") whereConditions.push(`${qCol} IS NULL`);
          else if (op === "isNotNull") whereConditions.push(`${qCol} IS NOT NULL`);
          else if (op === "contains") { whereConditions.push(`${qCol} LIKE ?`); whereParams.push(`%${val}%`); }
          else if (op === "startsWith") { whereConditions.push(`${qCol} LIKE ?`); whereParams.push(`${val}%`); }
          else if (op === "endsWith") { whereConditions.push(`${qCol} LIKE ?`); whereParams.push(`%${val}`); }
          else if (op === "gt") { whereConditions.push(`${qCol} > ?`); whereParams.push(val); }
          else if (op === "gte") { whereConditions.push(`${qCol} >= ?`); whereParams.push(val); }
          else if (op === "lt") { whereConditions.push(`${qCol} < ?`); whereParams.push(val); }
          else if (op === "lte") { whereConditions.push(`${qCol} <= ?`); whereParams.push(val); }
          else if (op === "neq") { whereConditions.push(`${qCol} != ?`); whereParams.push(val); }
          else { whereConditions.push(`${qCol} = ?`); whereParams.push(val); }
        }
      }

      if (search && typeof search === "string" && search.trim() !== "" && colNames.length > 0) {
        const searchVal = `%${search.trim()}%`;
        const searchOrs = colNames.map((c) => `CAST(${quoteIdent(c, "sqlite")} AS TEXT) LIKE ?`);
        whereConditions.push(`(${searchOrs.join(" OR ")})`);
        colNames.forEach(() => whereParams.push(searchVal));
      }

      const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(" AND ")}` : "";
      const orderClause = sortColumn && colNames.includes(sortColumn)
        ? `ORDER BY ${quoteIdent(sortColumn, "sqlite")} ${sortOrder === "DESC" ? "DESC" : "ASC"}`
        : "";

      const countSql = `SELECT COUNT(*) as total FROM "${table.replace(/"/g, '""')}" ${whereClause}`;
      const totalRow = db.prepare(countSql).get(...whereParams) as { total: number };
      const total = totalRow ? totalRow.total : 0;

      const querySql = `SELECT * FROM "${table.replace(/"/g, '""')}" ${whereClause} ${orderClause} LIMIT ? OFFSET ?`;
      const rows = db.prepare(querySql).all(...whereParams, Number(limit), Number(offset));
      res.json({ rows, total });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Schema Graph / ER Diagram
router.post("/schema-graph", async (req: Request, res: Response) => {
  try {
    const config = getDBConfig(req);
    const { database } = req.body;
    const pool = DBPoolManager.getPool({ ...config, database: database || config.database });

    if (config.type === "sqlite") {
      const db = pool as Database.Database;
      const tablesRows = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';").all() as any[];
      const tables = tablesRows.map((r) => r.name);

      const tableSchemas: any[] = [];
      const relationships: any[] = [];

      for (const t of tables) {
        const cols = db.prepare(`PRAGMA table_info("${t.replace(/"/g, '""')}")`).all() as any[];
        tableSchemas.push({
          table: t,
          columns: cols.map((c: any) => ({
            name: c.name,
            type: c.type || "TEXT",
            primaryKey: c.pk > 0,
            nullable: c.notnull === 0,
          })),
        });

        const fks = db.prepare(`PRAGMA foreign_key_list("${t.replace(/"/g, '""')}")`).all() as any[];
        fks.forEach((fk: any) => {
          relationships.push({
            fromTable: t,
            fromColumn: fk.from,
            toTable: fk.table,
            toColumn: fk.to,
          });
        });
      }
      res.json({ tables: tableSchemas, relationships });
    } else if (config.type === "mariadb") {
      const conn = await (pool as any).getConnection();
      await conn.query(`USE \`${database}\``);
      const tablesRes = await conn.query("SHOW TABLES");
      const tables = tablesRes.map((r: any) => Object.values(r)[0]);

      const tableSchemas: any[] = [];
      for (const t of tables) {
        const cols = await conn.query(`SHOW FULL COLUMNS FROM \`${t}\``);
        tableSchemas.push({
          table: t,
          columns: cols.map((c: any) => ({
            name: c.Field,
            type: c.Type,
            primaryKey: c.Key === "PRI",
            nullable: c.Null === "YES",
          })),
        });
      }

      const fkSql = `
        SELECT TABLE_NAME as fromTable, COLUMN_NAME as fromColumn, REFERENCED_TABLE_NAME as toTable, REFERENCED_COLUMN_NAME as toColumn
        FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = ? AND REFERENCED_TABLE_NAME IS NOT NULL;
      `;
      const fks = await conn.query(fkSql, [database]);
      await conn.release();
      res.json({ tables: tableSchemas, relationships: fks });
    } else {
      // Postgres
      const client = pool as any;
      const tablesRes = await client.query("SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public';");
      const tables = tablesRes.rows.map((r: any) => r.tablename);

      const tableSchemas: any[] = [];
      for (const t of tables) {
        const colsRes = await client.query(
          "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = $1 AND table_schema = 'public'",
          [t]
        );
        tableSchemas.push({
          table: t,
          columns: colsRes.rows.map((c: any) => ({
            name: c.column_name,
            type: c.data_type,
            primaryKey: false,
            nullable: true,
          })),
        });
      }
      res.json({ tables: tableSchemas, relationships: [] });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Dump SQL
router.post("/dump-sql", async (req: Request, res: Response) => {
  try {
    const config = getDBConfig(req);
    const { database, table, includeStructure = true, includeData = true } = req.body;
    const pool = DBPoolManager.getPool({ ...config, database: database || config.database });

    let sqlDump = `-- dodb Export SQL Dump\n-- Date: ${new Date().toISOString()}\n\n`;

    if (config.type === "sqlite") {
      const db = pool as Database.Database;
      if (includeStructure) {
        const sqlRow = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name=?`).get(table) as { sql: string };
        if (sqlRow && sqlRow.sql) {
          sqlDump += `${sqlRow.sql};\n\n`;
        }
      }
      if (includeData) {
        const rows = db.prepare(`SELECT * FROM "${table.replace(/"/g, '""')}"`).all() as any[];
        if (rows.length > 0) {
          const keys = Object.keys(rows[0]);
          rows.forEach((r) => {
            const vals = keys.map((k) => {
              const v = r[k];
              if (v === null || v === undefined) return "NULL";
              if (typeof v === "number") return v;
              return `'${String(v).replace(/'/g, "''")}'`;
            });
            sqlDump += `INSERT INTO "${table}" (${keys.map((k) => `"${k}"`).join(", ")}) VALUES (${vals.join(", ")});\n`;
          });
        }
      }
    } else if (config.type === "mariadb") {
      const conn = await (pool as any).getConnection();
      await conn.query(`USE \`${database}\``);
      if (includeStructure) {
        const createRes = await conn.query(`SHOW CREATE TABLE \`${table}\``);
        const createSql = createRes[0]["Create Table"];
        sqlDump += `${createSql};\n\n`;
      }
      if (includeData) {
        const rows = await conn.query(`SELECT * FROM \`${table}\``);
        if (rows.length > 0) {
          const keys = Object.keys(rows[0]);
          rows.forEach((r: any) => {
            const vals = keys.map((k) => {
              const v = r[k];
              if (v === null || v === undefined) return "NULL";
              if (typeof v === "number") return v;
              return `'${String(v).replace(/'/g, "''")}'`;
            });
            sqlDump += `INSERT INTO \`${table}\` (${keys.map((k) => `\`${k}\``).join(", ")}) VALUES (${vals.join(", ")});\n`;
          });
        }
      }
      await conn.release();
    } else {
      // Postgres
      if (includeStructure) {
        const colRes = await (pool as any).query(
          "SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position",
          [table]
        );
        const colDefs = colRes.rows.map((c: any) => `"${c.column_name}" ${c.data_type} ${c.is_nullable === "NO" ? "NOT NULL" : ""}`).join(",\n  ");
        sqlDump += `CREATE TABLE IF NOT EXISTS "${table}" (\n  ${colDefs}\n);\n\n`;
      }
      if (includeData) {
        const rowRes = await (pool as any).query(`SELECT * FROM "${table}"`);
        if (rowRes.rows.length > 0) {
          const keys = Object.keys(rowRes.rows[0]);
          rowRes.rows.forEach((r: any) => {
            const vals = keys.map((k) => {
              const v = r[k];
              if (v === null || v === undefined) return "NULL";
              if (typeof v === "number") return v;
              return `'${String(v).replace(/'/g, "''")}'`;
            });
            sqlDump += `INSERT INTO "${table}" (${keys.map((k) => `"${k}"`).join(", ")}) VALUES (${vals.join(", ")});\n`;
          });
        }
      }
    }

    res.json({ sql: sqlDump });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Export CSV
router.post("/export-csv", async (req: Request, res: Response) => {
  try {
    const config = getDBConfig(req);
    const { database, table } = req.body;
    if (!table) {
      res.status(400).json({ error: "Missing 'table'" });
      return;
    }

    const pool = DBPoolManager.getPool({ ...config, database: database || config.database });
    let rows: any[] = [];
    if (config.type === "sqlite") {
      const db = pool as Database.Database;
      rows = db.prepare(`SELECT * FROM "${table.replace(/"/g, '""')}"`).all() as any[];
    } else if (config.type === "mariadb") {
      const conn = await (pool as any).getConnection();
      await conn.query(`USE \`${database}\``);
      rows = await conn.query(`SELECT * FROM \`${table}\``);
      await conn.release();
    } else {
      const result = await (pool as any).query(`SELECT * FROM "${table}"`);
      rows = result.rows;
    }

    if (rows.length === 0) {
      res.json({ csv: "" });
      return;
    }

    const headers = Object.keys(rows[0]);
    let csv = headers.map((h) => `"${h}"`).join(",") + "\n";
    rows.forEach((r) => {
      const line = headers
        .map((h) => {
          const v = r[h];
          if (v === null || v === undefined) return '""';
          return `"${String(v).replace(/"/g, '""')}"`;
        })
        .join(",");
      csv += line + "\n";
    });

    res.json({ csv });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DDL: Create Table
router.post("/create-table", async (req: Request, res: Response) => {
  const start = Date.now();
  try {
    const config = getDBConfig(req);
    const { database, table, columns } = req.body;
    if (!table || !Array.isArray(columns) || columns.length === 0) {
      res.status(400).json({ error: "Invalid parameters for create-table" });
      return;
    }

    const pool = DBPoolManager.getPool({ ...config, database: database || config.database });
    let sql = "";
    if (config.type === "sqlite") {
      const colDefs = columns.map((c: any) => `"${c.name}" ${c.type || "TEXT"} ${c.primaryKey ? "PRIMARY KEY" : ""} ${c.nullable ? "" : "NOT NULL"}`).join(", ");
      sql = `CREATE TABLE "${table}" (${colDefs})`;
      (pool as Database.Database).prepare(sql).run();
    } else if (config.type === "mariadb") {
      const colDefs = columns.map((c: any) => `\`${c.name}\` ${c.type} ${c.primaryKey ? "PRIMARY KEY" : ""} ${c.nullable ? "" : "NOT NULL"}`).join(", ");
      sql = `CREATE TABLE \`${table}\` (${colDefs})`;
      const conn = await (pool as any).getConnection();
      await conn.query(`USE \`${database}\``);
      await conn.query(sql);
      await conn.release();
    } else {
      const colDefs = columns.map((c: any) => `"${c.name}" ${c.type} ${c.primaryKey ? "PRIMARY KEY" : ""} ${c.nullable ? "" : "NOT NULL"}`).join(", ");
      sql = `CREATE TABLE "${table}" (${colDefs})`;
      await (pool as any).query(sql);
    }

    addAuditLog({
      profileId: config.id,
      profileName: config.name,
      dbType: config.type,
      database: config.database,
      actionType: "DDL",
      sql,
      status: "SUCCESS",
      executionTimeMs: Date.now() - start,
    });

    res.json({ success: true, message: `Table '${table}' created` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DDL: Drop Table
router.post("/drop-table", async (req: Request, res: Response) => {
  const start = Date.now();
  try {
    const config = getDBConfig(req);
    const { database, table } = req.body;
    if (!table) {
      res.status(400).json({ error: "Missing parameters" });
      return;
    }

    const pool = DBPoolManager.getPool({ ...config, database: database || config.database });
    let sql = "";
    if (config.type === "sqlite") {
      sql = `DROP TABLE "${table}"`;
      (pool as Database.Database).prepare(sql).run();
    } else if (config.type === "mariadb") {
      sql = `DROP TABLE \`${table}\``;
      const conn = await (pool as any).getConnection();
      await conn.query(`USE \`${database}\``);
      await conn.query(sql);
      await conn.release();
    } else {
      sql = `DROP TABLE "${table}"`;
      await (pool as any).query(sql);
    }

    addAuditLog({
      profileId: config.id,
      profileName: config.name,
      dbType: config.type,
      database: config.database,
      actionType: "DDL",
      sql,
      status: "SUCCESS",
      executionTimeMs: Date.now() - start,
    });

    res.json({ success: true, message: `Table '${table}' dropped` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DDL: Add Column
router.post("/add-column", async (req: Request, res: Response) => {
  const start = Date.now();
  try {
    const config = getDBConfig(req);
    const { database, table, columnName, columnType } = req.body;
    if (!table || !columnName || !columnType) {
      res.status(400).json({ error: "Missing parameters" });
      return;
    }

    const pool = DBPoolManager.getPool({ ...config, database: database || config.database });
    let sql = "";
    if (config.type === "sqlite") {
      sql = `ALTER TABLE "${table}" ADD COLUMN "${columnName}" ${columnType}`;
      (pool as Database.Database).prepare(sql).run();
    } else if (config.type === "mariadb") {
      sql = `ALTER TABLE \`${table}\` ADD COLUMN \`${columnName}\` ${columnType}`;
      const conn = await (pool as any).getConnection();
      await conn.query(`USE \`${database}\``);
      await conn.query(sql);
      await conn.release();
    } else {
      sql = `ALTER TABLE "${table}" ADD COLUMN "${columnName}" ${columnType}`;
      await (pool as any).query(sql);
    }

    addAuditLog({
      profileId: config.id,
      profileName: config.name,
      dbType: config.type,
      database: config.database,
      actionType: "DDL",
      sql,
      status: "SUCCESS",
      executionTimeMs: Date.now() - start,
    });

    res.json({ success: true, message: `Column '${columnName}' added to '${table}'` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DDL: Drop Column
router.post("/drop-column", async (req: Request, res: Response) => {
  const start = Date.now();
  try {
    const config = getDBConfig(req);
    const { database, table, columnName } = req.body;
    if (!table || !columnName) {
      res.status(400).json({ error: "Missing parameters" });
      return;
    }

    const pool = DBPoolManager.getPool({ ...config, database: database || config.database });
    let sql = "";
    if (config.type === "sqlite") {
      sql = `ALTER TABLE "${table}" DROP COLUMN "${columnName}"`;
      (pool as Database.Database).prepare(sql).run();
    } else if (config.type === "mariadb") {
      sql = `ALTER TABLE \`${table}\` DROP COLUMN \`${columnName}\``;
      const conn = await (pool as any).getConnection();
      await conn.query(`USE \`${database}\``);
      await conn.query(sql);
      await conn.release();
    } else {
      sql = `ALTER TABLE "${table}" DROP COLUMN "${columnName}"`;
      await (pool as any).query(sql);
    }

    addAuditLog({
      profileId: config.id,
      profileName: config.name,
      dbType: config.type,
      database: config.database,
      actionType: "DDL",
      sql,
      status: "SUCCESS",
      executionTimeMs: Date.now() - start,
    });

    res.json({ success: true, message: `Column '${columnName}' dropped from '${table}'` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
