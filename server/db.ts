import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

let dbInstance: Database.Database | null = null;

export function initDatabase(): Database.Database {
  if (dbInstance) return dbInstance;

  const dbPath = process.env.DB_PATH || './data/shelflife.db';
  const dbDir = path.dirname(dbPath);

  // Ensure database directory exists
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  console.log(`Initializing SQLite database at: ${dbPath}`);
  const db = new Database(dbPath);

  // Enable Write-Ahead Logging (WAL) for high performance during concurrent reads/writes
  db.pragma('journal_mode = WAL');
  // Enable foreign key support
  db.pragma('foreign_keys = ON');

  // Create schema
  db.exec(`
    -- Core library item cache
    CREATE TABLE IF NOT EXISTS library_items (
      id TEXT PRIMARY KEY,
      library_id TEXT NOT NULL,
      title TEXT,
      author_name TEXT,
      narrator_name TEXT,
      series_name TEXT,
      series_sequence TEXT,
      duration REAL DEFAULT 0,
      published_year TEXT,
      genres TEXT,           -- JSON array string
      tags TEXT,             -- JSON array string
      added_at INTEGER,
      updated_at INTEGER,
      size INTEGER DEFAULT 0,
      num_audio_files INTEGER DEFAULT 0,
      has_cover INTEGER DEFAULT 0,
      description TEXT,
      publisher TEXT,
      language TEXT,
      isbn TEXT,
      asin TEXT,
      subtitle TEXT,
      abridged INTEGER DEFAULT 0,
      num_chapters INTEGER DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_items_library ON library_items(library_id);
    CREATE INDEX IF NOT EXISTS idx_items_updated ON library_items(updated_at);
    CREATE INDEX IF NOT EXISTS idx_items_added ON library_items(added_at);
    CREATE INDEX IF NOT EXISTS idx_items_title ON library_items(title COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_items_author ON library_items(author_name COLLATE NOCASE);

    -- Listening sessions cache
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      username TEXT NOT NULL,
      library_id TEXT,
      library_item_id TEXT,
      duration REAL DEFAULT 0,
      time_listening REAL DEFAULT 0,
      started_at INTEGER NOT NULL,
      updated_at INTEGER,
      current_time REAL DEFAULT 0,
      progress REAL DEFAULT 0,
      client_name TEXT,
      genres TEXT,           -- JSON array string of genres
      raw_data TEXT          -- Full JSON blob fallback
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at);

    -- Sync state tracking per library
    CREATE TABLE IF NOT EXISTS sync_state (
      library_id TEXT PRIMARY KEY,
      last_full_sync INTEGER,
      last_incremental_sync INTEGER,
      total_items INTEGER DEFAULT 0
    );

    -- General metadata/sync settings
    CREATE TABLE IF NOT EXISTS sync_meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  dbInstance = db;
  return db;
}

export function getDatabase(): Database.Database {
  if (!dbInstance) {
    return initDatabase();
  }
  return dbInstance;
}
