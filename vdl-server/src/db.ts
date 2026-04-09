import Database from 'better-sqlite3'
import { join, dirname } from 'path'
import { mkdirSync } from 'fs'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DB_PATH = join(__dirname, '..', 'data', 'vdl.db')

let db: Database.Database

export function initDB(): Database.Database {
  mkdirSync(dirname(DB_PATH), { recursive: true })
  db = new Database(DB_PATH)
  db.pragma('journal_mode = WAL')

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      telegram_id INTEGER UNIQUE NOT NULL,
      username TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      url TEXT NOT NULL,
      title TEXT,
      status TEXT NOT NULL DEFAULT 'queued',
      progress REAL NOT NULL DEFAULT 0,
      file_path TEXT,
      result_url TEXT,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(user_id);
    CREATE INDEX IF NOT EXISTS idx_users_telegram ON users(telegram_id);
  `)

  return db
}

export function getDB(): Database.Database {
  if (!db) throw new Error('Database not initialized')
  return db
}

// --- Users ---

export interface UserRow {
  id: number
  telegram_id: number
  username: string | null
  created_at: string
  updated_at: string
}

export function findUserByTelegramId(telegramId: number): UserRow | undefined {
  return getDB().prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId) as UserRow | undefined
}

export function createUser(telegramId: number, username?: string): UserRow {
  getDB().prepare(
    'INSERT OR IGNORE INTO users (telegram_id, username) VALUES (?, ?)'
  ).run(telegramId, username ?? null)
  return findUserByTelegramId(telegramId)!
}

// --- Tasks ---

export interface TaskRow {
  id: string
  user_id: number
  url: string
  title: string | null
  status: string
  progress: number
  file_path: string | null
  result_url: string | null
  error: string | null
  created_at: string
  updated_at: string
}

export function insertTask(task: { id: string; user_id: number; url: string }): void {
  getDB().prepare(
    'INSERT INTO tasks (id, user_id, url) VALUES (?, ?, ?)'
  ).run(task.id, task.user_id, task.url)
}

export function updateTask(id: string, updates: Partial<Pick<TaskRow, 'title' | 'status' | 'progress' | 'file_path' | 'result_url' | 'error'>>): void {
  const fields: string[] = ["updated_at = datetime('now')"]
  const values: unknown[] = []

  for (const [key, val] of Object.entries(updates)) {
    if (val !== undefined) {
      fields.push(`${key} = ?`)
      values.push(val)
    }
  }

  values.push(id)
  getDB().prepare(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`).run(...values)
}

export function getTask(id: string): TaskRow | undefined {
  return getDB().prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | undefined
}

export function getTasksByStatus(status: string): TaskRow[] {
  return getDB().prepare('SELECT * FROM tasks WHERE status = ?').all(status) as TaskRow[]
}

export function deleteTask(id: string): void {
  getDB().prepare('DELETE FROM tasks WHERE id = ?').run(id)
}
