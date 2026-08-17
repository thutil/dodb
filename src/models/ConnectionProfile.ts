export type SupportedDB = "mariadb" | "postgres" | "sqlite";

export interface ConnectionProfile {
  id: string;
  name: string;
  type: SupportedDB;
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  filePath?: string;
  group?: string;
  createdAt: string; 
  updatedAt: string;
}