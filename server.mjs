import { createServer } from 'node:http'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

const root = dirname(fileURLToPath(import.meta.url))
const databasePath = resolve(root, 'db/restaurant.json')
const port = Number(process.env.PORT || process.env.API_PORT || 8787)
const sessionDurationMs = 8 * 60 * 60 * 1000
const sessions = new Map()

async function readDatabase() {
  const database = JSON.parse(await readFile(databasePath, 'utf8'))
  database.inventory ||= [
    { id: 'inv-1', name: 'Tomates coeur de boeuf', quantity: 8, unit: 'kg', minimum: 10, supplier: 'Metro' },
    { id: 'inv-2', name: 'Filet de bar', quantity: 14, unit: 'pieces', minimum: 8, supplier: 'La Maree' },
    { id: 'inv-3', name: 'Beurre doux', quantity: 3, unit: 'kg', minimum: 5, supplier: 'Transgourmet' }
  ]
  database.menu ||= [
    { id: 'dish-1', name: 'Plat du jour', price: 18, image: 'https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=400&q=80', active: true },
    { id: 'dish-2', name: 'Filet de bar', price: 24, image: 'https://images.unsplash.com/photo-1519708227418-c8fd9a32b7a2?auto=format&fit=crop&w=400&q=80', active: true },
    { id: 'dish-3', name: 'Dessert maison', price: 9, image: 'https://images.unsplash.com/photo-1551024506-0bccd828d307?auto=format&fit=crop&w=400&q=80', active: true }
  ]
  return database
}

async function saveDatabase(database) {
  await writeFile(databasePath, JSON.stringify(database, null, 2) + '\n')
}

function send(response, status, payload) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': 'http://localhost:5173', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS' })
  response.end(JSON.stringify(payload))
}

async function serveFrontend(request, response, pathname) {
  const requestedPath = pathname === '/' ? '/index.html' : pathname
  const filePath = resolve(root, 'dist', `.${requestedPath}`)
  try {
    const content = await readFile(filePath)
    const contentType = filePath.endsWith('.html') ? 'text/html; charset=utf-8' : filePath.endsWith('.js') ? 'text/javascript; charset=utf-8' : filePath.endsWith('.css') ? 'text/css; charset=utf-8' : 'application/octet-stream'
    response.writeHead(200, { 'Content-Type': contentType })
    response.end(content)
  } catch {
    const app = await readFile(resolve(root, 'dist/index.html'))
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    response.end(app)
  }
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
    if (url.pathname === '/api/inventory' && request.method === 'GET') {
      if (!requireSession(request, response)) return
      return send(response, 200, database.inventory)
    }
    if (url.pathname === '/api/menu' && request.method === 'GET') {
      if (!requireSession(request, response)) return
      return send(response, 200, database.menu)
    }
    if (url.pathname === '/api/menu' && request.method === 'POST') {
      if (roleFrom(request) !== 'manager') return send(response, 403, { error: 'Seule la gérante peut modifier le menu' })
      const input = await body(request)
      if (!input.name || !input.price) return send(response, 400, { error: 'Nom et prix obligatoires' })
      const dish = { id: `dish-${Date.now()}`, name: input.name, price: Number(input.price), image: input.image || '', active: true }
      database.menu.push(dish)
      await saveDatabase(database)
      return send(response, 201, dish)
    }
    if (url.pathname === '/api/hardware/cash-drawer' && request.method === 'POST') {
      if (!['manager', 'cashier'].includes(roleFrom(request))) return send(response, 403, { error: 'Droits insuffisants' })
      return send(response, 200, { opened: true, message: 'Commande d’ouverture envoyée au tiroir-caisse' })
    }
    if (url.pathname.startsWith('/api/inventory/') && request.method === 'PATCH') {
      if (!['manager', 'kitchen'].includes(roleFrom(request))) return send(response, 403, { error: 'Droits insuffisants' })
      const item = database.inventory.find((entry) => entry.id === url.pathname.split('/').pop())
      if (!item) return send(response, 404, { error: 'Produit introuvable' })
      const input = await body(request)
      item.quantity = Number(input.quantity)
      await saveDatabase(database)
      return send(response, 200, item)
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
      const lines = input.items.map((item) => ({ name: item.name, quantity: Number(item.quantity), price: Number(item.price) }))
      const order = { id: String(1050 + database.orders.length), table: input.table, items: lines.reduce((sum, item) => sum + item.quantity, 0), amount: Number(input.amount || 0), status: 'received', note: input.note || '', lines, createdAt: new Date().toISOString() }
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
      const nextStatus = input.status
      const allowedStatuses = ['received', 'preparing', 'ready', 'paid']
      if (!allowedStatuses.includes(nextStatus)) return send(response, 400, { error: 'Statut de commande invalide' })
      if (nextStatus === 'paid' && !['manager', 'cashier'].includes(roleFrom(request))) return send(response, 403, { error: 'Seule la caisse peut encaisser' })
      if (['preparing', 'ready'].includes(nextStatus) && !['manager', 'kitchen'].includes(roleFrom(request))) return send(response, 403, { error: 'Seule la cuisine peut traiter cette commande' })
      order.status = nextStatus
      if (nextStatus === 'paid') order.paymentMethod = input.paymentMethod === 'cash' ? 'cash' : 'card'
      await saveDatabase(database)
      return send(response, 200, order)
    }
    if (request.method === 'GET') return serveFrontend(request, response, url.pathname)
    return send(response, 404, { error: 'Route introuvable' })
  } catch (error) {
    console.error(error)
    return send(response, 500, { error: 'Erreur interne de l’API' })
  }
})

server.listen(port, () => console.log(`Restaurant API listening on http://localhost:${port}`))
