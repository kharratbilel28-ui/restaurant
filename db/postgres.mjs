import { Pool } from 'pg'

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined })

export async function initPostgres(fallbackState) {
  await pool.query(`CREATE TABLE IF NOT EXISTS restaurant_state (id integer PRIMARY KEY, data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`)
  const result = await pool.query('SELECT data FROM restaurant_state WHERE id = 1')
  if (result.rowCount === 0) await pool.query('INSERT INTO restaurant_state (id, data) VALUES (1, $1::jsonb)', [JSON.stringify(fallbackState)])
}

export async function readPostgres() {
  const result = await pool.query('SELECT data FROM restaurant_state WHERE id = 1')
  return result.rows[0]?.data || null
}

export async function savePostgres(state) {
  await pool.query('UPDATE restaurant_state SET data = $1::jsonb, updated_at = now() WHERE id = 1', [JSON.stringify(state)])
}

export async function closePostgres() { await pool.end() }
