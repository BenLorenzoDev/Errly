// ============================================================================
// Errly — Database Connection Singleton
// Creates a Drizzle ORM instance over better-sqlite3 with WAL mode
// ============================================================================

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import { config } from '../config.js';

// ESM/CJS interop for better-sqlite3:
// better-sqlite3 is a native CJS addon. In ESM context the default import may
// resolve as { default: Database }. This fallback pattern handles both cases.
import pkg from 'better-sqlite3';
const Database = (pkg as any).default || pkg;

// Use config.dbPath for single source of truth (F13 fix)
const dbPath = config.dbPath;

// Ensure the data directory exists
mkdirSync(dirname(dbPath), { recursive: true });

// Create the SQLite database connection
const sqlite = new Database(dbPath);

// Enable WAL (Write-Ahead Logging) mode for concurrent read/write performance.
// WAL is critical for a service that writes errors while simultaneously reading
// for the dashboard.
sqlite.pragma('journal_mode = WAL');

// Create the Drizzle ORM wrapper with schema for relational queries
export const db = drizzle(sqlite, { schema });

// Export the raw better-sqlite3 instance for cases that need direct access
// (e.g., running raw SQL, closing the connection on shutdown)
export const sqliteDb = sqlite;
