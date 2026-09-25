export type Reservation = { id: string; time: string; name: string; people: number; table: string; status: string }
export type RestaurantTable = { id: string; seats: number; status: 'free' | 'occupied' | 'reserved'; zone: string }
export type Order = { id: string; table: string; items: number; amount: number; status: string; createdAt: string }
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
export const updateOrderStatus = (id: string, status: string) => request<Order>(`/orders/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) })
export const createOrder = (order: { table: string; items: string[]; amount: number }) => request<Order>('/orders', { method: 'POST', body: JSON.stringify(order) })
