import { createServer } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { createInvoicePostgres, createProfilePostgres, createSubscriptionPlanPostgres, findRestaurantByIdentifier, findUserByCredentials, getInvoicePostgres, initPostgres, listManagedRestaurantsPostgres, listProfilesPostgres, listSubscriptionPlansPostgres, markInvoiceEmailed, readPostgres, registerRestaurantPostgres, savePostgres, updateManagedRestaurantPostgres, updateRestaurantSubscriptionPostgres } from './db/postgres.mjs'
import PDFDocument from 'pdfkit'
import nodemailer from 'nodemailer'

const root = dirname(fileURLToPath(import.meta.url))
const databasePath = resolve(root, 'db/restaurant.json')
const tenantCredentialsPath = resolve(root, 'db/tenant-credentials.json')
const tenantDatabaseDirectory = resolve(root, 'db/tenants')
const subscriptionPlansPath = resolve(root, 'db/subscription-plans.json')
const port = Number(process.env.PORT || process.env.API_PORT || 8787)
const sessionDurationMs = 8 * 60 * 60 * 1000
const sessions = new Map()
const restaurantAccessSessions = new Map()
const platformSessions = new Map()
const receiptReviewsInProgress = new Set()
const scrypt = promisify(scryptCallback)
let invoiceCreationQueue = Promise.resolve()
const usePostgres = Boolean(process.env.DATABASE_URL)
const defaultRestaurantId = 'restaurant-demo'
const defaultSubscriptionPlans = [
  { id: 'trial-14', name: 'Essai 14 jours', durationDays: 14, price: 0, currency: 'EUR', active: true },
  { id: 'monthly-30', name: 'Mensuel', durationDays: 30, price: 29, currency: 'EUR', active: true },
  { id: 'annual-365', name: 'Annuel', durationDays: 365, price: 290, currency: 'EUR', active: true },
]

function databasePathFor(restaurantId) { return restaurantId === defaultRestaurantId ? databasePath : resolve(tenantDatabaseDirectory, `${restaurantId}.json`) }
function newRestaurantId(value) { return String(value || '').trim().toLowerCase() }
function validRestaurantIdentifier(value) {
  if (value.length > 254) return false
  const slug = /^[a-z0-9][a-z0-9-]{2,39}$/
  const email = /^[a-z0-9.!#$%&'*+?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/
  return slug.test(value) || email.test(value)
}

async function hashPassword(password) {
  const salt = randomBytes(16)
  const key = await scrypt(password, salt, 64)
  return `${salt.toString('hex')}:${key.toString('hex')}`
}

async function verifyPassword(password, storedHash) {
  const [saltHex, keyHex] = String(storedHash || '').split(':')
  if (!/^[0-9a-f]{32}$/.test(saltHex || '') || !/^[0-9a-f]{128}$/.test(keyHex || '')) return false
  const expected = Buffer.from(keyHex, 'hex')
  const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length)
  return timingSafeEqual(expected, actual)
}

async function readTenantCredentials() {
  try { return JSON.parse(await readFile(tenantCredentialsPath, 'utf8')) }
  catch (error) { if (error.code === 'ENOENT') return []; throw error }
}

async function writeTenantCredentials(credentials) {
  await writeFile(tenantCredentialsPath, JSON.stringify(credentials, null, 2) + '\n')
}

async function readSubscriptionPlans() {
  if (usePostgres) return listSubscriptionPlansPostgres()
  try { return JSON.parse(await readFile(subscriptionPlansPath, 'utf8')) }
  catch (error) { if (error.code === 'ENOENT') return defaultSubscriptionPlans; throw error }
}

async function writeSubscriptionPlans(plans) {
  await writeFile(subscriptionPlansPath, JSON.stringify(plans, null, 2) + '\n')
}

function safeEqualStrings(left, right) {
  const leftBuffer = Buffer.from(String(left || ''))
  const rightBuffer = Buffer.from(String(right || ''))
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}

async function provisionRestaurant({ identifier, name, password, managerUsername, managerName, managerPin }, plan) {
  const passwordHash = await hashPassword(password)
  const startedAt = new Date()
  const expiresAt = new Date(startedAt.getTime() + plan.durationDays * 24 * 60 * 60 * 1000)
  const manager = { id: `user-${randomUUID()}`, username: managerUsername, name: managerName, role: 'manager', pin: managerPin }
  if (usePostgres) {
    const restaurant = await registerRestaurantPostgres({ id: identifier, identifier, name, passwordHash, manager, planId: plan.id, startedAt, expiresAt })
    return { ...restaurant, planId: plan.id, planName: plan.name, startedAt, expiresAt, status: 'active', accessConfigured: true }
  }
  const credentials = await readTenantCredentials()
  if (credentials.some((item) => item.identifier === identifier)) {
    const error = new Error('Cet identifiant restaurant est déjà utilisé')
    error.code = 'RESTAURANT_EXISTS'
    throw error
  }
  const path = databasePathFor(identifier)
  let existingState = null
  try { existingState = JSON.parse(await readFile(path, 'utf8')) } catch (error) { if (error.code !== 'ENOENT') throw error }
  if (identifier === defaultRestaurantId) {
    const state = await readDatabase(identifier)
    if (state.users.some((user) => (user.username || user.id).toLowerCase() === managerUsername)) {
      const error = new Error('Ce nom d’utilisateur existe déjà dans ce restaurant')
      error.code = '23505'
      throw error
    }
    state.users.push(manager)
    await saveDatabase(state, identifier)
  } else {
    if (existingState) {
      const error = new Error('Un espace existe déjà sous cet identifiant; contactez le support.')
      error.code = 'RESTAURANT_EXISTS'
      throw error
    }
    const state = { reservations: [], users: [manager], orders: [], tables: [], inventory: [], menu: [], stockWithdrawals: [], stockReceipts: [], invoices: [], invoiceCounters: {}, floorPlan: null }
    await mkdir(tenantDatabaseDirectory, { recursive: true })
    await writeFile(path, JSON.stringify(state, null, 2) + '\n')
  }
  credentials.push({ id: identifier, identifier, name, passwordHash, planId: plan.id, planName: plan.name, startedAt: startedAt.toISOString(), expiresAt: expiresAt.toISOString(), status: 'active' })
  await writeTenantCredentials(credentials)
  return { id: identifier, identifier, name, planId: plan.id, planName: plan.name, startedAt: startedAt.toISOString(), expiresAt: expiresAt.toISOString(), status: 'active', accessConfigured: true }
}

async function getPlatformOverview() {
  const plans = await readSubscriptionPlans()
  let restaurants
  if (usePostgres) restaurants = await listManagedRestaurantsPostgres()
  else {
    const credentials = await readTenantCredentials()
    restaurants = credentials.map(({ passwordHash, ...item }) => ({ ...item, planName: plans.find((plan) => plan.id === item.planId)?.name || null, startedAt: item.startedAt || null, expiresAt: item.expiresAt || null, status: item.status || 'active', accessConfigured: true }))
    if (!restaurants.some((item) => item.id === defaultRestaurantId)) restaurants.push({ id: defaultRestaurantId, identifier: defaultRestaurantId, name: 'Le Mijoté', planId: null, planName: null, startedAt: null, expiresAt: null, status: 'active', accessConfigured: false })
  }
  return { restaurants, plans }
}

async function setRestaurantSubscription(id, plan, status) {
  if (usePostgres) return updateRestaurantSubscriptionPostgres(id, plan, status)
  const credentials = await readTenantCredentials()
  const restaurant = credentials.find((item) => item.id === id)
  if (!restaurant) return null
  if (status === 'suspended') restaurant.status = 'suspended'
  else {
    const startedAt = new Date()
    restaurant.planId = plan.id
    restaurant.planName = plan.name
    restaurant.startedAt = startedAt.toISOString()
    restaurant.expiresAt = new Date(startedAt.getTime() + plan.durationDays * 86400000).toISOString()
    restaurant.status = 'active'
  }
  await writeTenantCredentials(credentials)
  return { id, planId: restaurant.planId, planName: restaurant.planName, startedAt: restaurant.startedAt, expiresAt: restaurant.expiresAt, status: restaurant.status }
}

function platformSessionFrom(request) {
  const token = request.headers['x-platform-access'] || ''
  const session = platformSessions.get(token)
  if (!session || session.expiresAt <= Date.now()) {
    platformSessions.delete(token)
    return null
  }
  return { token, ...session }
}

function requirePlatformOwner(request, response) {
  const session = platformSessionFrom(request)
  if (!session) { send(response, 401, { error: 'Session propriétaire absente ou expirée' }); return null }
  return session
}

function revokeRestaurantSessions(restaurantId) {
  for (const [token, session] of restaurantAccessSessions) if (session.restaurantId === restaurantId) restaurantAccessSessions.delete(token)
  for (const [token, session] of sessions) if (session.restaurantId === restaurantId) sessions.delete(token)
}

async function readDatabase(restaurantId = defaultRestaurantId) {
  const database = usePostgres ? await readPostgres(restaurantId) : JSON.parse(await readFile(databasePathFor(restaurantId), 'utf8'))
  database.reservations ||= []
  database.users ||= []
  database.orders ||= []
  database.tables ||= []
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
  database.stockWithdrawals ||= []
  database.stockReceipts ||= []
  database.invoices ||= []
  database.invoiceCounters ||= {}
  database.floorPlan ||= null
  if (database.floorPlan) database.floorPlan = { ...database.floorPlan, pdfData: '' }
  for (const order of database.orders) if (order.status === 'kitchen') order.status = 'received'
  return database
}

async function saveDatabase(database, restaurantId = defaultRestaurantId) {
  if (usePostgres) return savePostgres(restaurantId, database)
  const path = databasePathFor(restaurantId)
  if (restaurantId !== defaultRestaurantId) await mkdir(tenantDatabaseDirectory, { recursive: true })
  return writeFile(path, JSON.stringify(database, null, 2) + '\n')
}

function send(response, status, payload) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': 'http://localhost:5173', 'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Restaurant-Access, X-Platform-Access', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS' })
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
  if (!session || session.expiresAt <= Date.now() || session.subscriptionStatus === 'suspended' || (session.subscriptionExpiresAt && new Date(session.subscriptionExpiresAt).getTime() <= Date.now())) {
    sessions.delete(token)
    return null
  }
  return { token, ...session }
}

function restaurantAccessFrom(request) {
  const token = request.headers['x-restaurant-access'] || ''
  const session = restaurantAccessSessions.get(token)
  if (!session || session.expiresAt <= Date.now() || session.subscriptionStatus === 'suspended' || (session.subscriptionExpiresAt && new Date(session.subscriptionExpiresAt).getTime() <= Date.now())) {
    restaurantAccessSessions.delete(token)
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

function money(value) { return Math.round((Number(value) + Number.EPSILON) * 100) / 100 }
function escapeHtml(value) { return String(value || '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]) }
function invoicePdf(invoice) {
  return new Promise((resolvePdf, rejectPdf) => {
    const document = new PDFDocument({ size: 'A4', margin: 48 })
    const chunks = []
    document.on('data', (chunk) => chunks.push(chunk))
    document.on('end', () => resolvePdf(Buffer.concat(chunks)))
    document.on('error', rejectPdf)
    document.font('Helvetica').fontSize(22).text('FACTURE', { align: 'right' })
    document.moveDown().fontSize(12).text(invoice.seller.name, { continued: false })
    document.fontSize(9).text(invoice.seller.address).text(`SIREN/SIRET : ${invoice.seller.siren}`)
    if (invoice.seller.vatNumber) document.text(`TVA intracommunautaire : ${invoice.seller.vatNumber}`)
    document.moveDown().fontSize(14).text(invoice.invoiceNumber).fontSize(10).text(`Date : ${new Date(invoice.issuedAt).toLocaleDateString('fr-FR')}`)
    document.moveDown().fontSize(12).text('Facturé à').fontSize(10).text(invoice.buyer.name).text(invoice.buyer.address || '')
    document.moveDown().fontSize(10).text('Désignation                                      Qté      PU TTC       TVA        Total TTC')
    document.moveDown(0.5)
    for (const line of invoice.lines) document.text(`${line.name}   ${line.quantity}   ${line.unitPrice.toFixed(2)} €   ${line.vatRate}%   ${line.grossAmount.toFixed(2)} €`)
    document.moveDown().text(`Total HT : ${invoice.totalNet.toFixed(2)} €`, { align: 'right' })
    document.text(`TVA : ${invoice.totalVat.toFixed(2)} €`, { align: 'right' })
    document.fontSize(12).text(`Total TTC : ${invoice.totalGross.toFixed(2)} €`, { align: 'right' })
    document.end()
  })
}

async function serializeInvoiceCreation(operation) {
  const previous = invoiceCreationQueue
  let release
  invoiceCreationQueue = new Promise((resolveQueue) => { release = resolveQueue })
  await previous
  try { return await operation() } finally { release() }
}

const server = createServer(async (request, response) => {
  if (request.method === 'OPTIONS') return send(response, 204, {})
  const url = new URL(request.url || '/', `http://${request.headers.host}`)
  try {
    if (url.pathname === '/api/health') return send(response, 200, { ok: true, service: 'restaurant-api', storage: usePostgres ? 'postgresql' : 'local-json' })
    if (url.pathname === '/api/platform/login' && request.method === 'POST') {
      if (!process.env.PLATFORM_OWNER_USERNAME || !process.env.PLATFORM_OWNER_PASSWORD) return send(response, 503, { error: 'Configurez PLATFORM_OWNER_USERNAME et PLATFORM_OWNER_PASSWORD dans l’environnement du serveur.' })
      const input = await body(request)
      if (!safeEqualStrings(input.username, process.env.PLATFORM_OWNER_USERNAME) || !safeEqualStrings(input.password, process.env.PLATFORM_OWNER_PASSWORD)) return send(response, 401, { error: 'Identifiants propriétaire incorrects' })
      const token = randomUUID()
      const expiresAt = Date.now() + sessionDurationMs
      platformSessions.set(token, { name: 'Propriétaire plateforme', expiresAt })
      return send(response, 200, { token, expiresAt, owner: { name: 'Propriétaire plateforme' } })
    }
    if (url.pathname === '/api/platform/me' && request.method === 'GET') {
      const owner = requirePlatformOwner(request, response)
      return owner && send(response, 200, { owner: { name: owner.name }, expiresAt: owner.expiresAt })
    }
    if (url.pathname === '/api/platform/logout' && request.method === 'POST') {
      const owner = platformSessionFrom(request)
      if (owner) platformSessions.delete(owner.token)
      return send(response, 204, {})
    }
    if (url.pathname === '/api/platform/overview' && request.method === 'GET') {
      if (!requirePlatformOwner(request, response)) return
      return send(response, 200, await getPlatformOverview())
    }
    if (url.pathname === '/api/platform/plans' && request.method === 'POST') {
      if (!requirePlatformOwner(request, response)) return
      const input = await body(request)
      const name = String(input.name || '').trim()
      const durationDays = Number(input.durationDays)
      const price = Number(input.price)
      const id = String(input.id || name.toLowerCase().replace(/[^a-z0-9]+/g, '-')).replace(/^-|-$/g, '')
      if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(id) || name.length < 2 || name.length > 60 || !Number.isInteger(durationDays) || durationDays < 1 || durationDays > 3650 || !Number.isFinite(price) || price < 0 || price > 100000) return send(response, 400, { error: 'Renseignez un nom, une durée entre 1 et 3650 jours et un prix valide.' })
      const plan = { id, name, durationDays, price: money(price), currency: 'EUR', active: true }
      try {
        if (usePostgres) return send(response, 201, await createSubscriptionPlanPostgres(plan))
        const plans = await readSubscriptionPlans()
        if (plans.some((existing) => existing.id === id || existing.name.toLowerCase() === name.toLowerCase())) return send(response, 409, { error: 'Une offre porte déjà cet identifiant ou ce nom' })
        plans.push(plan)
        await writeSubscriptionPlans(plans)
        return send(response, 201, plan)
      } catch (error) {
        if (error.code === '23505') return send(response, 409, { error: 'Une offre porte déjà cet identifiant ou ce nom' })
        throw error
      }
    }
    if (url.pathname === '/api/platform/restaurants' && request.method === 'POST') {
      if (!requirePlatformOwner(request, response)) return
      const input = await body(request)
      const identifier = newRestaurantId(input.identifier)
      const name = String(input.name || '').trim()
      const password = String(input.password || '')
      const managerUsername = String(input.managerUsername || '').trim().toLowerCase()
      const managerName = String(input.managerName || '').trim()
      const managerPin = String(input.managerPin || '')
      if (!validRestaurantIdentifier(identifier) || name.length < 2 || name.length > 100 || password.length < 8 || password.length > 128 || !/^[a-z0-9._-]{3,32}$/.test(managerUsername) || managerName.length < 2 || managerName.length > 80 || !/^\d{4,12}$/.test(managerPin)) return send(response, 400, { error: 'Identifiant restaurant invalide (slug ou adresse e-mail), ou vérifiez les informations du premier gérant.' })
      const plan = (await readSubscriptionPlans()).find((item) => item.id === input.planId && item.active)
      if (!plan) return send(response, 400, { error: 'Choisissez une offre active avant de créer le restaurant.' })
      try { return send(response, 201, await provisionRestaurant({ identifier, name, password, managerUsername, managerName, managerPin }, plan)) }
      catch (error) {
        if (error.code === 'RESTAURANT_EXISTS' || error.code === '23505') return send(response, 409, { error: 'Cet identifiant restaurant ou nom d’utilisateur est déjà utilisé' })
        throw error
      }
    }
    if (url.pathname.startsWith('/api/platform/restaurants/') && request.method === 'PATCH' && !url.pathname.endsWith('/subscription')) {
      if (!requirePlatformOwner(request, response)) return
      const id = decodeURIComponent(url.pathname.slice('/api/platform/restaurants/'.length))
      const input = await body(request)
      const identifier = newRestaurantId(input.identifier)
      const name = String(input.name || '').trim()
      const password = String(input.password || '')
      if (!validRestaurantIdentifier(identifier) || name.length < 2 || name.length > 100 || (password && (password.length < 8 || password.length > 128))) return send(response, 400, { error: 'Identifiant restaurant invalide, nom obligatoire ou mot de passe trop court (8 caractères minimum).' })
      try {
        let updated
        if (usePostgres) updated = await updateManagedRestaurantPostgres(id, { identifier, name, passwordHash: password ? await hashPassword(password) : null })
        else {
          const credentials = await readTenantCredentials()
          const restaurant = credentials.find((item) => item.id === id)
          if (restaurant) {
            if (credentials.some((item) => item.id !== id && item.identifier === identifier)) return send(response, 409, { error: 'Cet identifiant restaurant est déjà utilisé' })
            restaurant.identifier = identifier
            restaurant.name = name
            if (password) restaurant.passwordHash = await hashPassword(password)
            await writeTenantCredentials(credentials)
            updated = restaurant
          }
        }
        if (!updated) return send(response, 404, { error: 'Restaurant introuvable ou accès non configuré' })
        return send(response, 200, (await getPlatformOverview()).restaurants.find((restaurant) => restaurant.id === id) || updated)
      } catch (error) {
        if (error.code === '23505') return send(response, 409, { error: 'Cet identifiant restaurant est déjà utilisé' })
        throw error
      }
    }
    if (url.pathname.startsWith('/api/platform/restaurants/') && url.pathname.endsWith('/subscription') && request.method === 'PATCH') {
      if (!requirePlatformOwner(request, response)) return
      const id = decodeURIComponent(url.pathname.split('/').at(-2))
      const input = await body(request)
      const status = input.status === 'suspended' ? 'suspended' : 'active'
      const plan = (await readSubscriptionPlans()).find((item) => item.id === input.planId && item.active)
      if (status === 'active' && !plan) return send(response, 400, { error: 'Choisissez une offre active pour attribuer ou renouveler la licence.' })
      const updated = await setRestaurantSubscription(id, plan, status)
      if (!updated) return send(response, 404, { error: 'Restaurant introuvable ou accès initial à configurer' })
      if (status === 'suspended') revokeRestaurantSessions(id)
      const refreshed = (await getPlatformOverview()).restaurants.find((restaurant) => restaurant.id === id)
      return send(response, 200, refreshed || updated)
    }
    if (url.pathname === '/api/auth/register-restaurant' && request.method === 'POST') return send(response, 403, { error: 'La création des restaurants est réservée au portail propriétaire' })
    if (url.pathname === '/api/auth/restaurant' && request.method === 'POST') {
      const input = await body(request)
      const identifier = newRestaurantId(input.identifier)
      const record = usePostgres
        ? await findRestaurantByIdentifier(identifier)
        : (await readTenantCredentials()).find((item) => item.identifier === identifier)
      if (!record || !await verifyPassword(String(input.password || ''), record.passwordHash)) return send(response, 401, { error: 'Identifiant restaurant ou mot de passe incorrect' })
      const subscriptionStatus = record.status || 'active'
      const subscriptionExpiresAt = record.expiresAt || null
      if (subscriptionStatus !== 'active' || (subscriptionExpiresAt && new Date(subscriptionExpiresAt).getTime() <= Date.now())) return send(response, 403, { error: 'Licence suspendue ou expirée. Contactez le propriétaire de l’application.' })
      const token = randomUUID()
      const expiresAt = Math.min(Date.now() + sessionDurationMs, subscriptionExpiresAt ? new Date(subscriptionExpiresAt).getTime() : Infinity)
      restaurantAccessSessions.set(token, { restaurantId: record.id, name: record.name, identifier, subscriptionStatus, subscriptionExpiresAt, expiresAt })
      return send(response, 200, { token, expiresAt, restaurant: { id: record.id, identifier, name: record.name } })
    }
    if (url.pathname === '/api/auth/restaurant' && request.method === 'GET') {
      const access = restaurantAccessFrom(request)
      if (!access) return send(response, 401, { error: 'Connectez-vous d’abord à votre restaurant' })
      return send(response, 200, { restaurant: { id: access.restaurantId, identifier: access.identifier, name: access.name } })
    }
    if (url.pathname === '/api/auth/restaurant' && request.method === 'DELETE') {
      const access = restaurantAccessFrom(request)
      if (access) restaurantAccessSessions.delete(access.token)
      return send(response, 204, {})
    }
    if (url.pathname === '/api/auth/profiles' && request.method === 'GET') {
      const access = restaurantAccessFrom(request)
      if (!access) return send(response, 401, { error: 'Connectez-vous d’abord à votre restaurant' })
      const profiles = usePostgres
        ? await listProfilesPostgres(access.restaurantId)
        : (await readDatabase(access.restaurantId)).users.map((user) => ({ id: user.id, username: user.username || user.id, name: user.name, role: user.role }))
      return send(response, 200, profiles)
    }
    if (url.pathname === '/api/auth/login' && request.method === 'POST') {
      const access = restaurantAccessFrom(request)
      if (!access) return send(response, 401, { error: 'Connectez-vous d’abord à votre restaurant' })
      const input = await body(request)
      const user = usePostgres
        ? await findUserByCredentials(access.restaurantId, input.username, input.pin)
        : (await readDatabase(access.restaurantId)).users?.find((item) => (item.username || item.id) === input.username && item.pin === input.pin)
      if (!user) return send(response, 401, { error: 'Profil ou code PIN incorrect' })
      const token = randomUUID()
      const expiresAt = Date.now() + sessionDurationMs
      const restaurantId = access.restaurantId
      sessions.set(token, { userId: user.id, name: user.name, role: user.role, restaurantId, subscriptionStatus: access.subscriptionStatus, subscriptionExpiresAt: access.subscriptionExpiresAt, expiresAt: Math.min(expiresAt, access.expiresAt) })
      return send(response, 200, { token, expiresAt, user: { id: user.id, username: user.username || user.id, name: user.name, role: user.role } })
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
    if (request.method === 'GET' && !url.pathname.startsWith('/api/')) return serveFrontend(request, response, url.pathname)
    const activeSession = sessionFrom(request)
    const restaurantId = activeSession?.restaurantId || restaurantAccessFrom(request)?.restaurantId || defaultRestaurantId
    const database = await readDatabase(restaurantId)
    if (url.pathname === '/api/profiles' && request.method === 'POST') {
      if (roleFrom(request) !== 'manager') return send(response, 403, { error: 'Seule la gérance peut créer des profils' })
      const input = await body(request)
      const username = String(input.username || '').trim().toLowerCase()
      const name = String(input.name || '').trim()
      const role = String(input.role || '')
      const pin = String(input.pin || '')
      if (!/^[a-z0-9._-]{3,32}$/.test(username) || name.length < 2 || name.length > 80 || !['manager', 'server', 'kitchen', 'cashier'].includes(role) || !/^\d{4,12}$/.test(pin)) return send(response, 400, { error: 'Nom d’utilisateur (3-32 caractères), nom, rôle et PIN (4-12 chiffres) requis.' })
      if (!usePostgres && database.users.some((user) => (user.username || user.id).toLowerCase() === username)) return send(response, 409, { error: 'Ce nom d’utilisateur existe déjà dans ce restaurant' })
      const profile = { id: `user-${randomUUID()}`, username, name, role, pin }
      let created
      try { created = usePostgres ? await createProfilePostgres(restaurantId, profile) : profile }
      catch (error) { if (error.code === '23505') return send(response, 409, { error: 'Ce nom d’utilisateur existe déjà dans ce restaurant' }); throw error }
      if (!usePostgres) { database.users.push(profile); await saveDatabase(database, restaurantId) }
      return send(response, 201, created)
    }
    if (url.pathname === '/api/dashboard' && request.method === 'GET') {
      if (!requireSession(request, response)) return
      return send(response, 200, { reservations: database.reservations, orders: database.orders, tables: database.tables, stats: { reservations: 24, covers: 86, revenue: 2840, averageDuration: '1h42' } })
    }
    if (url.pathname === '/api/invoices' && request.method === 'POST') {
      if (!['manager', 'cashier'].includes(roleFrom(request))) return send(response, 403, { error: 'Seule la caisse ou la gérance peut émettre une facture' })
      const input = await body(request)
      const order = database.orders.find((item) => item.id === String(input.orderId))
      if (!order) return send(response, 404, { error: 'Commande introuvable' })
      if (order.status !== 'paid') return send(response, 409, { error: 'Encaissez la commande avant d’émettre sa facture' })
      if (!input.seller?.name || !input.seller?.address || !/^\d{9,14}$/.test(String(input.seller?.siren || '').replace(/\s/g, '')) || !input.buyer?.name) return send(response, 400, { error: 'Renseignez raison sociale, adresse et SIREN/SIRET du vendeur, ainsi que le nom du client' })
      if (!Array.isArray(input.lines) || input.lines.length === 0) return send(response, 400, { error: 'La facture doit contenir au moins une ligne' })
      const allowedVatRates = [0, 5.5, 10, 20]
      const lines = input.lines.map((line) => {
        const quantity = Number(line.quantity)
        const unitPrice = Number(line.unitPrice)
        const vatRate = Number(line.vatRate)
        const grossAmount = money(quantity * unitPrice)
        const netAmount = money(grossAmount / (1 + vatRate / 100))
        return { name: String(line.name || '').trim(), quantity, unitPrice, vatRate, grossAmount, netAmount, vatAmount: money(grossAmount - netAmount) }
      })
      if (lines.some((line) => !line.name || !Number.isFinite(line.quantity) || line.quantity <= 0 || !Number.isFinite(line.unitPrice) || line.unitPrice < 0 || !allowedVatRates.includes(line.vatRate))) return send(response, 400, { error: 'Ligne de facture invalide; vérifiez quantité, prix et taux de TVA' })
      const totals = { totalGross: money(lines.reduce((sum, line) => sum + line.grossAmount, 0)), totalNet: money(lines.reduce((sum, line) => sum + line.netAmount, 0)), totalVat: money(lines.reduce((sum, line) => sum + line.vatAmount, 0)) }
      if (Math.abs(totals.totalGross - Number(order.amount)) > 0.05) return send(response, 400, { error: 'Le total TTC des lignes doit correspondre au montant encaissé' })
      const issuedAt = new Date().toISOString()
      const invoiceInput = { id: randomUUID(), orderId: order.id, issuedAt, seller: { name: String(input.seller.name).trim(), address: String(input.seller.address).trim(), siren: String(input.seller.siren).replace(/\s/g, ''), vatNumber: String(input.seller.vatNumber || '').trim() }, buyer: { name: String(input.buyer.name).trim(), address: String(input.buyer.address || '').trim(), email: String(input.buyer.email || '').trim() }, lines, ...totals }
      try {
        let invoice
        if (usePostgres) {
          invoice = await serializeInvoiceCreation(() => createInvoicePostgres(restaurantId, invoiceInput))
        } else {
          const created = await serializeInvoiceCreation(async () => {
            const current = await readDatabase(restaurantId)
            if (current.invoices.some((existing) => existing.orderId === order.id)) return null
            const year = new Date(issuedAt).getFullYear()
            const sequence = current.invoiceCounters[String(year)] || 1
            current.invoiceCounters[String(year)] = sequence + 1
            const nextInvoice = { ...invoiceInput, invoiceNumber: `FAC-${year}-${String(sequence).padStart(6, '0')}` }
            current.invoices.unshift(nextInvoice)
            await saveDatabase(current, restaurantId)
            return nextInvoice
          })
          if (!created) return send(response, 409, { error: 'Une facture existe déjà pour cette commande' })
          invoice = created
        }
        return send(response, 201, invoice)
      } catch (error) {
        if (error.code === '23505' || error.code === 'INVOICE_EXISTS') return send(response, 409, { error: 'Une facture existe déjà pour cette commande' })
        throw error
      }
    }
    if (url.pathname.startsWith('/api/invoices/') && url.pathname.endsWith('/email') && request.method === 'POST') {
      if (!['manager', 'cashier'].includes(roleFrom(request))) return send(response, 403, { error: 'Droits insuffisants pour envoyer une facture' })
      const id = url.pathname.split('/').at(-2)
      const invoice = usePostgres ? await getInvoicePostgres(restaurantId, id) : database.invoices.find((item) => item.id === id)
      if (!invoice) return send(response, 404, { error: 'Facture introuvable' })
      if (!invoice.buyer.email) return send(response, 400, { error: 'Ajoutez l’adresse e-mail du client pour envoyer la facture' })
      if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS || !process.env.MAIL_FROM) return send(response, 503, { error: 'Envoi e-mail non configuré : renseignez SMTP_HOST, SMTP_USER, SMTP_PASS et MAIL_FROM sur Render' })
      const transport = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587), secure: process.env.SMTP_SECURE === 'true', auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } })
      const attachment = await invoicePdf(invoice)
      await transport.sendMail({ from: process.env.MAIL_FROM, to: invoice.buyer.email, subject: `Facture ${invoice.invoiceNumber} - ${invoice.seller.name}`, text: `Bonjour ${invoice.buyer.name}, veuillez trouver votre facture ${invoice.invoiceNumber} en pièce jointe. Total TTC : ${invoice.totalGross.toFixed(2)} EUR.`, html: `<p>Bonjour ${escapeHtml(invoice.buyer.name)},</p><p>Veuillez trouver votre facture <strong>${escapeHtml(invoice.invoiceNumber)}</strong> en pièce jointe.</p><p>Total TTC : ${invoice.totalGross.toFixed(2)} EUR.</p>`, attachments: [{ filename: `${invoice.invoiceNumber}.pdf`, content: attachment, contentType: 'application/pdf' }] })
      const emailedAt = usePostgres ? await markInvoiceEmailed(restaurantId, id) : new Date().toISOString()
      if (!usePostgres) { invoice.emailedAt = emailedAt; await saveDatabase(database, restaurantId) }
      return send(response, 200, { sent: true, emailedAt })
    }
    if (url.pathname === '/api/reservations' && request.method === 'GET') {
      if (!requireSession(request, response)) return
      return send(response, 200, database.reservations)
    }
    if (url.pathname === '/api/inventory' && request.method === 'GET') {
      if (!requireSession(request, response)) return
      return send(response, 200, database.inventory)
    }
    if (url.pathname === '/api/inventory/withdrawals' && request.method === 'GET') {
      if (!requireSession(request, response)) return
      return send(response, 200, database.stockWithdrawals || [])
    }
    if (url.pathname === '/api/inventory/receipts' && request.method === 'GET') {
      if (roleFrom(request) !== 'manager') return send(response, 403, { error: 'Seule la gérance peut consulter les fiches d’entrée' })
      return send(response, 200, database.stockReceipts || [])
    }
    if (url.pathname === '/api/inventory/receipts' && request.method === 'POST') {
      if (roleFrom(request) !== 'manager') return send(response, 403, { error: 'Seule la gérance peut créer une fiche d’entrée' })
      const input = await body(request)
      if (!input.sourceFileName || !Array.isArray(input.lines) || input.lines.length === 0) return send(response, 400, { error: 'Document et lignes d’articles requis' })
      const lines = input.lines.map((line) => ({ inventoryItemId: line.inventoryItemId || '', name: String(line.name || '').trim(), quantity: Number(line.quantity), unit: String(line.unit || 'unité').trim() }))
      if (lines.some((line) => !line.name || !Number.isFinite(line.quantity) || line.quantity <= 0 || !line.unit)) return send(response, 400, { error: 'Chaque ligne doit avoir un nom, une quantité positive et une unité' })
      const receipt = { id: `receipt-${Date.now()}`, sourceFileName: String(input.sourceFileName).slice(0, 250), sourceType: input.sourceType === 'pdf' ? 'pdf' : 'image', extractedText: String(input.extractedText || '').slice(0, 100000), status: 'draft', createdAt: new Date().toISOString(), createdBy: sessionFrom(request)?.userId || '', lines }
      database.stockReceipts.unshift(receipt)
      await saveDatabase(database, restaurantId)
      return send(response, 201, receipt)
    }
    if (url.pathname.startsWith('/api/inventory/receipts/') && request.method === 'PATCH') {
      if (roleFrom(request) !== 'manager') return send(response, 403, { error: 'Seule la gérance peut valider une entrée en stock' })
      const receiptId = url.pathname.split('/').pop()
      if (receiptReviewsInProgress.has(receiptId)) return send(response, 409, { error: 'Cette fiche est déjà en cours de traitement' })
      receiptReviewsInProgress.add(receiptId)
      try {
        const receipt = database.stockReceipts.find((item) => item.id === receiptId)
        if (!receipt) return send(response, 404, { error: 'Fiche d’entrée introuvable' })
        if (receipt.status !== 'draft') return send(response, 409, { error: 'Cette fiche a déjà été traitée' })
        const input = await body(request)
        if (!['approved', 'rejected'].includes(input.status)) return send(response, 400, { error: 'Choisissez approuver ou rejeter' })
        if (input.status === 'approved') {
          for (const [index, line] of receipt.lines.entries()) {
            let item = database.inventory.find((candidate) => candidate.id === line.inventoryItemId)
            if (!item) item = database.inventory.find((candidate) => candidate.name.toLocaleLowerCase('fr-FR') === line.name.toLocaleLowerCase('fr-FR'))
            if (item && item.unit.toLocaleLowerCase('fr-FR') !== line.unit.toLocaleLowerCase('fr-FR')) return send(response, 400, { error: `Unité incompatible pour ${line.name}; corrigez la fiche avant validation.` })
            if (!item) {
              item = { id: `inv-${Date.now()}-${index}`, name: line.name, quantity: 0, unit: line.unit, minimum: 0, supplier: receipt.sourceFileName }
              database.inventory.push(item)
              line.inventoryItemId = item.id
            }
            item.quantity = Number((item.quantity + line.quantity).toFixed(3))
          }
          receipt.status = 'approved'
          receipt.approvedAt = new Date().toISOString()
          receipt.approvedBy = sessionFrom(request)?.userId || ''
        } else {
          receipt.status = 'rejected'
          receipt.rejectedAt = new Date().toISOString()
        }
        await saveDatabase(database, restaurantId)
        return send(response, 200, { receipt, inventory: database.inventory })
      } finally {
        receiptReviewsInProgress.delete(receiptId)
      }
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
      await saveDatabase(database, restaurantId)
      return send(response, 201, dish)
    }
    if (url.pathname === '/api/tables' && request.method === 'POST') {
      if (roleFrom(request) !== 'manager') return send(response, 403, { error: 'Seule la gérance peut ajouter des tables' })
      const input = await body(request)
      const id = String(input.id || '').trim()
      const seats = Number(input.seats)
      const zone = String(input.zone || '').trim()
      if (!id || id.length > 24 || !Number.isInteger(seats) || seats < 1 || seats > 30 || !zone || zone.length > 40) return send(response, 400, { error: 'Renseignez un nom, une zone et entre 1 et 30 places' })
      if (database.tables.some((table) => table.id.toLowerCase() === id.toLowerCase())) return send(response, 409, { error: 'Ce nom de table existe déjà' })
      const table = { id, seats, zone, status: 'free' }
      database.tables.push(table)
      await saveDatabase(database, restaurantId)
      return send(response, 201, table)
    }
    if (url.pathname.startsWith('/api/tables/') && request.method === 'PATCH') {
      if (roleFrom(request) !== 'manager') return send(response, 403, { error: 'Seule la gérance peut modifier les tables' })
      const oldId = decodeURIComponent(url.pathname.slice('/api/tables/'.length))
      const table = database.tables.find((item) => item.id === oldId)
      if (!table) return send(response, 404, { error: 'Table introuvable' })
      const input = await body(request)
      const id = String(input.id || '').trim()
      const seats = Number(input.seats)
      const zone = String(input.zone || '').trim()
      if (!id || id.length > 24 || !Number.isInteger(seats) || seats < 1 || seats > 30 || !zone || zone.length > 40) return send(response, 400, { error: 'Renseignez un nom, une zone et entre 1 et 30 places' })
      if (database.tables.some((item) => item.id !== oldId && item.id.toLowerCase() === id.toLowerCase())) return send(response, 409, { error: 'Ce nom de table existe déjà' })
      table.id = id
      table.seats = seats
      table.zone = zone
      if (id !== oldId) {
        for (const order of database.orders) if (order.table === oldId) order.table = id
        for (const reservation of database.reservations) if (reservation.table === oldId) reservation.table = id
        const point = database.floorPlan?.positions?.[oldId]
        if (point) { database.floorPlan.positions[id] = point; delete database.floorPlan.positions[oldId] }
      }
      await saveDatabase(database, restaurantId)
      return send(response, 200, table)
    }
    if (url.pathname.startsWith('/api/menu/') && request.method === 'PATCH') {
      if (roleFrom(request) !== 'manager') return send(response, 403, { error: 'Seule la gérante peut modifier le menu' })
      const dish = database.menu.find((item) => item.id === url.pathname.split('/').pop())
      if (!dish) return send(response, 404, { error: 'Plat introuvable' })
      const input = await body(request)
      if (!input.name || !Number.isFinite(Number(input.price)) || Number(input.price) <= 0) return send(response, 400, { error: 'Nom et prix valides obligatoires' })
      dish.name = input.name.trim()
      dish.price = Number(input.price)
      dish.image = input.image || ''
      dish.active = input.active !== false
      await saveDatabase(database, restaurantId)
      return send(response, 200, dish)
    }
    if (url.pathname === '/api/floor-plan' && request.method === 'GET') {
      if (!requireSession(request, response)) return
      return send(response, 200, database.floorPlan || null)
    }
    if (url.pathname === '/api/floor-plan' && request.method === 'PUT') {
      if (roleFrom(request) !== 'manager') return send(response, 403, { error: 'Seule la gérante peut configurer le plan de salle' })
      const input = await body(request)
      if (!input.fileName || typeof input.pdfData !== 'string') return send(response, 400, { error: 'Sélectionnez un fichier PDF valide' })
      if (input.pdfData && !input.pdfData.startsWith('data:application/pdf;base64,')) return send(response, 400, { error: 'Le fichier de référence doit être un PDF valide' })
      if (input.pdfData.length > 16_000_000) return send(response, 413, { error: 'Le PDF dépasse la taille maximale de 12 Mo' })
      const positions = Object.fromEntries(Object.entries(input.positions || {}).filter(([, point]) => Number.isFinite(point?.x) && Number.isFinite(point?.y)).map(([id, point]) => [id, { x: Math.min(100, Math.max(0, Number(point.x))), y: Math.min(100, Math.max(0, Number(point.y))) }]))
      database.floorPlan = { fileName: input.fileName, pdfData: '', positions }
      await saveDatabase(database, restaurantId)
      return send(response, 200, database.floorPlan)
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
      await saveDatabase(database, restaurantId)
      return send(response, 200, item)
    }
    if (url.pathname === '/api/inventory/withdrawals' && request.method === 'POST') {
      if (!['manager', 'kitchen'].includes(roleFrom(request))) return send(response, 403, { error: 'Seule la cuisine ou la gérance peut enregistrer une sortie' })
      const input = await body(request)
      if (!Array.isArray(input.items) || input.items.length === 0) return send(response, 400, { error: 'Ajoutez au moins un produit au bon de sortie' })
      const lines = input.items.map((line) => ({ item: database.inventory.find((item) => item.id === line.inventoryItemId), quantity: Number(line.quantity) }))
      if (lines.some((line) => !line.item || !Number.isFinite(line.quantity) || line.quantity <= 0 || line.quantity > line.item.quantity)) return send(response, 400, { error: 'Produit ou quantité de sortie invalide' })
      for (const line of lines) line.item.quantity = Number((line.item.quantity - line.quantity).toFixed(3))
      const withdrawal = { id: `withdrawal-${Date.now()}`, reason: 'Sortie vers la cuisine', note: input.note || '', createdAt: new Date().toISOString(), createdBy: sessionFrom(request)?.userId || '', items: lines.map(({ item, quantity }) => ({ inventoryItemId: item.id, name: item.name, quantity, unit: item.unit })) }
      database.stockWithdrawals.unshift(withdrawal)
      await saveDatabase(database, restaurantId)
      return send(response, 201, { withdrawal, inventory: database.inventory })
    }
    if (url.pathname === '/api/reservations' && request.method === 'POST') {
      if (!requireSession(request, response)) return
      const input = await body(request)
      if (!input.name || !input.time || !input.people) return send(response, 400, { error: 'name, time et people sont obligatoires' })
      const reservation = { id: `res-${Date.now()}`, name: input.name, time: input.time, people: Number(input.people), table: input.table || 'À attribuer', status: 'confirmed' }
      database.reservations.push(reservation)
      await saveDatabase(database, restaurantId)
      return send(response, 201, reservation)
    }
    if (url.pathname === '/api/orders' && request.method === 'POST') {
      if (!['manager', 'server'].includes(roleFrom(request))) return send(response, 403, { error: 'Droits insuffisants' })
      const input = await body(request)
      if (!input.table || !Array.isArray(input.items) || input.items.length === 0) return send(response, 400, { error: 'table et items sont obligatoires' })
      const lines = input.items.map((item) => ({ name: item.name, quantity: Number(item.quantity), price: Number(item.price) }))
      const order = { id: String(1050 + database.orders.length), table: input.table, items: lines.reduce((sum, item) => sum + item.quantity, 0), amount: Number(input.amount || 0), status: 'received', note: input.note || '', lines, createdAt: new Date().toISOString() }
      database.orders.unshift(order)
      await saveDatabase(database, restaurantId)
      return send(response, 201, order)
    }
    if (url.pathname.startsWith('/api/orders/') && request.method === 'PATCH') {
      if (!sessionFrom(request)) return send(response, 401, { error: 'Session absente ou expirée' })
      if (!['manager', 'kitchen', 'cashier', 'server'].includes(roleFrom(request))) return send(response, 403, { error: 'Droits insuffisants' })
      const id = url.pathname.split('/').pop()
      const order = database.orders.find((item) => item.id === id)
      if (!order) return send(response, 404, { error: 'Commande introuvable' })
      const input = await body(request)
      const nextStatus = input.status
      const allowedStatuses = ['received', 'preparing', 'ready', 'served', 'paid']
      if (!allowedStatuses.includes(nextStatus)) return send(response, 400, { error: 'Statut de commande invalide' })
      if (nextStatus === 'paid' && !['manager', 'cashier'].includes(roleFrom(request))) return send(response, 403, { error: 'Seule la caisse peut encaisser' })
      if (['preparing', 'ready'].includes(nextStatus) && !['manager', 'kitchen'].includes(roleFrom(request))) return send(response, 403, { error: 'Seule la cuisine peut traiter cette commande' })
      if (nextStatus === 'served' && !['manager', 'server'].includes(roleFrom(request))) return send(response, 403, { error: 'Seule la salle peut marquer une commande servie' })
      order.status = nextStatus
      if (nextStatus === 'paid') order.paymentMethod = input.paymentMethod === 'cash' ? 'cash' : 'card'
      await saveDatabase(database, restaurantId)
      return send(response, 200, order)
    }
    if (request.method === 'GET') return serveFrontend(request, response, url.pathname)
    return send(response, 404, { error: 'Route introuvable' })
  } catch (error) {
    console.error(error)
    return send(response, 500, { error: 'Erreur interne de l’API' })
  }
})

async function start() {
  if (usePostgres) {
    const fallback = JSON.parse(await readFile(databasePath, 'utf8'))
    await initPostgres(fallback)
    console.log('PostgreSQL persistence enabled')
  } else {
    console.log('Local JSON persistence enabled')
  }
  server.listen(port, () => console.log(`Restaurant API listening on http://localhost:${port}`))
}

start().catch((error) => { console.error('Unable to initialize persistence', error); process.exit(1) })
