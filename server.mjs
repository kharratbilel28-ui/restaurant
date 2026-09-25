import { createServer } from 'node:http'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

const root = dirname(fileURLToPath(import.meta.url))
const databasePath = resolve(root, 'db/restaurant.json')
const port = Number(process.env.API_PORT || 8787)
const sessionDurationMs = 8 * 60 * 60 * 1000
const sessions = new Map()

async function readDatabase() {
  return JSON.parse(await readFile(databasePath, 'utf8'))
}

async function saveDatabase(database) {
  await writeFile(databasePath, JSON.stringify(database, null, 2) + '\n')
}

function send(response, status, payload) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': 'http://localhost:5173', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS' })
  response.end(JSON.stringify(payload))
}

function sessionFrom(request) {
  const value = request.headers.authorization || ''
  if (!value.startsWith('Bearer ')) return null
  const token = value.slice(7)
  const session = sessions.get(token)
  if (!session || session.expiresAt <= Date.now()) {
    sessions.delete(token)
    return null
  }
  return { token, ...session }
}

function roleFrom(request) { return sessionFrom(request)?.role || null }
function requireSession(request, response) {
  const session = sessionFrom(request)
  if (!session) { send(response, 401, { error: 'Session absente ou expirée' }); return null }
  return session
}

async function body(request) {
  let content = ''
  for await (const chunk of request) content += chunk
  return content ? JSON.parse(content) : {}
}

const server = createServer(async (request, response) => {
  if (request.method === 'OPTIONS') return send(response, 204, {})
  const url = new URL(request.url || '/', `http://${request.headers.host}`)
  try {
    const database = await readDatabase()
    if (url.pathname === '/api/health') return send(response, 200, { ok: true, service: 'restaurant-api' })
    if (url.pathname === '/api/auth/login' && request.method === 'POST') {
      const input = await body(request)
      const user = database.users?.find((item) => item.role === input.role && item.pin === input.pin)
      if (!user) return send(response, 401, { error: 'Rôle ou code incorrect' })
      const token = randomUUID()
      const expiresAt = Date.now() + sessionDurationMs
      sessions.set(token, { userId: user.id, name: user.name, role: user.role, expiresAt })
      return send(response, 200, { token, expiresAt, user: { id: user.id, name: user.name, role: user.role } })
    }
    if (url.pathname === '/api/auth/me' && request.method === 'GET') {
      const session = requireSession(request, response)
      return session && send(response, 200, { user: { id: session.userId, name: session.name, role: session.role }, expiresAt: session.expiresAt })
    }
    if (url.pathname === '/api/auth/logout' && request.method === 'POST') {
      const session = sessionFrom(request)
      if (session) sessions.delete(session.token)
      return send(response, 204, {})
    }
    if (url.pathname === '/api/dashboard' && request.method === 'GET') {
      if (!requireSession(request, response)) return
      return send(response, 200, { reservations: database.reservations, orders: database.orders, tables: database.tables, stats: { reservations: 24, covers: 86, revenue: 2840, averageDuration: '1h42' } })
    }
    if (url.pathname === '/api/reservations' && request.method === 'GET') {
      if (!requireSession(request, response)) return
      return send(response, 200, database.reservations)
    }
    if (url.pathname === '/api/reservations' && request.method === 'POST') {
      if (!requireSession(request, response)) return
      const input = await body(request)
      if (!input.name || !input.time || !input.people) return send(response, 400, { error: 'name, time et people sont obligatoires' })
      const reservation = { id: `res-${Date.now()}`, name: input.name, time: input.time, people: Number(input.people), table: input.table || 'À attribuer', status: 'confirmed' }
      database.reservations.push(reservation)
      await saveDatabase(database)
      return send(response, 201, reservation)
    }
    if (url.pathname === '/api/orders' && request.method === 'POST') {
      if (!['manager', 'server'].includes(roleFrom(request))) return send(response, 403, { error: 'Droits insuffisants' })
      const input = await body(request)
      if (!input.table || !Array.isArray(input.items) || input.items.length === 0) return send(response, 400, { error: 'table et items sont obligatoires' })
      const order = { id: String(1050 + database.orders.length), table: input.table, items: input.items.length, amount: Number(input.amount || 0), status: 'kitchen', createdAt: new Date().toISOString() }
      database.orders.unshift(order)
      await saveDatabase(database)
      return send(response, 201, order)
    }
    if (url.pathname.startsWith('/api/orders/') && request.method === 'PATCH') {
      if (!sessionFrom(request)) return send(response, 401, { error: 'Session absente ou expirée' })
      if (!['manager', 'kitchen', 'cashier'].includes(roleFrom(request))) return send(response, 403, { error: 'Droits insuffisants' })
      const id = url.pathname.split('/').pop()
      const order = database.orders.find((item) => item.id === id)
      if (!order) return send(response, 404, { error: 'Commande introuvable' })
      const input = await body(request)
      order.status = input.status || order.status
      await saveDatabase(database)
      return send(response, 200, order)
    }
    return send(response, 404, { error: 'Route introuvable' })
  } catch (error) {
    console.error(error)
    return send(response, 500, { error: 'Erreur interne de l’API' })
  }
})

server.listen(port, () => console.log(`Restaurant API listening on http://localhost:${port}`))
