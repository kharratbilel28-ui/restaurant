import Dexie, { type Table } from 'dexie'

export type CachedApiResponse = {
  key: string
  tenantId: string
  path: string
  value: unknown
  updatedAt: number
}

export type OfflineOperation = {
  id: string
  tenantId: string
  userId: string
  method: string
  path: string
  body: string
  createdAt: number
}

export type FailedOfflineOperation = OfflineOperation & {
  error: string
  failedAt: number
}

class RestaurantOfflineDatabase extends Dexie {
  responses!: Table<CachedApiResponse, string>
  outbox!: Table<OfflineOperation, string>
  failedOperations!: Table<FailedOfflineOperation, string>

  constructor() {
    super('servicepilot-offline')
    this.version(1).stores({
      responses: '&key, tenantId, updatedAt',
      outbox: '&id, [tenantId+createdAt], userId',
      failedOperations: '&id, tenantId, failedAt',
    })
  }
}

export const offlineDb = new RestaurantOfflineDatabase()

export function currentTenantId() {
  return localStorage.getItem('restaurant-identifier') || 'restaurant-demo'
}

export function apiCacheKey(path: string, tenantId = currentTenantId()) {
  return `${tenantId}:${path}`
}

export async function readCachedApi<T>(path: string): Promise<T | undefined> {
  const cached = await offlineDb.responses.get(apiCacheKey(path))
  return cached?.value as T | undefined
}

export async function cacheApiResponse(path: string, value: unknown) {
  const tenantId = currentTenantId()
  await offlineDb.responses.put({ key: apiCacheKey(path, tenantId), tenantId, path, value, updatedAt: Date.now() })
}

export async function clearTenantApiCache(tenantId = currentTenantId()) {
  await offlineDb.responses.where('tenantId').equals(tenantId).delete()
}

export async function enqueueOfflineOperation(operation: Omit<OfflineOperation, 'id' | 'tenantId' | 'userId' | 'createdAt'>) {
  const queued: OfflineOperation = {
    ...operation,
    id: crypto.randomUUID(),
    tenantId: currentTenantId(),
    userId: localStorage.getItem('restaurant-user-id') || '',
    createdAt: Date.now(),
  }
  await offlineDb.outbox.add(queued)
  return queued
}

export async function getOfflineQueueCounts(tenantId = currentTenantId()) {
  const [pending, failed] = await Promise.all([
    offlineDb.outbox.where('tenantId').equals(tenantId).count(),
    offlineDb.failedOperations.where('tenantId').equals(tenantId).count(),
  ])
  return { pending, failed }
}
