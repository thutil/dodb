import { Pool as MariaPool, createPool as createMariaPool } from "mariadb";
import { Pool as PgPool } from "pg";
import { ConnectionProfile, SupportedDB } from "../models/ConnectionProfile";

type DBConfig = ConnectionProfile;

class DBPoolManager {
  private static pools: Map<string, MariaPool | PgPool> = new Map();

  static getPool(config: DBConfig) {
    const key = `${config.type}-${config.host}-${config.port}-${config.user}-${config.database}`;
    if (this.pools.has(key)) {
      return this.pools.get(key)!;
    }
    let pool;
    if (config.type === "mariadb") {
      pool = createMariaPool({
        host: config.host,
        port: config.port,
        user: config.user,
        password: config.password,
        database: config.database,
        connectionLimit: 5,
      });
    } else if (config.type === "postgres") {
      pool = new PgPool({
        host: config.host,
        port: config.port,
        user: config.user,
        password: config.password,
        database: config.database,
        max: 5,
      });
    } else {
      throw new Error("Unsupported database type");
    }
    this.pools.set(key, pool);
    return pool;
  }
}

export { DBConfig, DBPoolManager };