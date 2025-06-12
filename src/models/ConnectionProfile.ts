export type SupportedDB = "mariadb" | "postgres";

export interface ConnectionProfile {
  id: string;
  name: string;
  type: SupportedDB;
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  createdAt: string; 
  updatedAt: string;
}