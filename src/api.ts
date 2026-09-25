export type Reservation = { id: string; time: string; name: string; people: number; table: string; status: string }
export type RestaurantTable = { id: string; seats: number; status: 'free' | 'occupied' | 'reserved'; zone: string }
export type OrderLine = { name: string; quantity: number; price: number }
export type Order = { id: string; table: string; items: number; amount: number; status: 'received' | 'preparing' | 'ready' | 'served' | 'paid'; note?: string; lines?: OrderLine[]; paymentMethod?: 'cash' | 'card'; createdAt: string }
export type InventoryItem = { id: string; name: string; quantity: number; unit: string; minimum: number; supplier: string }
export type StockWithdrawal = { id: string; reason: string; note: string; createdAt: string; items: { inventoryItemId: string; name: string; quantity: number; unit: string }[] }
export type MenuItem = { id: string; name: string; price: number; image: string; active: boolean }
export type Dashboard = { reservations: Reservation[]; orders: Order[]; tables: RestaurantTable[]; stats: { reservations: number; covers: number; revenue: number; averageDuration: string } }
export type Role = 'manager' | 'server' | 'kitchen' | 'cashier'
export type SessionUser = { id: string; name: string; role: Role }
export type Session = { token: string; expiresAt: number; user: SessionUser }

const apiUrl = import.meta.env.VITE_API_URL || (import.meta.env.PROD ? '/api' : 'http://localhost:8787/api')

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = localStorage.getItem('restaurant-token')
  const response = await fetch(`${apiUrl}${path}`, { headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...options })
  if (!response.ok) {
    if (response.status === 401) localStorage.removeItem('restaurant-token')
    throw new Error((await response.json()).error || 'Erreur API')
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export const getDashboard = () => request<Dashboard>('/dashboard')
export const login = (role: Role, pin: string) => request<Session>('/auth/login', { method: 'POST', body: JSON.stringify({ role, pin }) })
export const getSession = () => request<Omit<Session, 'token'>>('/auth/me')
export const logout = () => request<void>('/auth/logout', { method: 'POST' })
export const createReservation = (reservation: { name: string; time: string; people: number; table?: string }) => request<Reservation>('/reservations', { method: 'POST', body: JSON.stringify(reservation) })
export const updateOrderStatus = (id: string, status: string, paymentMethod?: 'cash' | 'card') => request<Order>(`/orders/${id}`, { method: 'PATCH', body: JSON.stringify({ status, paymentMethod }) })
export const openCashDrawer = () => request<{ opened: boolean }>('/hardware/cash-drawer', { method: 'POST' })
export const createOrder = (order: { table: string; items: OrderLine[]; amount: number; note: string }) => request<Order>('/orders', { method: 'POST', body: JSON.stringify(order) })
export const getInventory = () => request<InventoryItem[]>('/inventory')
export const getStockWithdrawals = () => request<StockWithdrawal[]>('/inventory/withdrawals')
export const updateInventory = (id: string, quantity: number) => request<InventoryItem>(`/inventory/${id}`, { method: 'PATCH', body: JSON.stringify({ quantity }) })
export const createStockWithdrawal = (items: { inventoryItemId: string; quantity: number }[], note: string) => request<{ withdrawal: StockWithdrawal; inventory: InventoryItem[] }>('/inventory/withdrawals', { method: 'POST', body: JSON.stringify({ items, note }) })
export const getMenu = () => request<MenuItem[]>('/menu')
export const createMenuItem = (item: { name: string; price: number; image: string }) => request<MenuItem>('/menu', { method: 'POST', body: JSON.stringify(item) })
