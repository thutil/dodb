import express, { Request, Response } from "express";
import { DBConfig, DBPoolManager } from "../db/connections";
import { getProfileById } from "../config/dbProfiles";

const router = express.Router();

function getDBConfig(req: Request): DBConfig {
  const profileId = req.body.profileId || req.body.id;
  if (profileId) {
    const profile = getProfileById(profileId);
    if (profile) {
      return {
        ...profile,
        database: req.body.database || profile.database,
      };
    }
  }
  const { type, host, port, user, password = "", database } = req.body;
  if (!type || !host || !port || !user || !database) {
    throw new Error("Missing database configuration parameter");
  }
  if (!(type === "mariadb" || type === "postgres")) {
    throw new Error("Database type must be 'mariadb' or 'postgres'");
  }
  return {
    id: "-",
    name: "-",
    type,
    host,
    port,
    user,
    password: password || "",
    database,
    createdAt: "",
    updatedAt: "",
  };
}

// List databases
router.post("/databases", async (req: Request, res: Response) => {
  try {
    const config = getDBConfig(req);
    const pool = DBPoolManager.getPool(config);
    let sql;
    if (config.type === "mariadb") {
      sql = "SHOW DATABASES";
      const conn = await (pool as any).getConnection();
      const result = await conn.query(sql);
      await conn.release();
      res.json(result.map((row: any) => row.Database));
    } else {
      sql = "SELECT datname FROM pg_database WHERE datistemplate = false;";
      const result = await (pool as any).query(sql);
      res.json(result.rows.map((row: any) => row.datname));
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
    if (!database) {
      res.status(400).json({ error: "Missing 'database' in body" });
      return;
    }

    const pool = DBPoolManager.getPool({ ...config, database });

    let sql;
    if (config.type === "mariadb") {
      sql = "SHOW TABLES";
      const conn = await (pool as any).getConnection();
      await conn.query(`USE \`${database}\``); // เปลี่ยน DB หากจำเป็น
      const result = await conn.query(sql);
      await conn.release();
      res.json({ tables: result.map((row: any) => Object.values(row)[0]) });
    } else {
      sql = `SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public';`;
      // สำหรับ PostgreSQL จะ connect ที่ database ที่ต้องการเลย
      const result = await (pool as any).query(sql);
      res.json({ tables: result.rows.map((row: any) => row.tablename) });
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
    if (!database || !table) {
      res.status(400).json({ error: "Missing 'database' or 'table' in body" });
      return;
    }

    const pool = DBPoolManager.getPool({ ...config, database });

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
    } else {
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
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Helper to quote SQL identifiers securely
function quoteIdent(name: string, type: "mariadb" | "postgres"): string {
  const clean = name.replace(/[^a-zA-Z0-9_]/g, "");
  return type === "mariadb" ? `\`${clean}\`` : `"${clean}"`;
}

// Fetch table rows with pagination, sorting, search, and filtering
router.post("/rows", async (req: Request, res: Response) => {
  try {
    const config = getDBConfig(req);
    const { database, table, limit = 50, offset = 0, sortColumn, sortOrder = "ASC", search, filters } = req.body;
    if (!database || !table) {
      res.status(400).json({ error: "Missing 'database' or 'table' in body" });
      return;
    }

    const pool = DBPoolManager.getPool({ ...config, database });

    if (config.type === "mariadb") {
      const conn = await (pool as any).getConnection();
      await conn.query(`USE \`${database}\``);

      // Fetch table columns to enable global search
      const colsRes = await conn.query(`SHOW COLUMNS FROM \`${table}\``);
      const colNames: string[] = colsRes.map((c: any) => c.Field);

      const whereConditions: string[] = [];
      const whereParams: any[] = [];

      // 1. Process Column Filters
      if (Array.isArray(filters)) {
        for (const f of filters) {
          if (!f.column || !colNames.includes(f.column)) continue;
          const qCol = quoteIdent(f.column, "mariadb");
          const op = f.operator || "equals";
          const val = f.value;

          if (op === "isNull") {
            whereConditions.push(`${qCol} IS NULL`);
          } else if (op === "isNotNull") {
            whereConditions.push(`${qCol} IS NOT NULL`);
          } else if (op === "contains") {
            whereConditions.push(`${qCol} LIKE ?`);
            whereParams.push(`%${val}%`);
          } else if (op === "startsWith") {
            whereConditions.push(`${qCol} LIKE ?`);
            whereParams.push(`${val}%`);
          } else if (op === "endsWith") {
            whereConditions.push(`${qCol} LIKE ?`);
            whereParams.push(`%${val}`);
          } else if (op === "gt") {
            whereConditions.push(`${qCol} > ?`);
            whereParams.push(val);
          } else if (op === "gte") {
            whereConditions.push(`${qCol} >= ?`);
            whereParams.push(val);
          } else if (op === "lt") {
            whereConditions.push(`${qCol} < ?`);
            whereParams.push(val);
          } else if (op === "lte") {
            whereConditions.push(`${qCol} <= ?`);
            whereParams.push(val);
          } else if (op === "neq") {
            whereConditions.push(`${qCol} != ?`);
            whereParams.push(val);
          } else {
            // equals
            whereConditions.push(`${qCol} = ?`);
            whereParams.push(val);
          }
        }
      }

      // 2. Process Global Search
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
    } else {
      // PostgreSQL
      const colRes = await (pool as any).query(
        "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1",
        [table]
      );
      const colNames: string[] = colRes.rows.map((r: any) => r.column_name);

      const whereConditions: string[] = [];
      const whereParams: any[] = [];
      let pIdx = 1;

      // 1. Process Column Filters
      if (Array.isArray(filters)) {
        for (const f of filters) {
          if (!f.column || !colNames.includes(f.column)) continue;
          const qCol = quoteIdent(f.column, "postgres");
          const op = f.operator || "equals";
          const val = f.value;

          if (op === "isNull") {
            whereConditions.push(`${qCol} IS NULL`);
          } else if (op === "isNotNull") {
            whereConditions.push(`${qCol} IS NOT NULL`);
          } else if (op === "contains") {
            whereConditions.push(`${qCol}::text ILIKE $${pIdx++}`);
            whereParams.push(`%${val}%`);
          } else if (op === "startsWith") {
            whereConditions.push(`${qCol}::text ILIKE $${pIdx++}`);
            whereParams.push(`${val}%`);
          } else if (op === "endsWith") {
            whereConditions.push(`${qCol}::text ILIKE $${pIdx++}`);
            whereParams.push(`%${val}`);
          } else if (op === "gt") {
            whereConditions.push(`${qCol} > $${pIdx++}`);
            whereParams.push(val);
          } else if (op === "gte") {
            whereConditions.push(`${qCol} >= $${pIdx++}`);
            whereParams.push(val);
          } else if (op === "lt") {
            whereConditions.push(`${qCol} < $${pIdx++}`);
            whereParams.push(val);
          } else if (op === "lte") {
            whereConditions.push(`${qCol} <= $${pIdx++}`);
            whereParams.push(val);
          } else if (op === "neq") {
            whereConditions.push(`${qCol} != $${pIdx++}`);
            whereParams.push(val);
          } else {
            // equals
            whereConditions.push(`${qCol}::text = $${pIdx++}`);
            whereParams.push(val);
          }
        }
      }

      // 2. Process Global Search
      if (search && typeof search === "string" && search.trim() !== "" && colNames.length > 0) {
        const searchVal = `%${search.trim()}%`;
        const searchOrs: string[] = [];
        colNames.forEach((c) => {
          searchOrs.push(`${quoteIdent(c, "postgres")}::text ILIKE $${pIdx++}`);
          whereParams.push(searchVal);
        });
        whereConditions.push(`(${searchOrs.join(" OR ")})`);
      }

      const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(" AND ")}` : "";
      const orderClause = sortColumn && colNames.includes(sortColumn)
        ? `ORDER BY ${quoteIdent(sortColumn, "postgres")} ${sortOrder === "DESC" ? "DESC" : "ASC"}`
        : "";

      const countRes = await (pool as any).query(`SELECT COUNT(*) as total FROM "${table}" ${whereClause}`, whereParams);
      const total = Number(countRes.rows[0]?.total || 0);

      const queryParams = [...whereParams, Number(limit), Number(offset)];
      const query = `SELECT * FROM "${table}" ${whereClause} ${orderClause} LIMIT $${pIdx++} OFFSET $${pIdx++}`;
      const result = await (pool as any).query(query, queryParams);
      res.json({ rows: result.rows, total });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Fetch full Database Schema & Foreign Key Relations for ER Diagram
router.post("/schema-diagram", async (req: Request, res: Response) => {
  try {
    const config = getDBConfig(req);
    const { database } = req.body;
    if (!database) {
      res.status(400).json({ error: "Missing 'database' in body" });
      return;
    }

    const pool = DBPoolManager.getPool({ ...config, database });
    const tablesData: Array<{
      name: string;
      columns: Array<{ name: string; type: string; primaryKey: boolean }>;
    }> = [];
    const relations: Array<{
      fromTable: string;
      fromColumn: string;
      toTable: string;
      toColumn: string;
    }> = [];

    if (config.type === "mariadb") {
      const conn = await (pool as any).getConnection();
      await conn.query(`USE \`${database}\``);
      const tables = await conn.query("SHOW TABLES");
      const tableNames = tables.map((t: any) => Object.values(t)[0] as string);

      for (const tName of tableNames) {
        const cols = await conn.query(`SHOW COLUMNS FROM \`${tName}\``);
        tablesData.push({
          name: tName,
          columns: cols.map((c: any) => ({
            name: c.Field,
            type: c.Type,
            primaryKey: c.Key === "PRI",
          })),
        });
      }

      // Fetch Foreign Key Constraints
      const fkRows = await conn.query(
        `SELECT TABLE_NAME as from_table, COLUMN_NAME as from_column, REFERENCED_TABLE_NAME as to_table, REFERENCED_COLUMN_NAME as to_column FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = ? AND REFERENCED_TABLE_NAME IS NOT NULL`,
        [database]
      );
      await conn.release();

      fkRows.forEach((r: any) => {
        relations.push({
          fromTable: r.from_table,
          fromColumn: r.from_column,
          toTable: r.to_table,
          toColumn: r.to_column,
        });
      });
    } else {
      // PostgreSQL Schema
      const tblRes = await (pool as any).query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name"
      );
      const tableNames = tblRes.rows.map((r: any) => r.table_name);

      for (const tName of tableNames) {
        const colRes = await (pool as any).query(
          "SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position",
          [tName]
        );
        const pkRes = await (pool as any).query(
          "SELECT kcu.column_name FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_name = $1",
          [tName]
        );
        const pkCols = pkRes.rows.map((r: any) => r.column_name);

        tablesData.push({
          name: tName,
          columns: colRes.rows.map((c: any) => ({
            name: c.column_name,
            type: c.data_type,
            primaryKey: pkCols.includes(c.column_name),
          })),
        });
      }

      // Fetch Foreign Key Constraints
      const fkRes = await (pool as any).query(`
        SELECT
            kcu.table_name AS from_table,
            kcu.column_name AS from_column,
            ccu.table_name AS to_table,
            ccu.column_name AS to_column
        FROM information_schema.table_constraints AS tc
        JOIN information_schema.key_column_usage AS kcu
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage AS ccu
          ON ccu.constraint_name = tc.constraint_name
          AND ccu.table_schema = tc.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND tc.table_schema = 'public';
      `);

      fkRes.rows.forEach((r: any) => {
        relations.push({
          fromTable: r.from_table,
          fromColumn: r.from_column,
          toTable: r.to_table,
          toColumn: r.to_column,
        });
      });
    }

    // Infer relations based on naming conventions (e.g. user_id -> users.id) if explicit FKs not defined
    if (relations.length === 0) {
      const allTableMap = new Set(tablesData.map((t) => t.name));
      tablesData.forEach((t) => {
        t.columns.forEach((c) => {
          if (c.name.endsWith("_id") && !c.primaryKey) {
            const baseName = c.name.replace("_id", "");
            const pluralName = `${baseName}s`;
            const targetTable = allTableMap.has(pluralName)
              ? pluralName
              : allTableMap.has(baseName)
              ? baseName
              : null;
            if (targetTable && targetTable !== t.name) {
              relations.push({
                fromTable: t.name,
                fromColumn: c.name,
                toTable: targetTable,
                toColumn: "id",
              });
            }
          }
        });
      });
    }

    res.json({ tables: tablesData, relations });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Export Table Data / Structure to SQL Dump
router.post("/export-sql", async (req: Request, res: Response) => {
  try {
    const config = getDBConfig(req);
    const { database, table, includeStructure = true, includeData = true } = req.body;
    if (!database || !table) {
      res.status(400).json({ error: "Missing 'database' or 'table'" });
      return;
    }

    const pool = DBPoolManager.getPool({ ...config, database });
    let sqlDump = `-- dodb Database Export Dump\n-- Database: ${database}\n-- Table: ${table}\n-- Generated: ${new Date().toISOString()}\n\n`;

    if (config.type === "mariadb") {
      const conn = await (pool as any).getConnection();
      await conn.query(`USE \`${database}\``);

      if (includeStructure) {
        const createRes = await conn.query(`SHOW CREATE TABLE \`${table}\``);
        const createSql = createRes[0]?.["Create Table"] || "";
        sqlDump += `${createSql};\n\n`;
      }

      if (includeData) {
        const rows = await conn.query(`SELECT * FROM \`${table}\``);
        if (rows.length > 0) {
          const keys = Object.keys(rows[0]);
          sqlDump += `-- Dumping data for table \`${table}\`\n`;
          rows.forEach((r: any) => {
            const vals = keys.map((k) => {
              const v = r[k];
              if (v === null || v === undefined) return "NULL";
              if (typeof v === "number") return v;
              return `'${String(v).replace(/'/g, "''")}'`;
            });
            sqlDump += `INSERT INTO \`${table}\` (${keys.map((k) => `\`${k}\``).join(", ")}) VALUES (${vals.join(", ")});\n`;
          });
          sqlDump += "\n";
        }
      }
      await conn.release();
    } else {
      // PostgreSQL Dump
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
          sqlDump += `-- Dumping data for table "${table}"\n`;
          rowRes.rows.forEach((r: any) => {
            const vals = keys.map((k) => {
              const v = r[k];
              if (v === null || v === undefined) return "NULL";
              if (typeof v === "number") return v;
              return `'${String(v).replace(/'/g, "''")}'`;
            });
            sqlDump += `INSERT INTO "${table}" (${keys.map((k) => `"${k}"`).join(", ")}) VALUES (${vals.join(", ")});\n`;
          });
          sqlDump += "\n";
        }
      }
    }

    res.json({ sql: sqlDump });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Export Table Data to CSV
router.post("/export-csv", async (req: Request, res: Response) => {
  try {
    const config = getDBConfig(req);
    const { database, table } = req.body;
    if (!database || !table) {
      res.status(400).json({ error: "Missing 'database' or 'table'" });
      return;
    }

    const pool = DBPoolManager.getPool({ ...config, database });
    let rows: any[] = [];
    if (config.type === "mariadb") {
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
  try {
    const config = getDBConfig(req);
    const { database, table, columns } = req.body;
    if (!database || !table || !Array.isArray(columns) || columns.length === 0) {
      res.status(400).json({ error: "Invalid parameters for create-table" });
      return;
    }

    const pool = DBPoolManager.getPool({ ...config, database });
    let sql = "";
    if (config.type === "mariadb") {
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
    res.json({ success: true, message: `Table '${table}' created` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DDL: Drop Table
router.post("/drop-table", async (req: Request, res: Response) => {
  try {
    const config = getDBConfig(req);
    const { database, table } = req.body;
    if (!database || !table) {
      res.status(400).json({ error: "Missing parameters" });
      return;
    }

    const pool = DBPoolManager.getPool({ ...config, database });
    if (config.type === "mariadb") {
      const conn = await (pool as any).getConnection();
      await conn.query(`USE \`${database}\``);
      await conn.query(`DROP TABLE \`${table}\``);
      await conn.release();
    } else {
      await (pool as any).query(`DROP TABLE "${table}"`);
    }
    res.json({ success: true, message: `Table '${table}' dropped` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DDL: Add Column
router.post("/add-column", async (req: Request, res: Response) => {
  try {
    const config = getDBConfig(req);
    const { database, table, columnName, columnType } = req.body;
    if (!database || !table || !columnName || !columnType) {
      res.status(400).json({ error: "Missing parameters" });
      return;
    }

    const pool = DBPoolManager.getPool({ ...config, database });
    if (config.type === "mariadb") {
      const conn = await (pool as any).getConnection();
      await conn.query(`USE \`${database}\``);
      await conn.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${columnName}\` ${columnType}`);
      await conn.release();
    } else {
      await (pool as any).query(`ALTER TABLE "${table}" ADD COLUMN "${columnName}" ${columnType}`);
    }
    res.json({ success: true, message: `Column '${columnName}' added to '${table}'` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DDL: Drop Column
router.post("/drop-column", async (req: Request, res: Response) => {
  try {
    const config = getDBConfig(req);
    const { database, table, columnName } = req.body;
    if (!database || !table || !columnName) {
      res.status(400).json({ error: "Missing parameters" });
      return;
    }

    const pool = DBPoolManager.getPool({ ...config, database });
    if (config.type === "mariadb") {
      const conn = await (pool as any).getConnection();
      await conn.query(`USE \`${database}\``);
      await conn.query(`ALTER TABLE \`${table}\` DROP COLUMN \`${columnName}\``);
      await conn.release();
    } else {
      await (pool as any).query(`ALTER TABLE "${table}" DROP COLUMN "${columnName}"`);
    }
    res.json({ success: true, message: `Column '${columnName}' dropped from '${table}'` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

