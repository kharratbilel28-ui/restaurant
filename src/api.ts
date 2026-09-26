import { cacheApiResponse, clearTenantApiCache, currentTenantId, enqueueOfflineOperation, getOfflineQueueCounts, offlineDb, readCachedApi } from './offlineDb'

export type Reservation = { id: string; time: string; name: string; people: number; table: string; status: string; offlinePending?: boolean }
export type RestaurantTable = { id: string; seats: number; status: 'free' | 'occupied' | 'reserved'; zone: string }
export type OrderLine = { name: string; quantity: number; price: number }
export type Order = { id: string; table: string; items: number; amount: number; status: 'received' | 'preparing' | 'ready' | 'served' | 'paid'; note?: string; lines?: OrderLine[]; paymentMethod?: 'cash' | 'card'; createdAt: string; offlinePending?: boolean }
export type InventoryItem = { id: string; name: string; quantity: number; unit: string; minimum: number; supplier: string }
export type StockReceiptLine = { inventoryItemId: string; name: string; quantity: number; unit: string }
export type StockReceipt = { id: string; sourceFileName: string; sourceType: 'pdf' | 'image'; extractedText: string; status: 'draft' | 'approved' | 'rejected'; createdAt: string; approvedAt?: string; lines: StockReceiptLine[]; offlinePending?: boolean }
export type StockWithdrawal = { id: string; reason: string; note: string; createdAt: string; items: { inventoryItemId: string; name: string; quantity: number; unit: string }[]; offlinePending?: boolean }
export type MenuItem = { id: string; name: string; price: number; image: string; active: boolean; offlinePending?: boolean }
export type FloorPlanConfig = { fileName: string; pdfData: string; positions: Record<string, { x: number; y: number }> }
export type Dashboard = { reservations: Reservation[]; orders: Order[]; tables: RestaurantTable[]; stats: { reservations: number; covers: number; revenue: number; averageDuration: string } }
export type InvoiceLine = { name: string; quantity: number; unitPrice: number; vatRate: number; netAmount: number; vatAmount: number; grossAmount: number }
export type Invoice = { id: string; invoiceNumber: string; orderId: string; issuedAt: string; seller: { name: string; address: string; siren: string; vatNumber: string }; buyer: { name: string; address: string; email: string }; lines: InvoiceLine[]; totalNet: number; totalVat: number; totalGross: number; emailedAt?: string }
export type Role = 'manager' | 'server' | 'kitchen' | 'cashier'
export type SessionUser = { id: string; username?: string; name: string; role: Role }
export type Session = { token: string; expiresAt: number; user: SessionUser }
export type RestaurantContext = { id: string; identifier: string; name: string }
export type TeamProfile = { id: string; username: string; name: string; role: Role }
export type SubscriptionPlan = { id: string; name: string; durationDays: number; price: number; currency: string; active: boolean }
export type ManagedRestaurant = { id: string; identifier: string; name: string; planId: string | null; planName: string | null; startedAt: string | null; expiresAt: string | null; status: 'active' | 'suspended'; accessConfigured: boolean }
export type PlatformOverview = { restaurants: ManagedRestaurant[]; plans: SubscriptionPlan[] }

const apiUrl = import.meta.env.VITE_API_URL || '/api'

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const method = (options?.method || 'GET').toUpperCase()
  const token = localStorage.getItem('restaurant-token')
  const accessToken = localStorage.getItem('restaurant-access-token')
  const platformToken = localStorage.getItem('platform-token')
  const headers = new Headers(options?.headers)
  headers.set('Content-Type', 'application/json')
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (accessToken) headers.set('X-Restaurant-Access', accessToken)
  if (platformToken) headers.set('X-Platform-Access', platformToken)
  if (method === 'GET' && !navigator.onLine) {
    const cached = await readCachedApi<T>(path)
    if (cached !== undefined) return cached
    throw new Error('Données non disponibles hors ligne. Ouvre la page une fois avec une connexion.')
  }
  if (method !== 'GET' && !navigator.onLine && canQueueOffline(method, path)) return queueOfflineRequest<T>(method, path, options?.body)
  let response: Response
  try { response = await fetch(`${apiUrl}${path}`, { ...options, method, headers }) }
  catch (error) {
    if (method === 'GET') {
      const cached = await readCachedApi<T>(path)
      if (cached !== undefined) return cached
    }
    if (method !== 'GET' && canQueueOffline(method, path)) return queueOfflineRequest<T>(method, path, options?.body)
    throw error
  }
  if (!response.ok) {
    if (response.status === 401) localStorage.removeItem('restaurant-token')
    throw new Error((await response.json()).error || 'Erreur API')
  }
  if (response.status === 204) return undefined as T
  const result = await response.json() as T
  if (method === 'GET') await cacheApiResponse(path, result)
  return result
}

function canQueueOffline(method: string, path: string) {
  if (method === 'POST') return ['/orders', '/menu', '/reservations', '/inventory/withdrawals', '/inventory/receipts'].includes(path)
  return method === 'PATCH' && (/^\/orders\/[^/]+$/.test(path) || /^\/inventory\/[^/]+$/.test(path))
}

async function queueOfflineRequest<T>(method: string, path: string, body: BodyInit | null | undefined): Promise<T> {
  if (typeof body !== 'string') throw new Error('Cette action ne peut pas être mise en attente hors ligne.')
  const operation = await enqueueOfflineOperation({ method, path, body })
  const optimistic = await makeOfflineResult(method, path, JSON.parse(body))
  window.dispatchEvent(new CustomEvent('restaurant-offline-queue-changed', { detail: { operationId: operation.id } }))
  return optimistic as T
}

async function makeOfflineResult(method: string, path: string, input: Record<string, any>) {
  const now = new Date().toISOString()
  if (method === 'POST' && path === '/orders') {
    const lines = input.items as OrderLine[]
    const order: Order = { id: input.id, table: input.table, items: lines.reduce((total, line) => total + Number(line.quantity), 0), amount: Number(input.amount), status: 'received', note: input.note || '', lines, createdAt: input.createdAt || now, offlinePending: true }
    const dashboard = await readCachedApi<Dashboard>('/dashboard')
    if (dashboard) await cacheApiResponse('/dashboard', { ...dashboard, orders: [order, ...dashboard.orders] })
    return order
  }
  if (method === 'POST' && path === '/menu') {
    const dish: MenuItem = { id: input.id, name: input.name, price: Number(input.price), image: input.image || '', active: true, offlinePending: true }
    const menu = await readCachedApi<MenuItem[]>('/menu')
    await cacheApiResponse('/menu', [...(menu || []), dish])
    return dish
  }
  if (method === 'POST' && path === '/reservations') {
    const reservation: Reservation = { id: input.id, name: input.name, time: input.time, people: Number(input.people), table: input.table || 'À attribuer', status: 'confirmed', offlinePending: true }
    const [reservations, dashboard] = await Promise.all([readCachedApi<Reservation[]>('/reservations'), readCachedApi<Dashboard>('/dashboard')])
    await cacheApiResponse('/reservations', [...(reservations || []), reservation])
    if (dashboard) await cacheApiResponse('/dashboard', { ...dashboard, reservations: [...dashboard.reservations, reservation] })
    return reservation
  }
  if (method === 'POST' && path === '/inventory/receipts') {
    const receipt: StockReceipt = { id: input.id, sourceFileName: input.sourceFileName, sourceType: input.sourceType, extractedText: input.extractedText || '', status: 'draft', createdAt: now, lines: input.lines, offlinePending: true }
    const receipts = await readCachedApi<StockReceipt[]>('/inventory/receipts')
    await cacheApiResponse('/inventory/receipts', [receipt, ...(receipts || [])])
    return receipt
  }
  if (method === 'POST' && path === '/inventory/withdrawals') {
    const inventory = await readCachedApi<InventoryItem[]>('/inventory') || []
    const items = (input.items as Array<{ inventoryItemId: string; quantity: number }>).map((line) => {
      const item = inventory.find((candidate) => candidate.id === line.inventoryItemId)
      return { inventoryItemId: line.inventoryItemId, name: item?.name || '', quantity: Number(line.quantity), unit: item?.unit || '' }
    })
    const updatedInventory = inventory.map((item) => {
      const line = items.find((candidate) => candidate.inventoryItemId === item.id)
      return line ? { ...item, quantity: Number((item.quantity - line.quantity).toFixed(3)) } : item
    })
    const withdrawal: StockWithdrawal = { id: input.id, reason: 'Sortie vers la cuisine', note: input.note || '', createdAt: now, items, offlinePending: true }
    const withdrawals = await readCachedApi<StockWithdrawal[]>('/inventory/withdrawals')
    await cacheApiResponse('/inventory', updatedInventory)
    await cacheApiResponse('/inventory/withdrawals', [withdrawal, ...(withdrawals || [])])
    return { withdrawal, inventory: updatedInventory }
  }
  if (method === 'PATCH' && path.startsWith('/orders/')) {
    const id = decodeURIComponent(path.slice('/orders/'.length))
    const dashboard = await readCachedApi<Dashboard>('/dashboard')
    const order = dashboard?.orders.find((item) => item.id === id)
    if (!order || !dashboard) throw new Error('Cette commande n’est pas disponible dans le cache local.')
    const updated: Order = { ...order, status: input.status, ...(input.status === 'paid' ? { paymentMethod: input.paymentMethod === 'cash' ? 'cash' : 'card' } : {}), offlinePending: true }
    await cacheApiResponse('/dashboard', { ...dashboard, orders: dashboard.orders.map((item) => item.id === id ? updated : item) })
    return updated
  }
  if (method === 'PATCH' && path.startsWith('/inventory/')) {
    const id = decodeURIComponent(path.slice('/inventory/'.length))
    const inventory = await readCachedApi<InventoryItem[]>('/inventory') || []
    const updated = inventory.map((item) => item.id === id ? { ...item, quantity: Number(input.quantity) } : item)
    const item = updated.find((candidate) => candidate.id === id)
    if (!item) throw new Error('Ce produit n’est pas disponible dans le cache local.')
    await cacheApiResponse('/inventory', updated)
    return { ...item, offlinePending: true }
  }
  throw new Error('Cette action ne peut pas être mise en attente hors ligne.')
}

export async function getOfflineStatus() {
  return getOfflineQueueCounts()
}

export async function syncOfflineQueue() {
  if (!navigator.onLine) return { synced: 0, failed: 0, pending: (await getOfflineQueueCounts()).pending }
  const tenantId = currentTenantId()
  const userId = localStorage.getItem('restaurant-user-id') || ''
  const operations = await offlineDb.outbox.where('tenantId').equals(tenantId).sortBy('createdAt')
  let synced = 0
  let failed = 0
  for (const operation of operations) {
    if (operation.userId && operation.userId !== userId) continue
    if (!navigator.onLine) break
    const headers = new Headers({ 'Content-Type': 'application/json' })
    const token = localStorage.getItem('restaurant-token')
    const accessToken = localStorage.getItem('restaurant-access-token')
    if (token) headers.set('Authorization', `Bearer ${token}`)
    if (accessToken) headers.set('X-Restaurant-Access', accessToken)
    try {
      const response = await fetch(`${apiUrl}${operation.path}`, { method: operation.method, headers, body: operation.body })
      if (response.ok) {
        await offlineDb.outbox.delete(operation.id)
        synced += 1
        continue
      }
      if (response.status >= 500 || response.status === 401) break
      const error = (await response.json().catch(() => ({ error: `HTTP ${response.status}` }))).error || `HTTP ${response.status}`
      await offlineDb.failedOperations.put({ ...operation, error, failedAt: Date.now() })
      await offlineDb.outbox.delete(operation.id)
      failed += 1
    } catch { break }
  }
  if (synced) await clearTenantApiCache(tenantId)
  const pending = await getOfflineQueueCounts(tenantId)
  window.dispatchEvent(new CustomEvent('restaurant-offline-queue-changed'))
  return { synced, failed, pending: pending.pending }
}

export const getDashboard = () => request<Dashboard>('/dashboard')
export const getHealth = () => request<{ ok: boolean; service: string; storage: 'postgresql' | 'local-json' }>('/health')
export const loginRestaurant = (identifier: string, password: string) => request<{ token: string; restaurant: RestaurantContext }>('/auth/restaurant', { method: 'POST', body: JSON.stringify({ identifier, password }) })
export const getRestaurantContext = () => request<{ restaurant: RestaurantContext }>('/auth/restaurant')
export const logoutRestaurant = () => request<void>('/auth/restaurant', { method: 'DELETE' })
export const getProfiles = () => request<TeamProfile[]>('/auth/profiles')
export const createProfile = (profile: { username: string; name: string; role: Role; pin: string }) => request<TeamProfile>('/profiles', { method: 'POST', body: JSON.stringify(profile) })
export const login = (username: string, pin: string) => request<Session>('/auth/login', { method: 'POST', body: JSON.stringify({ username, pin }) })
export const loginPlatform = (username: string, password: string) => request<{ token: string; owner: { name: string } }>('/platform/login', { method: 'POST', body: JSON.stringify({ username, password }) })
export const getPlatformSession = () => request<{ owner: { name: string }; expiresAt: number }>('/platform/me')
export const logoutPlatform = () => request<void>('/platform/logout', { method: 'POST' })
export const getPlatformOverview = () => request<PlatformOverview>('/platform/overview')
export const createSubscriptionPlan = (plan: { name: string; durationDays: number; price: number }) => request<SubscriptionPlan>('/platform/plans', { method: 'POST', body: JSON.stringify(plan) })
export const createPlatformRestaurant = (restaurant: { identifier: string; name: string; password: string; managerUsername: string; managerName: string; managerPin: string; planId: string }) => request<ManagedRestaurant>('/platform/restaurants', { method: 'POST', body: JSON.stringify(restaurant) })
export const updatePlatformRestaurant = (id: string, restaurant: { identifier: string; name: string; password?: string }) => request<ManagedRestaurant>(`/platform/restaurants/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(restaurant) })
export const updateRestaurantSubscription = (id: string, update: { planId?: string; status: 'active' | 'suspended' }) => request<ManagedRestaurant>(`/platform/restaurants/${encodeURIComponent(id)}/subscription`, { method: 'PATCH', body: JSON.stringify(update) })
export const getSession = () => request<Omit<Session, 'token'>>('/auth/me')
export const logout = () => request<void>('/auth/logout', { method: 'POST' })
export const createReservation = (reservation: { name: string; time: string; people: number; table?: string }) => request<Reservation>('/reservations', { method: 'POST', body: JSON.stringify({ ...reservation, id: crypto.randomUUID() }) })
export const updateOrderStatus = (id: string, status: string, paymentMethod?: 'cash' | 'card') => request<Order>(`/orders/${id}`, { method: 'PATCH', body: JSON.stringify({ status, paymentMethod }) })
export const createDiningTable = (table: { id: string; seats: number; zone: string }) => request<RestaurantTable>('/tables', { method: 'POST', body: JSON.stringify(table) })
export const updateDiningTable = (id: string, table: { id: string; seats: number; zone: string }) => request<RestaurantTable>(`/tables/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(table) })
export const openCashDrawer = () => request<{ opened: boolean }>('/hardware/cash-drawer', { method: 'POST' })
export const createOrder = (order: { table: string; items: OrderLine[]; amount: number; note: string }) => request<Order>('/orders', { method: 'POST', body: JSON.stringify({ ...order, id: crypto.randomUUID() }) })
export const getInventory = () => request<InventoryItem[]>('/inventory')
export const getStockWithdrawals = () => request<StockWithdrawal[]>('/inventory/withdrawals')
export const getStockReceipts = () => request<StockReceipt[]>('/inventory/receipts')
export const createStockReceiptDraft = (draft: { sourceFileName: string; sourceType: 'pdf' | 'image'; extractedText: string; lines: StockReceiptLine[] }) => request<StockReceipt>('/inventory/receipts', { method: 'POST', body: JSON.stringify({ ...draft, id: crypto.randomUUID() }) })
export const reviewStockReceipt = (id: string, status: 'approved' | 'rejected') => request<{ receipt: StockReceipt; inventory: InventoryItem[] }>(`/inventory/receipts/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) })
export const updateInventory = (id: string, quantity: number) => request<InventoryItem>(`/inventory/${id}`, { method: 'PATCH', body: JSON.stringify({ quantity }) })
export const createStockWithdrawal = (items: { inventoryItemId: string; quantity: number }[], note: string) => request<{ withdrawal: StockWithdrawal; inventory: InventoryItem[] }>('/inventory/withdrawals', { method: 'POST', body: JSON.stringify({ id: crypto.randomUUID(), items, note }) })
export const getMenu = () => request<MenuItem[]>('/menu')
export const createMenuItem = (item: { name: string; price: number; image: string }) => request<MenuItem>('/menu', { method: 'POST', body: JSON.stringify({ ...item, id: crypto.randomUUID() }) })
export const updateMenuItem = (id: string, item: { name: string; price: number; image: string; active: boolean }) => request<MenuItem>(`/menu/${id}`, { method: 'PATCH', body: JSON.stringify(item) })
export const getFloorPlan = () => request<FloorPlanConfig | null>('/floor-plan')
export const saveFloorPlan = (plan: FloorPlanConfig) => request<FloorPlanConfig>('/floor-plan', { method: 'PUT', body: JSON.stringify(plan) })
export const createInvoice = (invoice: { orderId: string; seller: Invoice['seller']; buyer: Invoice['buyer']; lines: Array<Pick<InvoiceLine, 'name' | 'quantity' | 'unitPrice' | 'vatRate'>> }) => request<Invoice>('/invoices', { method: 'POST', body: JSON.stringify(invoice) })
export const sendInvoiceEmail = (id: string) => request<{ sent: boolean; emailedAt: string }>(`/invoices/${id}/email`, { method: 'POST' })
