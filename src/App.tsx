import { useEffect, useRef, useState } from 'react'
import './App.css'
import './modules.css'
import { createDiningTable, createInvoice, createMenuItem, createOrder, createProfile, createReservation, createStockReceiptDraft, createStockWithdrawal, createPlatformRestaurant, createSubscriptionPlan, getDashboard, getFloorPlan, getHealth, getInventory, getMenu, getPlatformOverview, getPlatformSession, getProfiles, getRestaurantContext, getSession, getStockReceipts, getStockWithdrawals, login, loginPlatform, loginRestaurant, logout, logoutPlatform, logoutRestaurant, openCashDrawer, reviewStockReceipt, saveFloorPlan, sendInvoiceEmail, updateDiningTable, updateInventory, updateMenuItem, updateOrderStatus, updateRestaurantSubscription, type Dashboard, type FloorPlanConfig, type InventoryItem, type Invoice, type ManagedRestaurant, type MenuItem, type Order, type OrderLine, type PlatformOverview, type RestaurantContext, type RestaurantTable, type Role, type SessionUser, type StockReceipt, type StockReceiptLine, type StockWithdrawal, type TeamProfile } from './api'
import type { InvoiceAnalysis } from './invoiceOcr'

type IconProps = { size?: number }
type IconComponent = (props: IconProps) => React.ReactNode
const makeIcon = (symbol: string): IconComponent => ({ size = 18 }) => <span className="local-icon" style={{ fontSize: size - 2 }}>{symbol}</span>
const Archive = makeIcon('▣'), ArrowUpRight = makeIcon('↗'), Bell = makeIcon('🔔'), CalendarDays = makeIcon('▦')
const ChevronDown = makeIcon('⌄'), ChefHat = makeIcon('♨'), CircleDollarSign = makeIcon('€'), ClipboardList = makeIcon('☷')
const Clock3 = makeIcon('◷'), LayoutDashboard = makeIcon('▤'), Map = makeIcon('⌖'), MoreHorizontal = makeIcon('···')
const Package = makeIcon('□'), Plus = makeIcon('+'), Settings = makeIcon('⚙')
const Utensils = makeIcon('♧'), Users = makeIcon('♙'), WalletCards = makeIcon('▭')

type NavItem = { label: string; icon: IconComponent; badge?: string }
type NotificationItem = { id: string; title: string; message: string; createdAt: string; target: string; read: boolean }
const navItems: NavItem[] = [
  { label: 'Vue d’ensemble', icon: LayoutDashboard }, { label: 'Menu & plats', icon: Utensils }, { label: 'Réservations', icon: CalendarDays, badge: '12' },
  { label: 'Prise de commande', icon: ClipboardList }, { label: 'Plan de salle', icon: Map },
  { label: 'Cuisine', icon: ChefHat, badge: '8' }, { label: 'Caisse & paiements', icon: WalletCards },
]
function App() {
  const [activeNav, setActiveNav] = useState('Vue d’ensemble')
  const [showAdd, setShowAdd] = useState(false)
  const [alertVisible, setAlertVisible] = useState(true)
  const [dashboard, setDashboard] = useState<Dashboard | null>(null)
  const [apiError, setApiError] = useState('')
  const [role, setRole] = useState<Role>('manager')
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null)
  const [restaurantContext, setRestaurantContext] = useState<RestaurantContext | null>(null)
  const [profiles, setProfiles] = useState<TeamProfile[]>([])
  const [platformOwner, setPlatformOwner] = useState(false)
  const [platformLoginMode, setPlatformLoginMode] = useState(false)
  const [sessionReady, setSessionReady] = useState(false)
  const [inventory, setInventory] = useState<InventoryItem[]>([])
  const [selectedTable, setSelectedTable] = useState('')
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [serverNotice, setServerNotice] = useState('')
  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [menu, setMenu] = useState<MenuItem[]>([])
  const [stockWithdrawals, setStockWithdrawals] = useState<StockWithdrawal[]>([])
  const [stockReceipts, setStockReceipts] = useState<StockReceipt[]>([])
  const [floorPlan, setFloorPlan] = useState<FloorPlanConfig | null>(null)
  const [storageMode, setStorageMode] = useState<'postgresql' | 'local-json' | 'unknown'>('unknown')
  const [invoiceOrder, setInvoiceOrder] = useState<Order | null>(null)
  const [printDocument, setPrintDocument] = useState<{ kind: 'ticket'; order: Order } | { kind: 'invoice'; invoice: Invoice } | null>(null)
  const previousOrderStatuses = useRef<Record<string, string>>({})
  const orderSubmissionInFlight = useRef(false)

  useEffect(() => {
    if (localStorage.getItem('platform-token')) {
      getPlatformSession().then(() => setPlatformOwner(true)).catch(() => localStorage.removeItem('platform-token')).finally(() => setSessionReady(true))
      return
    }
    const token = localStorage.getItem('restaurant-token')
    const accessToken = localStorage.getItem('restaurant-access-token')
    if (!token) {
      if (accessToken) Promise.all([getRestaurantContext(), getProfiles()]).then(([context, availableProfiles]) => { setRestaurantContext(context.restaurant); setProfiles(availableProfiles) }).catch(() => { localStorage.removeItem('restaurant-access-token') }).finally(() => setSessionReady(true))
      else setSessionReady(true)
      return
    }
    Promise.all([getSession(), getRestaurantContext()]).then(([session, context]) => {
      const user = session.user
      setRestaurantContext(context.restaurant)
      setSessionUser(user)
      setRole(user.role)
      setActiveNav(user.role === 'kitchen' ? 'Cuisine' : user.role === 'cashier' ? 'Caisse & paiements' : user.role === 'server' ? 'Prise de commande' : 'Vue d’ensemble')
      return Promise.all([getDashboard(), getInventory(), getMenu(), getStockWithdrawals(), getFloorPlan(), getStockReceipts(), getProfiles()])
    }).then(([data, stock, dishes, withdrawals, plan, receipts, availableProfiles]) => {
      previousOrderStatuses.current = Object.fromEntries(data.orders.map((order) => [order.id, order.status]))
      setDashboard(data); setInventory(stock); setMenu(dishes); setStockWithdrawals(withdrawals); setFloorPlan(plan); setStockReceipts(receipts); setProfiles(availableProfiles)
      const lowStock = stock.filter((item) => item.quantity <= item.minimum)
      setNotifications(lowStock.map((item) => ({ id: `stock-low-${item.id}`, title: 'Stock à réapprovisionner', message: `${item.name} : ${item.quantity} ${item.unit} restants (seuil ${item.minimum}).`, createdAt: new Date().toISOString(), target: 'Approvisionnement', read: false })))
    }).catch(() => {
      localStorage.removeItem('restaurant-token')
      getRestaurantContext().then((context) => setRestaurantContext(context.restaurant)).catch(() => localStorage.removeItem('restaurant-access-token'))
      setSessionUser(null)
      setApiError('Session expirée. Reconnectez-vous à votre profil.')
    }).finally(() => setSessionReady(true))
  }, [])
  useEffect(() => { getHealth().then((health) => setStorageMode(health.storage)).catch(() => setStorageMode('unknown')) }, [])
  useEffect(() => {
    if (!sessionUser) return
    const poll = window.setInterval(() => { getDashboard().then((next) => { const ready = next.orders.find((order) => order.status === 'ready' && previousOrderStatuses.current[order.id] !== 'ready'); if (ready && (role === 'server' || role === 'manager')) { setServerNotice(`La commande #${ready.id} de la table ${ready.table} est prête.`); setNotifications((current) => current.some((item) => item.id === `order-ready-${ready.id}`) ? current : [{ id: `order-ready-${ready.id}`, title: 'Commande prête', message: `La commande #${ready.id} de la table ${ready.table} peut être servie.`, createdAt: new Date().toISOString(), target: 'Prise de commande', read: false }, ...current]) } previousOrderStatuses.current = Object.fromEntries(next.orders.map((order) => [order.id, order.status])); setDashboard(next) }).catch(() => undefined) }, 8000)
    return () => window.clearInterval(poll)
  }, [sessionUser, role])
  useEffect(() => {
    if (sessionUser) getFloorPlan().then(setFloorPlan).catch(() => undefined)
  }, [sessionUser])
  useEffect(() => {
    if (!sessionUser) return
    const lowStockItems = role === 'manager' || role === 'kitchen' ? inventory.filter((item) => item.quantity <= item.minimum) : []
    setNotifications((current) => {
      const additions = lowStockItems.filter((stockItem) => !current.some((notification) => notification.id === `stock-low-${stockItem.id}`)).map((stockItem) => ({ id: `stock-low-${stockItem.id}`, title: 'Stock à réapprovisionner', message: `${stockItem.name} : ${stockItem.quantity} ${stockItem.unit} restants (seuil ${stockItem.minimum}).`, createdAt: new Date().toISOString(), target: role === 'kitchen' ? 'Approvisionnement' : 'Approvisionnement', read: false }))
      return additions.length ? [...additions, ...current] : current
    })
  }, [sessionUser, inventory, role])
  useEffect(() => {
    if (activeNav !== 'Prise de commande') return
    const form = document.querySelector('.order-form')
    const summary = form?.querySelector('.order-summary')
    const submitButton = summary?.parentElement?.querySelector(':scope > .primary-button')
    submitButton?.setAttribute('aria-label', 'Envoyer en cuisine')
  }, [activeNav, selectedTable, dashboard?.orders[0]?.id])
  const tables = dashboard?.tables || []
  const reservations = dashboard?.reservations || []
  const tableZones = [...new Set(tables.map((table) => table.zone))]
  const currentStats = dashboard?.stats

  const handleReservation = async (data: { name: string; time: string; people: number }) => {
    try {
      const reservation = await createReservation(data)
      setDashboard((current) => current ? { ...current, reservations: [...current.reservations, reservation] } : current)
      setShowAdd(false)
    } catch { setApiError('Impossible d’enregistrer la réservation. Vérifiez que l’API est démarrée.') }
  }
  const handleOrder = async (items: OrderLine[], amount: number, note: string): Promise<boolean> => {
    if (!selectedTable || orderSubmissionInFlight.current) return false
    orderSubmissionInFlight.current = true
    try {
      const order = await createOrder({ table: selectedTable, items, amount, note })
      setDashboard((current) => current ? { ...current, orders: [order, ...current.orders] } : current)
      setServerNotice(`Commande #${order.id} envoyée en cuisine.`)
      setNotifications((current) => [{ id: `order-sent-${order.id}`, title: 'Commande envoyée', message: `Commande #${order.id} de la table ${selectedTable} transmise en cuisine.`, createdAt: new Date().toISOString(), target: 'Prise de commande', read: false }, ...current])
      return true
    } catch {
      setApiError('Impossible d’envoyer la commande. Vérifiez le rôle du serveur.')
      return false
    } finally {
      orderSubmissionInFlight.current = false
    }
  }
  const handleOrderStatus = async (id: string, status: string, paymentMethod?: 'cash' | 'card') => {
    try { const updated = await updateOrderStatus(id, status, paymentMethod); setDashboard((current) => current ? { ...current, orders: current.orders.map((order) => order.id === id ? updated : order) } : current) } catch { setApiError('Impossible de modifier le statut de la commande.') }
  }
  const handleCashDrawer = async () => { try { await openCashDrawer(); setServerNotice('Ordre d’ouverture envoyé au tiroir-caisse.') } catch { setApiError('Le tiroir-caisse n’est pas connecté.') } }
  const handleStock = async (id: string, quantity: number) => {
    try { const updated = await updateInventory(id, quantity); setInventory((current) => current.map((item) => item.id === id ? updated : item)) } catch { setApiError('Impossible de mettre à jour le stock.') }
  }
  const handleStockWithdrawal = async (items: { inventoryItemId: string; quantity: number }[], note: string) => {
    try {
      const result = await createStockWithdrawal(items, note)
      setInventory(result.inventory)
      setStockWithdrawals((current) => [result.withdrawal, ...current])
      setServerNotice(`Bon de sortie ${result.withdrawal.id} enregistré; stock déduit.`)
      setNotifications((current) => [{ id: result.withdrawal.id, title: 'Sortie de stock enregistrée', message: `${result.withdrawal.items.length} produit(s) déduits pour la cuisine.`, createdAt: result.withdrawal.createdAt, target: 'Approvisionnement', read: false }, ...current])
      return true
    } catch { setApiError('Impossible d’enregistrer le bon de sortie.')
      return false
    }
  }
  const handleMenuItem = async (item: { name: string; price: number; image: string }) => { try { const dish = await createMenuItem(item); setMenu((current) => [...current, dish]) } catch { setApiError('Impossible d’ajouter ce plat au menu.') } }
  const handleMenuUpdate = async (id: string, item: { name: string; price: number; image: string; active: boolean }) => { try { const updated = await updateMenuItem(id, item); setMenu((current) => current.map((dish) => dish.id === id ? updated : dish)) } catch { setApiError('Impossible de modifier ce plat.') } }
  const handleFloorPlanSave = async (plan: FloorPlanConfig) => { try { const saved = await saveFloorPlan(plan); setFloorPlan(saved); setServerNotice('Plan de salle enregistré.') } catch { setApiError('Impossible d’enregistrer le plan. Vérifiez que le PDF ne dépasse pas 12 Mo.') } }
  const handleTableCreate = async (input: { id: string; seats: number; zone: string }) => {
    const table = await createDiningTable(input)
    setDashboard((current) => current ? { ...current, tables: [...current.tables, table] } : current)
    setServerNotice(`Table ${table.id} ajoutée.`)
  }
  const handleTableUpdate = async (oldId: string, input: { id: string; seats: number; zone: string }) => {
    const table = await updateDiningTable(oldId, input)
    setDashboard((current) => current ? {
      ...current,
      tables: current.tables.map((item) => item.id === oldId ? table : item),
      orders: current.orders.map((order) => order.table === oldId ? { ...order, table: table.id } : order),
      reservations: current.reservations.map((reservation) => reservation.table === oldId ? { ...reservation, table: table.id } : reservation),
    } : current)
    setFloorPlan((current) => {
      if (!current || oldId === table.id || !current.positions[oldId]) return current
      const positions = { ...current.positions, [table.id]: current.positions[oldId] }
      delete positions[oldId]
      return { ...current, positions }
    })
    setSelectedTable((current) => current === oldId ? table.id : current)
    setServerNotice(`Table ${table.id} mise à jour.`)
  }
  const handleInvoiceDraft = async (draft: { sourceFileName: string; sourceType: 'pdf' | 'image'; extractedText: string; lines: StockReceipt['lines'] }): Promise<boolean> => { try { const receipt = await createStockReceiptDraft(draft); setStockReceipts((current) => [receipt, ...current]); setServerNotice('Brouillon d’entrée en stock créé; aucune quantité n’a encore été modifiée.'); return true } catch { setApiError('Impossible de créer le brouillon de facture.'); return false } }
  const handleReceiptReview = async (id: string, status: 'approved' | 'rejected') => { try { const result = await reviewStockReceipt(id, status); setStockReceipts((current) => current.map((receipt) => receipt.id === id ? result.receipt : receipt)); setInventory(result.inventory); setServerNotice(status === 'approved' ? 'Fiche validée; les quantités ont été ajoutées au stock.' : 'Fiche refusée; le stock n’a pas été modifié.') } catch { setApiError('Impossible de traiter cette fiche d’entrée.') } }
  const handleCreateInvoice = async (orderId: string, details: Omit<Parameters<typeof createInvoice>[0], 'orderId'>) => { try { const invoice = await createInvoice({ ...details, orderId }); setInvoiceOrder(null); setPrintDocument({ kind: 'invoice', invoice }); return invoice } catch (error) { setApiError(error instanceof Error ? error.message : 'Création de facture impossible.'); return null } }
  const handleSendInvoice = async (invoice: Invoice): Promise<boolean> => { try { await sendInvoiceEmail(invoice.id); setServerNotice(`Facture ${invoice.invoiceNumber} envoyée par e-mail.`); return true } catch (error) { setApiError(error instanceof Error ? error.message : 'Envoi e-mail impossible.'); return false } }
  const acceptRestaurant = async (access: { token: string; restaurant: RestaurantContext }) => {
    localStorage.setItem('restaurant-access-token', access.token)
    localStorage.removeItem('restaurant-token')
    setRestaurantContext(access.restaurant)
    setSessionUser(null)
    setDashboard(null)
    setApiError('')
    const availableProfiles = await getProfiles()
    setProfiles(availableProfiles)
  }
  const handleRestaurantLogin = async (identifier: string, password: string) => acceptRestaurant(await loginRestaurant(identifier, password))
  const handlePlatformLogin = async (username: string, password: string) => {
    const session = await loginPlatform(username, password)
    localStorage.setItem('platform-token', session.token)
    localStorage.removeItem('restaurant-token')
    localStorage.removeItem('restaurant-access-token')
    setRestaurantContext(null); setSessionUser(null); setDashboard(null); setPlatformLoginMode(false); setPlatformOwner(true)
  }
  const handlePlatformLogout = async () => {
    await Promise.allSettled([logoutPlatform()])
    localStorage.removeItem('platform-token')
    setPlatformOwner(false); setPlatformLoginMode(false); setSessionReady(true)
  }
  const handleTeamLogin = async (user: SessionUser, token: string) => {
    localStorage.setItem('restaurant-token', token)
    setSessionUser(user)
    setRole(user.role)
    setActiveNav(user.role === 'kitchen' ? 'Cuisine' : user.role === 'cashier' ? 'Caisse & paiements' : user.role === 'server' ? 'Prise de commande' : 'Vue d’ensemble')
    setSessionReady(true)
    try {
      const [data, stock, dishes, withdrawals, plan, receipts, availableProfiles] = await Promise.all([getDashboard(), getInventory(), getMenu(), getStockWithdrawals(), getFloorPlan(), getStockReceipts(), getProfiles()])
      previousOrderStatuses.current = Object.fromEntries(data.orders.map((order) => [order.id, order.status]))
      setDashboard(data); setInventory(stock); setMenu(dishes); setStockWithdrawals(withdrawals); setFloorPlan(plan); setStockReceipts(receipts); setProfiles(availableProfiles)
    } catch { setApiError('Connexion établie, mais les données du restaurant ne sont pas disponibles.') }
  }
  const handleCreateProfile = async (profile: { username: string; name: string; role: Role; pin: string }) => {
    const created = await createProfile(profile)
    setProfiles((current) => [...current, created].sort((left, right) => left.name.localeCompare(right.name)))
  }
  useEffect(() => { if (sessionUser?.role === 'manager') getStockReceipts().then(setStockReceipts).catch(() => undefined) }, [sessionUser])
  const handleLogout = async () => { try { await logout() } finally { localStorage.removeItem('restaurant-token'); setSessionUser(null); setDashboard(null); setSessionReady(true); setActiveNav('Vue d’ensemble') } }
  const handleRestaurantLogout = async () => { await Promise.allSettled([logout(), logoutRestaurant()]); localStorage.removeItem('restaurant-token'); localStorage.removeItem('restaurant-access-token'); setSessionUser(null); setRestaurantContext(null); setProfiles([]); setDashboard(null); setSessionReady(true); setActiveNav('Vue d’ensemble') }

  const authView = restaurantContext
    ? <LoginScreen restaurant={restaurantContext} profiles={profiles} onLogin={async (username, pin) => { const session = await login(username, pin); await handleTeamLogin(session.user, session.token) }} onSwitchRestaurant={handleRestaurantLogout} />
    : <RestaurantAccessScreenV2 onLogin={handleRestaurantLogin} onPlatformAccess={() => setPlatformLoginMode(true)} />

  const renderView = () => {
    if (activeNav === 'Vue d’ensemble') return <DashboardView dashboard={dashboard} tables={tables} tableZones={tableZones} reservations={reservations} onNavigate={setActiveNav} onTableSelect={(id) => { setSelectedTable(id); setActiveNav('Prise de commande') }} />
    if (activeNav === 'Plan de salle') return <ModuleView title="Plan de salle" description="Visualisez l’occupation et attribuez les tables." icon="⌖"><FloorPlan tables={tables} tableZones={tableZones} background={floorPlan} onSelect={(id) => { setSelectedTable(id); setActiveNav(role === 'cashier' ? 'Caisse & paiements' : 'Prise de commande') }} /></ModuleView>
    if (activeNav === 'Réservations') return <ModuleView title="Réservations" description="Gérez les arrivées et les couverts du service." icon="▦"><ReservationModule reservations={reservations} onCreate={() => setShowAdd(true)} /></ModuleView>
    if (activeNav === 'Cuisine') return <ModuleView title="Cuisine" description="Réception, préparation et commandes prêtes à envoyer en salle." icon="♨"><KitchenModule orders={(dashboard?.orders || []).filter((order) => order.status !== 'served' && order.status !== 'paid')} onStatus={handleOrderStatus} /></ModuleView>
    if (activeNav === 'Caisse & paiements') return <ModuleView title="Caisse & paiements" description="Sélectionnez une table, vérifiez l’addition et encaissez." icon="€"><CashierWorkspace orders={dashboard?.orders || []} tables={tables} tableZones={tableZones} background={floorPlan} selectedTable={selectedTable} onSelectTable={setSelectedTable} onClearTable={() => setSelectedTable('')} onPay={handleOrderStatus} onOpenDrawer={handleCashDrawer} onPrint={(order) => setPrintDocument({ kind: 'ticket', order })} onInvoice={(order) => setInvoiceOrder(order)} /></ModuleView>
    if (activeNav === 'Prise de commande') return <ModuleView title="Prise de commande" description={selectedTable ? `Table ${selectedTable} sélectionnée` : 'Choisissez une table avant de commander.'} icon="☷"><OrderModuleForm key={`${selectedTable}-${dashboard?.orders[0]?.id || 'empty'}`} menu={menu} selectedTable={selectedTable} onNavigate={setActiveNav} onCreate={handleOrder} /><ServerOrdersModule orders={dashboard?.orders || []} onStatus={handleOrderStatus} /></ModuleView>
    if (activeNav === 'Approvisionnement' && role === 'kitchen') return <ModuleView title="Sorties vers la cuisine" description="Enregistrez les ingrédients consommés; le stock sera déduit." icon="□"><KitchenStockModule items={inventory} onSubmit={handleStockWithdrawal} withdrawals={stockWithdrawals} /></ModuleView>
    if (activeNav === 'Approvisionnement') return <ModuleView title="Approvisionnement" description="Analysez les factures en brouillon; seules les fiches validées modifient le stock." icon="□"><InvoiceStockModule items={inventory} receipts={stockReceipts} onUpdate={handleStock} onAnalyze={(file, onProgress) => import('./invoiceOcr').then(({ analyzeInvoice }) => analyzeInvoice(file, inventory, onProgress))} onCreateDraft={handleInvoiceDraft} onReviewReceipt={handleReceiptReview} /><InventoryLevelsModule items={inventory} onUpdate={handleStock} /></ModuleView>
    if (activeNav === 'Finances') return <ModuleView title="Finances" description="Suivez les encaissements et le chiffre d’affaires du service." icon="€"><FinanceModule orders={dashboard?.orders || []} /></ModuleView>
      if (activeNav === 'Menu & plats') return <ModuleView title="Menu & plats" description="Créez vos plats, leurs prix et leurs photos." icon="♧"><MenuModule items={menu} onCreate={handleMenuItem} /></ModuleView>
    if (!sessionUser) return authView
    return <ModuleView title="Paramètres & configuration" description="Gérez les plats, les profils, les tables et le plan de salle." icon="⚙"><SettingsModule user={sessionUser} onLogout={handleLogout} onSwitchRestaurant={handleRestaurantLogout} menu={menu} onCreateMenuItem={handleMenuItem} onUpdateMenuItem={handleMenuUpdate} tables={tables} onCreateTable={handleTableCreate} onUpdateTable={handleTableUpdate} profiles={profiles} onCreateProfile={handleCreateProfile} floorPlan={floorPlan} onSaveFloorPlan={handleFloorPlanSave} storageMode={storageMode} /></ModuleView>
  }
  if (!sessionReady) return <div className="session-loading">Vérification de la session...</div>
  if (platformOwner) return <PlatformOwnerDashboard onLogout={handlePlatformLogout} />
  if (platformLoginMode) return <PlatformLoginScreen onLogin={handlePlatformLogin} onCancel={() => setPlatformLoginMode(false)} />
  if (!sessionUser) return authView
  return <div className="app-shell">
    <aside className={`sidebar ${mobileNavOpen ? 'mobile-open' : ''}`}>
      <div className="brand"><span className="brand-mark"><Utensils size={18} /></span><span>Service<span className="brand-accent">Pilot</span></span></div>
      <div className="workspace-switcher"><span className="avatar">{restaurantContext?.name.slice(0, 2).toUpperCase() || 'R'}</span><span><strong>{restaurantContext?.name || 'Restaurant'}</strong><small>{restaurantContext?.identifier || 'Espace restaurant'}</small></span><ChevronDown size={15} /></div>
      <p className="nav-caption">PILOTAGE</p>
      <nav>{navItems.filter(({ label }) => role === 'manager' || (role === 'server' && ['Prise de commande', 'Plan de salle', 'Réservations'].includes(label)) || (role === 'kitchen' && label === 'Cuisine') || (role === 'cashier' && ['Plan de salle', 'Caisse & paiements'].includes(label))).map(({ label, icon: Icon, badge }) => <button key={label} className={`nav-item ${activeNav === label ? 'active' : ''}`} onClick={() => { setActiveNav(label); setMobileNavOpen(false) }}><Icon size={18} /><span>{label}</span>{badge && <em>{badge}</em>}</button>)}</nav>
      <p className="nav-caption bottom-caption">{role === 'kitchen' ? 'STOCK CUISINE' : 'ADMINISTRATION'}</p>
      {role === 'manager' && <><button className="nav-item" onClick={() => { setActiveNav('Approvisionnement'); setMobileNavOpen(false) }}><Package size={18} /><span>Approvisionnement</span></button><button className="nav-item" onClick={() => { setActiveNav('Finances'); setMobileNavOpen(false) }}><CircleDollarSign size={18} /><span>Finances</span></button><button className="nav-item" onClick={() => { setActiveNav('Paramètres'); setMobileNavOpen(false) }}><Settings size={18} /><span>Paramètres</span></button></>}
      {role === 'kitchen' && <button className={`nav-item ${activeNav === 'Approvisionnement' ? 'active' : ''}`} onClick={() => { setActiveNav('Approvisionnement'); setMobileNavOpen(false) }}><Package size={18} /><span>Bons de sortie</span></button>}
      <div className="sidebar-footer"><div className="support-icon"><Bell size={17} /></div><div><strong>Besoin d’aide ?</strong><small>Centre de support</small></div><ArrowUpRight size={15} /></div>
    </aside>
    <main className="main-content">
      <header className="topbar"><button className="mobile-menu-button" aria-label="Ouvrir le menu" onClick={() => setMobileNavOpen(!mobileNavOpen)}>☰</button><div className="breadcrumb"><button className="home-button" onClick={() => setActiveNav(role === 'manager' ? 'Vue d’ensemble' : role === 'kitchen' ? 'Cuisine' : role === 'cashier' ? 'Caisse & paiements' : 'Prise de commande')}>Accueil</button><span className="dot">·</span><span>Bonjour {sessionUser.name}</span><span className="dot">·</span><span className="muted">Jeudi 24 septembre 2026</span></div><div className="top-actions"><div className="notification-wrap"><button className="icon-button notification" aria-label="Notifications" aria-expanded={notificationsOpen} onClick={() => setNotificationsOpen((open) => !open)}><Bell size={19} />{notifications.some((item) => !item.read) && <i />}</button>{notificationsOpen && <section className="notification-panel" aria-label="Centre de notifications"><header className="notification-panel-header"><div><strong>Notifications</strong><span>{notifications.filter((item) => !item.read).length} non lue(s)</span></div><button onClick={() => setNotifications((items) => items.map((item) => ({ ...item, read: true })))}>Tout lire</button></header><div className="notification-list">{notifications.length ? notifications.map((item) => <button key={item.id} className={`notification-item ${item.read ? 'read' : 'unread'}`} onClick={() => { setNotifications((items) => items.map((current) => current.id === item.id ? { ...current, read: true } : current)); setActiveNav(item.target); setNotificationsOpen(false) }}><span className="notification-avatar"><Bell size={15} /></span><span className="notification-copy"><strong>{item.title}</strong><span>{item.message}</span><time>{formatNotificationTime(item.createdAt)}</time></span>{!item.read && <i className="unread-dot" />}</button>) : <p className="notification-empty">Vous êtes à jour. Aucune notification.</p>}</div></section>}</div><div className="profile"><span className="avatar profile-avatar">{sessionUser.name.slice(0, 2).toUpperCase()}</span><span><strong>{sessionUser.name}</strong><small>{role === 'manager' ? 'Gérante' : role === 'server' ? 'Serveur' : role === 'kitchen' ? 'Cuisine' : 'Caissier'}</small></span></div><button className="logout-button" onClick={handleLogout}>Déconnexion</button></div></header>
      {apiError && <div className="api-error">{apiError}</div>}
      {serverNotice && <div className="server-notice"><Bell size={15} /><span>{serverNotice}</span><button onClick={() => setServerNotice('')} aria-label="Fermer">×</button></div>}
      {activeNav === 'Vue d’ensemble' && <div className="page-heading"><div><p className="eyebrow">JEUDI 24 SEPTEMBRE · SERVICE DU SOIR</p><h1>Vue d’ensemble</h1><p className="subtitle">Voici ce qui se passe dans votre restaurant aujourd’hui.</p></div><button className="primary-button" onClick={() => setShowAdd(true)}><Plus size={18} /> Nouvelle réservation</button></div>}
      {activeNav === 'Vue d’ensemble' && alertVisible && <div className="alert-banner"><div className="alert-symbol"><Archive size={18} /></div><div><strong>Stock à surveiller</strong><span>3 produits passent sous le seuil minimum cette semaine.</span></div><button onClick={() => setAlertVisible(false)} aria-label="Fermer">×</button></div>}
      {activeNav === 'Vue d’ensemble' && <section className="stats-grid"><StatCard icon={<CalendarDays size={19} />} label="Réservations du jour" value={String(currentStats?.reservations || 24)} note="+4 vs. jeudi dernier" trend="up" /><StatCard icon={<Users size={19} />} label="Couverts prévus" value={String(currentStats?.covers || 86)} note="72% de la capacité" trend="neutral" /><StatCard icon={<CircleDollarSign size={19} />} label="Chiffre d’affaires" value={`${(currentStats?.revenue || 2840).toLocaleString('fr-FR')} €`} note="+12,4% vs. hier" trend="up" /><StatCard icon={<Clock3 size={19} />} label="Temps moyen en salle" value={currentStats?.averageDuration || '1h42'} note="-8 min vs. moyenne" trend="up" /></section>}
      {renderView()}
    </main>
    {showAdd && <ReservationModal onClose={() => setShowAdd(false)} onSubmit={handleReservation} />}
    {invoiceOrder && <InvoiceComposer order={invoiceOrder} restaurantName={restaurantContext?.name || ''} onClose={() => setInvoiceOrder(null)} onCreate={handleCreateInvoice} />}
    {printDocument && <PrintPreview document={printDocument} restaurantName={restaurantContext?.name || 'Restaurant'} onClose={() => setPrintDocument(null)} onEmail={printDocument.kind === 'invoice' ? () => handleSendInvoice(printDocument.invoice) : undefined} />}
  </div>
}
function StatCard({ icon, label, value, note, trend }: { icon: React.ReactNode; label: string; value: string; note: string; trend: 'up' | 'neutral' }) { return <article className="stat-card"><div className="stat-icon">{icon}</div><span className="stat-label">{label}</span><strong className="stat-value">{value}</strong><span className={`stat-note ${trend}`}>{note}</span></article> }
function Reservation({ time, name, detail, status }: { time: string; name: string; detail: string; status: string }) { return <div className="reservation"><time>{time}</time><div className="reservation-info"><strong>{name}</strong><span>{detail}</span></div><em>{status}</em></div> }
function Activity({ icon, color, title, detail, trailing }: { icon: React.ReactNode; color: string; title: string; detail: string; trailing: string }) { return <div className="activity-row"><span className={`activity-icon ${color}`}>{icon}</span><div><strong>{title}</strong><small>{detail}</small></div><span className={color === 'green' ? 'activity-tag' : 'activity-price'}>{trailing}</span></div> }
function DashboardView({ dashboard, tables, tableZones, reservations, onNavigate, onTableSelect }: { dashboard: Dashboard | null; tables: RestaurantTable[]; tableZones: string[]; reservations: Dashboard['reservations']; onNavigate: (view: string) => void; onTableSelect: (id: string) => void }) { return <><div className="content-grid"><section className="panel floor-panel"><div className="panel-heading"><div><h2>Plan de salle</h2><p>État des tables en temps réel</p></div><button className="text-button" onClick={() => onNavigate('Plan de salle')}>Voir le plan <ArrowUpRight size={15} /></button></div><FloorPlan tables={tables} tableZones={tableZones} onSelect={onTableSelect} /></section><section className="panel service-panel"><div className="panel-heading"><div><h2>Prochaines réservations</h2><p>Les arrivées des 90 prochaines minutes</p></div><button className="more-button" aria-label="Plus d’options"><MoreHorizontal size={19} /></button></div><div className="reservation-list">{reservations.slice(0, 3).map((reservation, index) => <Reservation key={reservation.id} time={reservation.time} name={reservation.name} detail={`${reservation.people} personnes · Table ${reservation.table}`} status={`Dans ${12 + index * 15} min`} />)}</div><button className="bottom-link" onClick={() => onNavigate('Réservations')}>Toutes les réservations <ArrowUpRight size={15} /></button></section></div><section className="panel activity-panel"><div className="panel-heading"><div><h2>Activité du service</h2><p>Suivi en direct de l’équipe</p></div><span className="live-status"><i /> En direct</span></div>{(dashboard?.orders || []).map((order) => <Activity key={order.id} icon={<ClipboardList size={17} />} color={order.status === 'paid' ? 'orange' : 'blue'} title={order.status === 'paid' ? `Addition #${order.id} encaissée` : `Commande #${order.id} envoyée en cuisine`} detail={`Table ${order.table} · ${order.items} articles`} trailing={`${order.amount.toFixed(2).replace('.', ',')} €`} />)}</section></> }
function FloorPlan({ tables, tableZones, onSelect, background, positions, placingTableId, onPlace }: { tables: RestaurantTable[]; tableZones: string[]; onSelect: (id: string) => void; background?: FloorPlanConfig | null; positions?: FloorPlanConfig['positions']; placingTableId?: string; onPlace?: (id: string, point: { x: number; y: number }) => void }) {
  const zoneLabels = tableZones.length ? tableZones : [...new Set(tables.map((table) => table.zone))]
  const placeSelectedTable = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!placingTableId || !onPlace || (event.target as HTMLElement).closest('.floor-map-table')) return
    const bounds = event.currentTarget.getBoundingClientRect()
    onPlace(placingTableId, {
      x: Math.min(96, Math.max(4, ((event.clientX - bounds.left) / bounds.width) * 100)),
      y: Math.min(90, Math.max(10, ((event.clientY - bounds.top) / bounds.height) * 100)),
    })
  }
  return <><div className={`floor-map-canvas ${placingTableId ? 'placing' : ''}`} onClick={placeSelectedTable} aria-label="Plan graphique du restaurant">
    <div className="floor-plan-header"><span>PLAN DE SALLE</span><span>{tables.length} tables</span></div>
    <div className="floor-plan-counter">COMPTOIR <i /><i /><i /></div>
    <div className="floor-plan-kitchen">CUISINE</div>
    <div className="floor-plan-zones">{zoneLabels.map((zone, index) => <span key={zone} className={`floor-plan-zone zone-${index % 3}`}>{zone}</span>)}</div>
    <div className="floor-plan-entrance"><i />ENTRÉE</div>
    {tables.map((table, index) => {
      const position = positions?.[table.id] || background?.positions?.[table.id] || defaultTablePosition(index)
      return <button key={table.id} className={`floor-map-table ${table.status} ${placingTableId === table.id ? 'selected' : ''}`} style={{ left: `${position.x}%`, top: `${position.y}%` }} onClick={(event) => { event.stopPropagation(); onSelect(table.id) }} aria-label={`${table.id}, ${table.seats} places, ${table.status === 'occupied' ? 'occupée' : table.status === 'reserved' ? 'réservée' : 'libre'}`}><strong>{table.id}</strong><small>{table.seats} pl.</small></button>
    })}
  </div><div className="legend"><span><i className="legend-dot free-dot" />Libre</span><span><i className="legend-dot occupied-dot" />En service</span><span><i className="legend-dot reserved-dot" />Réservée</span></div></>
}
function defaultTablePosition(index: number) { return { x: 12 + (index % 5) * 19, y: 18 + Math.floor(index / 5) * 35 } }
function ModuleView({ title, description, icon, children }: { title: string; description: string; icon: string; children: React.ReactNode }) { return <><div className="page-heading module-heading"><div><p className="eyebrow">MODULE OPÉRATIONNEL</p><h1><span className="module-icon">{icon}</span>{title}</h1><p className="subtitle">{description}</p></div></div>{children}</> }
function ReservationModule({ reservations, onCreate }: { reservations: Dashboard['reservations']; onCreate: () => void }) { return <section className="panel module-list"><div className="module-list-heading"><strong>Réservations du service</strong><button className="text-button" onClick={onCreate}>+ Ajouter</button></div>{reservations.map((reservation) => <div className="module-row" key={reservation.id}><time>{reservation.time}</time><div><strong>{reservation.name}</strong><small>{reservation.people} personnes · Table {reservation.table}</small></div><span className="status-pill">Confirmée</span></div>)}</section> }
function KitchenModule({ orders, onStatus }: { orders: Dashboard['orders']; onStatus: (id: string, status: string) => void }) { const labels: Record<string, string> = { received: 'Reçue', preparing: 'En préparation', ready: 'Prête' }; return <section className="panel module-list"><div className="module-list-heading"><strong>Commandes à préparer</strong><span className="live-status"><i /> En direct</span></div>{orders.filter((order) => order.status !== 'paid').map((order) => <div className="module-row kitchen-row" key={order.id}><span className="order-number">#{order.id}</span><div><strong>Table {order.table}</strong><small>{order.items} articles · {order.note || 'Aucune remarque'}</small><span className="order-lines">{order.lines?.map((line) => `${line.quantity}× ${line.name}`).join(' · ')}</span></div><span className={`status-pill ${order.status === 'ready' ? '' : 'orange-pill'}`}>{labels[order.status]}</span>{order.status === 'received' && <button className="action-button" onClick={() => onStatus(order.id, 'preparing')}>Commencer</button>}{order.status === 'preparing' && <button className="action-button" onClick={() => onStatus(order.id, 'ready')}>Prête</button>}</div>)}</section> }
function CashierModule({ orders, onPay, onOpenDrawer, onPrint, onInvoice }: { orders: Dashboard['orders']; onPay: (id: string, status: string, paymentMethod?: 'cash' | 'card') => void; onOpenDrawer: () => void; onPrint: (order: Order) => void; onInvoice: (order: Order) => void }) { return <section className="panel module-list"><div className="module-list-heading"><strong>Encaissements du service</strong><div className="cashier-actions"><span>{orders.filter((order) => order.status === 'paid').length} payé(s)</span><button className="action-button" onClick={onOpenDrawer}>Ouvrir le tiroir</button></div></div>{orders.length ? orders.map((order) => <div className="module-row cashier-order-row" key={order.id}><span className="order-number">#{order.id}</span><div className="cashier-order-details"><strong>Table {order.table}</strong><small>{order.items} articles · {order.amount.toFixed(2).replace('.', ',')} €</small>{order.lines?.length ? <div className="cashier-order-lines">{order.lines.map((line, index) => <span key={`${order.id}-${index}`}>{line.quantity} × {line.name}<b>{(line.quantity * line.price).toFixed(2).replace('.', ',')} €</b></span>)}</div> : <small className="cashier-lines-missing">Détail des articles indisponible pour cette ancienne commande.</small>}</div>{order.status === 'paid' ? <><span className="status-pill">Déjà réglée · {order.paymentMethod === 'cash' ? 'Espèces' : 'CB / TPE'}</span><div className="receipt-actions"><button className="action-button" onClick={() => onPrint(order)}>Ticket</button><button className="action-button" onClick={() => onInvoice(order)}>Facture</button></div></> : <div className="payment-actions"><button className="action-button" onClick={() => onPay(order.id, 'paid', 'cash')}>Espèces · {order.amount.toFixed(2).replace('.', ',')} €</button><button className="action-button" onClick={() => onPay(order.id, 'paid', 'card')}>CB · {order.amount.toFixed(2).replace('.', ',')} €</button></div>}</div>) : <p className="cashier-empty-state">Aucune addition à régler pour cette table.</p>}</section> }
function OrderModuleForm({ menu, selectedTable, onNavigate, onCreate }: { menu: MenuItem[]; selectedTable: string; onNavigate: (view: string) => void; onCreate: (items: OrderLine[], amount: number, note: string) => void }) { const [cart, setCart] = useState<OrderLine[]>([]); const [note, setNote] = useState(''); const addItem = (name: string, price: number) => setCart((current) => { const found = current.find((item) => item.name === name); return found ? current.map((item) => item.name === name ? { ...item, quantity: item.quantity + 1 } : item) : [...current, { name, price, quantity: 1 }] }); const changeQuantity = (name: string, quantity: number) => setCart((current) => quantity < 1 ? current.filter((item) => item.name !== name) : current.map((item) => item.name === name ? { ...item, quantity } : item)); const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0); return <section className="panel order-module"><div className="order-form"><span className="empty-icon">☷</span><h2>{selectedTable ? `Commande pour ${selectedTable}` : 'Choisissez une table pour commencer'}</h2>{selectedTable ? <><div className="menu-grid">{menu.filter((item) => item.active).map((item) => <button key={item.id} className="menu-item menu-card" onClick={() => addItem(item.name, item.price)}><img src={item.image} alt="" /><span><strong>{item.name}</strong><small>{item.price} € · Ajouter</small></span></button>)}</div><div className="order-summary"><strong>Votre commande</strong>{cart.length ? cart.map((item) => <div className="summary-row" key={item.name}><span>{item.name}</span><input type="number" min="1" value={item.quantity} aria-label={`Quantité ${item.name}`} onChange={(event) => changeQuantity(item.name, Number(event.target.value))} /><b>{(item.price * item.quantity).toFixed(2).replace('.', ',')} €</b></div>) : <p>Aucun article ajouté.</p>}<div className="summary-total"><span>Total</span><strong>{total.toFixed(2).replace('.', ',')} €</strong></div></div><label className="order-note">Remarque pour la cuisine<textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Allergie, cuisson, sans accompagnement..." /></label><button className="primary-button" disabled={!cart.length} onClick={() => onCreate(cart, total, note)}>Envoyer en cuisine, rester au serveur <ArrowUpRight size={16} /></button></> : <><p>Le serveur peut sélectionner une table puis ajouter les articles.</p><button className="primary-button" onClick={() => onNavigate('Plan de salle')}>Choisir une table <ArrowUpRight size={16} /></button></>}</div></section> }
function InventoryLevelsModule({ items, onUpdate }: { items: InventoryItem[]; onUpdate: (id: string, quantity: number) => void }) { const [fileName, setFileName] = useState(''); return <section className="panel module-list"><div className="module-list-heading"><strong>État du stock</strong><span>{items.filter((item) => item.quantity <= item.minimum).length} alerte(s)</span></div><div className="stock-import"><label className="upload-button">Importer une facture PDF<input type="file" accept="application/pdf,image/*" capture="environment" onChange={(event) => setFileName(event.target.files?.[0]?.name || '')} /></label><span>{fileName || 'PDF ou photo de facture'}</span></div>{items.map((item) => <div className="module-row" key={item.id}><div><strong>{item.name}</strong><small>{item.supplier} · seuil {item.minimum} {item.unit}</small></div><input className="quantity-input" type="number" min="0" value={item.quantity} onChange={(event) => onUpdate(item.id, Number(event.target.value))} /><span className={`status-pill ${item.quantity <= item.minimum ? 'orange-pill' : ''}`}>{item.quantity <= item.minimum ? 'À commander' : 'OK'}</span></div>)}</section> }
function MenuModule({ items, onCreate }: { items: MenuItem[]; onCreate: (item: { name: string; price: number; image: string }) => void }) {
  const [name, setName] = useState('')
  const [price, setPrice] = useState('')
  const [image, setImage] = useState('')
  const readImage = (file?: File) => {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setImage(String(reader.result || ''))
    reader.readAsDataURL(file)
  }
  const addDish = () => {
    onCreate({ name, price: Number(price), image })
    setName('')
    setPrice('')
    setImage('')
  }
  return <section className="panel menu-admin"><div className="module-list-heading"><strong>Plats disponibles</strong><span>{items.length} plats</span></div><div className="menu-admin-grid">{items.map((item) => <article key={item.id}><img src={item.image} alt="" /><strong>{item.name}</strong><span>{item.price.toFixed(2).replace('.', ',')} €</span></article>)}</div><div className="add-dish"><strong>Créer un nouveau plat</strong><div className="dish-fields"><input placeholder="Nom du plat" value={name} onChange={(event) => setName(event.target.value)} /><input type="number" min="0.01" step="0.01" placeholder="Prix €" value={price} onChange={(event) => setPrice(event.target.value)} /><label className="dish-photo-upload">{image.startsWith('data:') ? <><img className="dish-photo-preview" src={image} alt="" />Remplacer la photo</> : 'Prendre une photo'}<input type="file" accept="image/*" capture="environment" onChange={(event) => readImage(event.target.files?.[0])} /></label><input aria-label="URL de la photo (facultatif)" placeholder="Ou URL de la photo" value={image.startsWith('data:') ? '' : image} onChange={(event) => setImage(event.target.value)} /><button className="action-button" disabled={!name.trim() || !price || Number(price) <= 0} onClick={addDish}>Ajouter au menu</button></div></div></section>
}
function FinanceModule({ orders }: { orders: Dashboard['orders'] }) { const revenue = orders.filter((order) => order.status === 'paid').reduce((sum, order) => sum + order.amount, 0); const vat = revenue * 0.1; return <><section className="panel finance-grid"><article><span>CA encaissé</span><strong>{revenue.toFixed(2).replace('.', ',')} €</strong></article><article><span>TVA estimée (10%)</span><strong>{vat.toFixed(2).replace('.', ',')} €</strong></article><article><span>Panier moyen</span><strong>{orders.length ? `${(revenue / orders.length).toFixed(2).replace('.', ',')} €` : '0,00 €'}</strong></article></section><section className="panel finance-report"><div><strong>Clôture et déclaration</strong><span>Journal des ventes, TVA collectée et export comptable</span></div><button className="action-button" onClick={() => window.print()}>Imprimer le rapport</button></section></> }
function SettingsModule({ user, onLogout, onSwitchRestaurant, menu, onCreateMenuItem, onUpdateMenuItem, tables, onCreateTable, onUpdateTable, profiles, onCreateProfile, floorPlan, onSaveFloorPlan, storageMode }: { user: SessionUser | null; onLogout: () => void; onSwitchRestaurant: () => void; menu: MenuItem[]; onCreateMenuItem: (item: { name: string; price: number; image: string }) => void; onUpdateMenuItem: (id: string, item: { name: string; price: number; image: string; active: boolean }) => void; tables: RestaurantTable[]; onCreateTable: (table: { id: string; seats: number; zone: string }) => Promise<void>; onUpdateTable: (oldId: string, table: { id: string; seats: number; zone: string }) => Promise<void>; profiles: TeamProfile[]; onCreateProfile: (profile: { username: string; name: string; role: Role; pin: string }) => Promise<void>; floorPlan: FloorPlanConfig | null; onSaveFloorPlan: (plan: FloorPlanConfig) => Promise<void>; storageMode: 'postgresql' | 'local-json' | 'unknown' }) {
  return <div className="settings-stack"><section className="panel settings-module"><div><strong>Session active</strong><span>{user?.name} · {user?.role}</span></div><div className="storage-status"><strong>Base partagée</strong><span>{storageMode === 'postgresql' ? 'PostgreSQL Render' : storageMode === 'local-json' ? 'JSON local à cet ordinateur' : 'État de la connexion inconnu'}</span></div><button className="action-button" onClick={onLogout}>Fermer la session</button><button className="text-button" onClick={onSwitchRestaurant}>Changer de restaurant</button></section><ProfilesConfiguration profiles={profiles} onCreate={onCreateProfile} /><MenuConfiguration items={menu} onCreate={onCreateMenuItem} onUpdate={onUpdateMenuItem} /><TableConfiguration tables={tables} onCreate={onCreateTable} onUpdate={onUpdateTable} /><FloorPlanConfiguration tables={tables} floorPlan={floorPlan} onSave={onSaveFloorPlan} /></div>
}

function ProfilesConfiguration({ profiles, onCreate }: { profiles: TeamProfile[]; onCreate: (profile: { username: string; name: string; role: Role; pin: string }) => Promise<void> }) {
  const [username, setUsername] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState<Role>('server')
  const [pin, setPin] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const roleNames: Record<Role, string> = { manager: 'Gérant', server: 'Serveur', kitchen: 'Cuisine', cashier: 'Caissier' }
  const submit = async () => {
    if (saving) return
    setSaving(true)
    setError('')
    try {
      await onCreate({ username: username.trim().toLowerCase(), name: name.trim(), role, pin })
      setUsername(''); setName(''); setPin('')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Création du profil impossible.') }
    finally { setSaving(false) }
  }
  return <section className="panel profile-config"><div className="module-list-heading"><strong>Profils de l’équipe</strong><span>{profiles.length} utilisateurs</span></div><div className="profile-list">{profiles.map((profile) => <article className="profile-row" key={profile.id}><div><strong>{profile.name}</strong><small>@{profile.username}</small></div><span className="status-pill">{roleNames[profile.role]}</span></article>)}</div><div className="profile-editor"><strong>Créer un profil</strong><div className="profile-editor-fields"><label>Nom d’utilisateur<input autoComplete="off" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="ex. samira" /></label><label>Nom affiché<input value={name} onChange={(event) => setName(event.target.value)} placeholder="ex. Samira Benali" /></label><label>Rôle<select value={role} onChange={(event) => setRole(event.target.value as Role)}><option value="server">Serveur</option><option value="cashier">Caissier</option><option value="kitchen">Cuisine</option><option value="manager">Gérant</option></select></label><label>Code PIN (4 à 12 chiffres)<input type="password" inputMode="numeric" autoComplete="new-password" maxLength={12} value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))} /></label><button className="primary-button" disabled={!username.trim() || !name.trim() || pin.length < 4 || saving} onClick={submit}>{saving ? 'Création...' : 'Créer le profil'}</button></div>{error && <p className="login-error">{error}</p>}</div></section>
}

function TableConfiguration({ tables, onCreate, onUpdate }: { tables: RestaurantTable[]; onCreate: (table: { id: string; seats: number; zone: string }) => Promise<void>; onUpdate: (oldId: string, table: { id: string; seats: number; zone: string }) => Promise<void> }) {
  const zones = [...new Set(tables.map((table) => table.zone).filter(Boolean))]
  const [editingId, setEditingId] = useState('')
  const [name, setName] = useState('')
  const [seats, setSeats] = useState(2)
  const [zone, setZone] = useState(zones[0] || 'Salle')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const reset = () => { setEditingId(''); setName(''); setSeats(2); setZone(zones[0] || 'Salle'); setError('') }
  const edit = (table: RestaurantTable) => { setEditingId(table.id); setName(table.id); setSeats(table.seats); setZone(table.zone); setError('') }
  const submit = async () => {
    if (!name.trim() || saving) return
    setSaving(true)
    setError('')
    try {
      const input = { id: name.trim(), seats, zone: zone.trim() || 'Salle' }
      if (editingId) await onUpdate(editingId, input)
      else await onCreate(input)
      reset()
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Enregistrement impossible.') }
    finally { setSaving(false) }
  }
  return <section className="panel table-config">
    <div className="module-list-heading"><strong>Tables et places</strong><span>{tables.length} tables</span></div>
    <div className="table-config-list">{tables.map((table) => <article className="table-config-row" key={table.id}><span className={`table-config-icon ${table.status}`} aria-hidden="true" /><div><strong>{table.id}</strong><small>{table.seats} places · {table.zone}</small></div><button className="action-button" onClick={() => edit(table)}>Modifier</button></article>)}</div>
    <div className="table-editor"><strong>{editingId ? `Modifier ${editingId}` : 'Ajouter une table'}</strong><div className="table-editor-fields"><label>Nom / numéro<input value={name} maxLength={24} onChange={(event) => setName(event.target.value)} placeholder="Ex. T12" /></label><label>Nombre de places<select value={seats} onChange={(event) => setSeats(Number(event.target.value))}>{Array.from({ length: 12 }, (_, index) => index + 1).map((count) => <option key={count} value={count}>{count} {count === 1 ? 'place' : 'places'}</option>)}</select></label><label>Zone<input list="dining-zones" value={zone} maxLength={40} onChange={(event) => setZone(event.target.value)} placeholder="Salle, terrasse…" /><datalist id="dining-zones">{zones.map((item) => <option key={item} value={item} />)}</datalist></label><div className="table-editor-actions">{editingId && <button className="text-button" onClick={reset}>Annuler</button>}<button className="primary-button" disabled={!name.trim() || saving} onClick={submit}>{saving ? 'Enregistrement…' : editingId ? 'Enregistrer les changements' : 'Ajouter la table'}</button></div></div>{error && <p className="login-error">{error}</p>}</div>
  </section>
}
function MenuConfiguration({ items, onCreate, onUpdate }: { items: MenuItem[]; onCreate: (item: { name: string; price: number; image: string }) => void; onUpdate: (id: string, item: { name: string; price: number; image: string; active: boolean }) => void }) { const [editingId, setEditingId] = useState(''); const [name, setName] = useState(''); const [price, setPrice] = useState(''); const [image, setImage] = useState(''); const [active, setActive] = useState(true); const readImage = (file?: File) => { if (!file) return; const reader = new FileReader(); reader.onload = () => setImage(String(reader.result || '')); reader.readAsDataURL(file) }; const startEdit = (dish: MenuItem) => { setEditingId(dish.id); setName(dish.name); setPrice(String(dish.price)); setImage(dish.image); setActive(dish.active) }; const reset = () => { setEditingId(''); setName(''); setPrice(''); setImage(''); setActive(true) }; return <section className="panel menu-config"><div className="module-list-heading"><strong>Menu et plats</strong><span>{items.length} plats</span></div><div className="menu-config-list">{items.map((dish) => <article key={dish.id} className="menu-config-row"><img src={dish.image} alt="" /><div><strong>{dish.name}</strong><span>{dish.price.toFixed(2).replace('.', ',')} € · {dish.active ? 'Disponible' : 'Masqué'}</span></div><button className="action-button" onClick={() => startEdit(dish)}>Modifier</button></article>)}</div><div className="dish-editor"><strong>{editingId ? 'Modifier le plat' : 'Ajouter un plat'}</strong><div className="dish-fields"><input placeholder="Nom du plat" value={name} onChange={(event) => setName(event.target.value)} /><input type="number" min="0.01" step="0.01" placeholder="Prix €" value={price} onChange={(event) => setPrice(event.target.value)} /><label className="dish-photo-upload">Prendre une photo<input type="file" accept="image/*" capture="environment" onChange={(event) => readImage(event.target.files?.[0])} /></label><label className="dish-photo-upload">Choisir une image<input type="file" accept="image/*" onChange={(event) => readImage(event.target.files?.[0])} /></label>{editingId && <label className="dish-active-toggle"><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} /> Disponible</label>}<button className="action-button" disabled={!name.trim() || !price || Number(price) <= 0} onClick={() => { const value = { name: name.trim(), price: Number(price), image, active }; if (editingId) onUpdate(editingId, value); else onCreate(value); reset() }}>{editingId ? 'Enregistrer' : 'Ajouter au menu'}</button>{editingId && <button className="text-button" onClick={reset}>Annuler</button>}</div></div></section> }
function FloorPlanConfiguration({ tables, floorPlan, onSave }: { tables: RestaurantTable[]; floorPlan: FloorPlanConfig | null; onSave: (plan: FloorPlanConfig) => Promise<void> }) {
  const [draft, setDraft] = useState<FloorPlanConfig | null>(floorPlan)
  const [placingTableId, setPlacingTableId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => setDraft(floorPlan), [floorPlan])
  const readPdf = (file?: File) => {
    if (!file) return
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) { setError('Choisissez un fichier PDF.'); return }
    if (file.size > 12 * 1024 * 1024) { setError('Le PDF dépasse 12 Mo.'); return }
    setDraft((current) => ({ fileName: file.name, pdfData: '', positions: current?.positions || {} }))
    setError('')
  }
  const submit = async () => {
    if (!draft) return
    setSaving(true)
    setError('')
    try { await onSave({ ...draft, pdfData: '' }); setPlacingTableId('') }
    catch { setError('Enregistrement impossible.') }
    finally { setSaving(false) }
  }
  return <section className="panel floor-config">
    <div className="module-list-heading"><strong>Plan graphique de la salle</strong><span>{draft?.fileName || 'Aucun plan de référence'}</span></div>
    <div className="floor-config-toolbar">
      <label className="upload-button">Importer le PDF de référence<input type="file" accept="application/pdf,.pdf" onChange={(event) => readPdf(event.target.files?.[0])} /></label>
      <select aria-label="Table à déplacer" value={placingTableId} onChange={(event) => setPlacingTableId(event.target.value)}><option value="">Choisir une table à déplacer</option>{tables.map((table) => <option key={table.id} value={table.id}>{table.id} · {table.seats} places</option>)}</select>
      <button className="action-button" disabled={!draft || saving} onClick={submit}>{saving ? 'Enregistrement...' : 'Enregistrer le plan'}</button>
    </div>
    {error && <p className="login-error">{error}</p>}
    {draft ? <><p className="floor-config-help">{placingTableId ? `Touchez un emplacement pour déplacer ${placingTableId}.` : 'Importez le plan de référence, puis choisissez une table à déplacer.'}</p><FloorPlan tables={tables} tableZones={[...new Set(tables.map((table) => table.zone))]} onSelect={setPlacingTableId} background={draft} positions={draft.positions} placingTableId={placingTableId} onPlace={(id, point) => { setDraft((current) => current ? { ...current, positions: { ...current.positions, [id]: point } } : current); setPlacingTableId('') }} /></> : <p className="floor-config-empty">Importez le plan existant pour créer et enregistrer sa version graphique.</p>}
  </section>
}
export function RestaurantAccessScreen({ onLogin, onRegister }: { onLogin: (identifier: string, password: string) => Promise<void>; onRegister: (input: { identifier: string; name: string; password: string; managerUsername: string; managerName: string; managerPin: string }) => Promise<void> }) {
  const [registering, setRegistering] = useState(false)
  const [identifier, setIdentifier] = useState('')
  const [restaurantName, setRestaurantName] = useState('')
  const [password, setPassword] = useState('')
  const [managerUsername, setManagerUsername] = useState('')
  const [managerName, setManagerName] = useState('')
  const [managerPin, setManagerPin] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const submit = async () => {
    if (loading) return
    setLoading(true); setError('')
    try {
      if (registering) await onRegister({ identifier, name: restaurantName, password, managerUsername, managerName: managerName || managerUsername, managerPin })
      else await onLogin(identifier, password)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Connexion impossible.') }
    finally { setLoading(false) }
  }
  return <div className="login-screen"><div className="login-card restaurant-access-card"><div className="brand login-brand"><span className="brand-mark"><Utensils size={18} /></span><span>Service<span className="brand-accent">Pilot</span></span></div><p className="eyebrow">ESPACE RESTAURANT</p><h1>{registering ? 'Créer un établissement' : 'Accéder à votre restaurant'}</h1><p className="login-subtitle">{registering ? 'Créez l’accès restaurant et le premier profil gérant.' : 'Saisissez l’identifiant et le mot de passe de votre établissement.'}</p><div className="auth-mode-tabs"><button className={!registering ? 'active' : ''} onClick={() => { setRegistering(false); setError('') }}>Connexion</button><button className={registering ? 'active' : ''} onClick={() => { setRegistering(true); setError('') }}>Créer un restaurant</button></div>{registering && <label>Nom du restaurant<input value={restaurantName} onChange={(event) => setRestaurantName(event.target.value)} placeholder="Le Mijoté" /></label>}<label>Identifiant restaurant<input autoCapitalize="none" autoComplete="username" value={identifier} onChange={(event) => setIdentifier(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))} placeholder="ex. le-mijote-paris" /></label>{registering && <><p className="auth-help">Pour rattacher les données locales existantes, utilise l’identifiant <strong>restaurant-demo</strong>.</p><label>Nom d’utilisateur du gérant<input autoCapitalize="none" autoComplete="off" value={managerUsername} onChange={(event) => setManagerUsername(event.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ''))} placeholder="ex. louise" /></label><label>Nom affiché du gérant<input value={managerName} onChange={(event) => setManagerName(event.target.value)} placeholder="ex. Louise Martin" /></label><label>Code PIN gérant (4 à 12 chiffres)<input type="password" inputMode="numeric" autoComplete="new-password" maxLength={12} value={managerPin} onChange={(event) => setManagerPin(event.target.value.replace(/\D/g, ''))} /></label></>}<label>{registering ? 'Mot de passe restaurant (8 caractères minimum)' : 'Mot de passe restaurant'}<input type="password" autoComplete={registering ? 'new-password' : 'current-password'} value={password} onChange={(event) => setPassword(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && submit()} /></label>{error && <p className="login-error">{error}</p>}<button className="primary-button login-submit" disabled={loading || !identifier || !password || (registering && (!restaurantName.trim() || !managerUsername.trim() || managerPin.length < 4 || password.length < 8))} onClick={submit}>{loading ? 'Connexion...' : registering ? 'Créer le restaurant' : 'Continuer'}</button></div></div>
}

function RestaurantAccessScreenV2({ onLogin, onPlatformAccess }: { onLogin: (identifier: string, password: string) => Promise<void>; onPlatformAccess: () => void }) {
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const submit = async () => {
    if (loading) return
    setLoading(true); setError('')
    try { await onLogin(identifier, password) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Connexion impossible.') }
    finally { setLoading(false) }
  }
  return <div className="login-screen"><div className="login-card"><div className="brand login-brand"><span className="brand-mark"><Utensils size={18} /></span><span>Service<span className="brand-accent">Pilot</span></span></div><p className="eyebrow">ESPACE RESTAURANT</p><h1>Accéder à votre restaurant</h1><p className="login-subtitle">Saisissez votre identifiant (code ou adresse e-mail) et mot de passe.</p><label>Identifiant restaurant<input type="text" inputMode="email" autoCapitalize="none" autoComplete="username" value={identifier} onChange={(event) => setIdentifier(event.target.value.toLowerCase())} placeholder="ex. contact@monrestaurant.fr" /></label><label>Mot de passe restaurant<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && submit()} /></label>{error && <p className="login-error">{error}</p>}<button className="primary-button login-submit" disabled={loading || !identifier.trim() || !password} onClick={submit}>{loading ? 'Connexion...' : 'Continuer'}</button><button className="switch-restaurant-button" onClick={onPlatformAccess}>Propriétaire de l’application</button></div></div>
}

function PlatformLoginScreen({ onLogin, onCancel }: { onLogin: (username: string, password: string) => Promise<void>; onCancel: () => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const submit = async () => {
    if (loading) return
    setLoading(true); setError('')
    try { await onLogin(username, password) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Connexion propriétaire impossible.') }
    finally { setLoading(false) }
  }
  return <div className="login-screen"><div className="login-card"><div className="brand login-brand"><span className="brand-mark"><Utensils size={18} /></span><span>Service<span className="brand-accent">Pilot</span></span></div><p className="eyebrow">ADMINISTRATION SAAS</p><h1>Portail propriétaire</h1><p className="login-subtitle">Accès réservé à l’administration de la plateforme.</p><label>Identifiant propriétaire<input autoCapitalize="none" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} /></label><label>Mot de passe<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && submit()} /></label>{error && <p className="login-error">{error}</p>}<button className="primary-button login-submit" disabled={loading || !username || !password} onClick={submit}>{loading ? 'Vérification...' : 'Ouvrir le portail'}</button><button className="switch-restaurant-button" onClick={onCancel}>Retour à la connexion restaurant</button></div></div>
}

function PlatformOwnerDashboard({ onLogout }: { onLogout: () => Promise<void> }) {
  const [overview, setOverview] = useState<PlatformOverview | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [planName, setPlanName] = useState('')
  const [planDays, setPlanDays] = useState(30)
  const [planPrice, setPlanPrice] = useState('29')
  const [restaurantName, setRestaurantName] = useState('')
  const [identifier, setIdentifier] = useState('')
  const [restaurantPassword, setRestaurantPassword] = useState('')
  const [managerUsername, setManagerUsername] = useState('')
  const [managerName, setManagerName] = useState('')
  const [managerPin, setManagerPin] = useState('')
  const [selectedPlanId, setSelectedPlanId] = useState('')
  const [rowPlans, setRowPlans] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const refresh = async () => setOverview(await getPlatformOverview())
  useEffect(() => { getPlatformOverview().then(setOverview).catch((reason) => setError(reason instanceof Error ? reason.message : 'Chargement impossible.')) }, [])
  const createPlan = async () => {
    if (busy) return
    setBusy(true); setError(''); setNotice('')
    try { await createSubscriptionPlan({ name: planName.trim(), durationDays: planDays, price: Number(planPrice) }); await refresh(); setPlanName(''); setNotice('Offre créée.') }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Création de l’offre impossible.') }
    finally { setBusy(false) }
  }
  const createRestaurant = async () => {
    if (busy) return
    setBusy(true); setError(''); setNotice('')
    try {
      await createPlatformRestaurant({ identifier: identifier.trim().toLowerCase(), name: restaurantName.trim(), password: restaurantPassword, managerUsername: managerUsername.trim().toLowerCase(), managerName: managerName.trim(), managerPin, planId: selectedPlanId || overview?.plans[0]?.id || '' })
      await refresh(); setRestaurantName(''); setIdentifier(''); setRestaurantPassword(''); setManagerUsername(''); setManagerName(''); setManagerPin(''); setNotice('Restaurant créé et licence attribuée.')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Création du restaurant impossible.') }
    finally { setBusy(false) }
  }
  const assignPlan = async (restaurant: ManagedRestaurant, status: 'active' | 'suspended') => {
    if (busy) return
    setBusy(true); setError(''); setNotice('')
    const planId = rowPlans[restaurant.id] || restaurant.planId || overview?.plans[0]?.id || ''
    try { await updateRestaurantSubscription(restaurant.id, { planId, status }); await refresh(); setNotice(status === 'active' ? `Licence de ${restaurant.name} renouvelée.` : `Accès de ${restaurant.name} suspendu.`) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Mise à jour de la licence impossible.') }
    finally { setBusy(false) }
  }
  const expiryLabel = (restaurant: ManagedRestaurant) => {
    if (restaurant.status === 'suspended') return 'Suspendu'
    if (restaurant.expiresAt && new Date(restaurant.expiresAt).getTime() <= Date.now()) return 'Expiré'
    return restaurant.expiresAt ? 'Actif' : 'À configurer'
  }
  return <div className="platform-shell"><header className="platform-header"><div><p className="eyebrow">SERVICEPILOT · PROPRIÉTAIRE</p><h1>Gestion des restaurants</h1></div><button className="action-button" onClick={onLogout}>Déconnexion</button></header>{error && <p className="login-error">{error}</p>}{notice && <p className="server-notice">{notice}</p>}<section className="platform-stats"><article><span>Restaurants</span><strong>{overview?.restaurants.length ?? '—'}</strong></article><article><span>Licences actives</span><strong>{overview?.restaurants.filter((restaurant) => expiryLabel(restaurant) === 'Actif').length ?? '—'}</strong></article><article><span>Offres</span><strong>{overview?.plans.length ?? '—'}</strong></article></section><div className="platform-columns"><section className="panel platform-panel"><div className="module-list-heading"><strong>Créer une offre</strong><span>Tarif indicatif · gestion manuelle</span></div><div className="platform-form"><label>Nom de l’offre<input value={planName} onChange={(event) => setPlanName(event.target.value)} placeholder="ex. Équipe 5" /></label><div className="platform-form-row"><label>Durée (jours)<input type="number" min="1" max="3650" value={planDays} onChange={(event) => setPlanDays(Number(event.target.value))} /></label><label>Prix (EUR)<input type="number" min="0" step="0.01" value={planPrice} onChange={(event) => setPlanPrice(event.target.value)} /></label></div><button className="primary-button" disabled={busy || !planName.trim()} onClick={createPlan}>Créer l’offre</button></div><div className="platform-plan-list">{overview?.plans.map((plan) => <article key={plan.id}><strong>{plan.name}</strong><span>{plan.durationDays} jours · {plan.price.toFixed(2)} {plan.currency}</span></article>)}</div></section><section className="panel platform-panel"><div className="module-list-heading"><strong>Créer un restaurant</strong><span>Identifiant et mot de passe propriétaire</span></div><div className="platform-form"><div className="platform-form-row"><label>Nom<input value={restaurantName} onChange={(event) => setRestaurantName(event.target.value)} placeholder="Le Mijoté" /></label><label>Identifiant<input autoCapitalize="none" value={identifier} onChange={(event) => setIdentifier(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))} placeholder="le-mijote-paris" /></label></div><label>Mot de passe restaurant<input type="password" autoComplete="new-password" value={restaurantPassword} onChange={(event) => setRestaurantPassword(event.target.value)} /></label><div className="platform-form-row"><label>Compte gérant<input autoCapitalize="none" value={managerUsername} onChange={(event) => setManagerUsername(event.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ''))} placeholder="louise" /></label><label>Nom affiché<input value={managerName} onChange={(event) => setManagerName(event.target.value)} placeholder="Louise Martin" /></label></div><div className="platform-form-row"><label>PIN gérant<input type="password" inputMode="numeric" maxLength={12} value={managerPin} onChange={(event) => setManagerPin(event.target.value.replace(/\D/g, ''))} /></label><label>Offre<select value={selectedPlanId || overview?.plans[0]?.id || ''} onChange={(event) => setSelectedPlanId(event.target.value)}>{overview?.plans.filter((plan) => plan.active).map((plan) => <option key={plan.id} value={plan.id}>{plan.name} · {plan.durationDays} j</option>)}</select></label></div><button className="primary-button" disabled={busy || !overview?.plans.length || !restaurantName.trim() || !identifier.trim() || restaurantPassword.length < 8 || managerUsername.length < 3 || managerName.trim().length < 2 || managerPin.length < 4} onClick={createRestaurant}>Créer et attribuer la licence</button></div></section></div><section className="panel platform-restaurants"><div className="module-list-heading"><strong>Parc restaurants</strong><span>{overview?.restaurants.length || 0}</span></div>{overview?.restaurants.map((restaurant) => <article className="platform-restaurant-row" key={restaurant.id}><div className="platform-restaurant-identity"><strong>{restaurant.name}</strong><small>{restaurant.identifier} · {restaurant.planName || 'Aucune offre'} · échéance {restaurant.expiresAt ? new Date(restaurant.expiresAt).toLocaleDateString('fr-FR') : 'sans date'}</small></div><span className={`status-pill ${expiryLabel(restaurant) !== 'Actif' ? 'orange-pill' : ''}`}>{!restaurant.accessConfigured ? 'À configurer' : expiryLabel(restaurant)}</span><select aria-label={`Offre pour ${restaurant.name}`} value={rowPlans[restaurant.id] || restaurant.planId || overview.plans[0]?.id || ''} onChange={(event) => setRowPlans((current) => ({ ...current, [restaurant.id]: event.target.value }))}>{overview.plans.filter((plan) => plan.active).map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}</select><button className="action-button" disabled={busy || !restaurant.accessConfigured} onClick={() => assignPlan(restaurant, 'active')}>Attribuer / renouveler</button><button className="text-button" disabled={busy || !restaurant.accessConfigured} onClick={() => assignPlan(restaurant, 'suspended')}>Suspendre</button></article>)}</section></div>
}

function LoginScreen({ restaurant, profiles, onLogin, onSwitchRestaurant }: { restaurant: RestaurantContext; profiles: TeamProfile[]; onLogin: (username: string, pin: string) => Promise<void>; onSwitchRestaurant: () => void }) {
  const [requestedUsername, setRequestedUsername] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const roleNames: Record<Role, string> = { manager: 'Gérant', server: 'Serveur', kitchen: 'Cuisine', cashier: 'Caissier' }
  const username = profiles.some((profile) => profile.username === requestedUsername) ? requestedUsername : profiles[0]?.username || ''
  const selected = profiles.find((profile) => profile.username === username)
  const submit = async () => {
    if (!selected || loading) return
    setLoading(true); setError('')
    try { await onLogin(username, pin) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Profil ou code PIN incorrect.') }
    finally { setLoading(false) }
  }
  return <div className="login-screen"><div className="login-card"><div className="brand login-brand"><span className="brand-mark"><Utensils size={18} /></span><span>Service<span className="brand-accent">Pilot</span></span></div><p className="eyebrow">{restaurant.name}</p><h1>Ouvrir une session</h1><p className="login-subtitle">Choisissez votre profil et saisissez votre code PIN.</p><label>Profil<select value={username} onChange={(event) => { setRequestedUsername(event.target.value); setPin('') }} disabled={!profiles.length}>{profiles.map((profile) => <option key={profile.id} value={profile.username}>{profile.name} · {roleNames[profile.role]}</option>)}</select></label>{selected && <p className="selected-profile-name">@{selected.username} · {roleNames[selected.role]}</p>}<label>Code PIN<input type="password" inputMode="numeric" autoComplete="current-password" value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))} onKeyDown={(event) => event.key === 'Enter' && submit()} placeholder="••••" /></label>{!profiles.length && <p className="login-error">Aucun profil disponible. Contactez le gérant de ce restaurant.</p>}{error && <p className="login-error">{error}</p>}<button className="primary-button login-submit" disabled={!selected || pin.length < 4 || loading} onClick={submit}>{loading ? 'Connexion...' : 'Ouvrir la session'}</button><button className="switch-restaurant-button" onClick={onSwitchRestaurant}>Changer de restaurant</button></div></div>
}
function ReservationModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (data: { name: string; time: string; people: number }) => void }) { const [name, setName] = useState(''); const [time, setTime] = useState('19:30'); const [people, setPeople] = useState(4); return <div className="modal-backdrop" onClick={onClose}><div className="modal" onClick={(event) => event.stopPropagation()}><div className="modal-heading"><div><p className="eyebrow">NOUVEAU RENDEZ-VOUS</p><h2>Ajouter une réservation</h2></div><button onClick={onClose} aria-label="Fermer">×</button></div><label>Nom du client<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex. Camille Durand" /></label><div className="modal-fields"><label>Date<input type="date" defaultValue="2026-09-24" /></label><label>Heure<input type="time" value={time} onChange={(event) => setTime(event.target.value)} /></label></div><label>Nombre de personnes<select value={people} onChange={(event) => setPeople(Number(event.target.value))}><option value="2">2 personnes</option><option value="4">4 personnes</option><option value="6">6 personnes</option><option value="8">8 personnes</option></select></label><button className="primary-button modal-submit" disabled={!name.trim()} onClick={() => onSubmit({ name, time, people })}>Créer la réservation <ArrowUpRight size={16} /></button></div></div> }
function ServerOrdersModule({ orders, onStatus }: { orders: Dashboard['orders']; onStatus: (id: string, status: string) => void }) {
  const active = orders.filter((order) => order.status === 'ready' || order.status === 'served')
  return <section className="panel module-list server-orders"><div className="module-list-heading"><strong>Commandes à servir</strong><span>{active.filter((order) => order.status === 'ready').length} prête(s)</span></div>{active.length ? active.map((order) => <div className="module-row" key={order.id}><span className="order-number">#{order.id}</span><div><strong>Table {order.table}</strong><small>{order.items} articles · {order.lines?.map((line) => `${line.quantity}× ${line.name}`).join(' · ')}</small></div>{order.status === 'ready' ? <button className="action-button" onClick={() => onStatus(order.id, 'served')}>Livrée à table</button> : <span className="status-pill">Servie</span>}</div>) : <p className="empty-list">Aucune commande prête pour le moment.</p>}</section>
}

function CashierWorkspace({ orders, tables, tableZones, background, selectedTable, onSelectTable, onClearTable, onPay, onOpenDrawer, onPrint, onInvoice }: { orders: Dashboard['orders']; tables: RestaurantTable[]; tableZones: string[]; background: FloorPlanConfig | null; selectedTable: string; onSelectTable: (id: string) => void; onClearTable: () => void; onPay: (id: string, status: string, paymentMethod?: 'cash' | 'card') => void; onOpenDrawer: () => void; onPrint: (order: Order) => void; onInvoice: (order: Order) => void }) {
  const tableOrders = selectedTable ? orders.filter((order) => order.table.trim().toLowerCase() === selectedTable.trim().toLowerCase()) : orders
  return <><section className="panel cashier-floor"><div className="panel-heading"><div><h2>Plan de salle</h2><p>{selectedTable ? `Additions de la table ${selectedTable}` : 'Choisissez une table pour filtrer les additions.'}</p></div>{selectedTable && <button className="text-button" onClick={onClearTable}>Toutes les tables</button>}</div><FloorPlan tables={tables} tableZones={tableZones} background={background} onSelect={onSelectTable} /></section><CashierModule orders={tableOrders} onPay={onPay} onOpenDrawer={onOpenDrawer} onPrint={onPrint} onInvoice={onInvoice} /></>
}

function KitchenStockModule({ items, withdrawals, onSubmit }: { items: InventoryItem[]; withdrawals: StockWithdrawal[]; onSubmit: (items: { inventoryItemId: string; quantity: number }[], note: string) => Promise<boolean> }) {
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const lines = Object.entries(quantities).filter(([, quantity]) => quantity > 0).map(([inventoryItemId, quantity]) => ({ inventoryItemId, quantity }))
  const submit = async () => {
    if (!lines.length || submitting) return
    setSubmitting(true)
    try { if (await onSubmit(lines, note)) { setQuantities({}); setNote('') } } finally { setSubmitting(false) }
  }
  return <><section className="panel module-list"><div className="module-list-heading"><strong>Bon de sortie vers la cuisine</strong><span>Le stock sera déduit à la validation</span></div>{items.map((item) => <div className="module-row" key={item.id}><div><strong>{item.name}</strong><small>Disponible : {item.quantity} {item.unit}</small></div><input className="quantity-input" type="number" min="0" max={item.quantity} step="0.001" value={quantities[item.id] || ''} aria-label={`Sortie ${item.name}`} onChange={(event) => setQuantities((current) => ({ ...current, [item.id]: Number(event.target.value) }))} /><span className="stock-unit">{item.unit}</span></div>)}<div className="withdrawal-note"><label>Motif / remarque<input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Ex. préparation du service du midi" /></label><button className="primary-button" disabled={!lines.length || submitting} onClick={submit}>{submitting ? 'Enregistrement...' : 'Valider le bon de sortie'}</button></div></section><section className="panel module-list withdrawal-history"><div className="module-list-heading"><strong>Dernières sorties</strong><span>{withdrawals.length}</span></div>{withdrawals.slice(0, 5).map((withdrawal) => <div className="module-row" key={withdrawal.id}><time>{new Date(withdrawal.createdAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</time><div><strong>{withdrawal.reason}</strong><small>{withdrawal.items.map((item) => `${item.quantity} ${item.unit} ${item.name}`).join(' · ')}{withdrawal.note ? ` · ${withdrawal.note}` : ''}</small></div></div>)}</section></>
}

export default App

function formatNotificationTime(value: string) {
  const elapsedMinutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000))
  if (elapsedMinutes < 1) return 'À l’instant'
  if (elapsedMinutes < 60) return `Il y a ${elapsedMinutes} min`
  const elapsedHours = Math.floor(elapsedMinutes / 60)
  if (elapsedHours < 24) return `Il y a ${elapsedHours} h`
  return new Date(value).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
}

function InvoiceStockModule({ items, receipts, onUpdate, onAnalyze, onCreateDraft, onReviewReceipt }: { items: InventoryItem[]; receipts: StockReceipt[]; onUpdate: (id: string, quantity: number) => void; onAnalyze: (file: File, onProgress: (message: string) => void) => Promise<InvoiceAnalysis>; onCreateDraft: (draft: { sourceFileName: string; sourceType: 'pdf' | 'image'; extractedText: string; lines: StockReceiptLine[] }) => Promise<boolean>; onReviewReceipt: (id: string, status: 'approved' | 'rejected') => Promise<void> }) {
  const [fileName, setFileName] = useState('')
  const [sourceType, setSourceType] = useState<'pdf' | 'image'>('image')
  const [extractedText, setExtractedText] = useState('')
  const [lines, setLines] = useState<StockReceiptLine[]>([])
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  const [savingDraft, setSavingDraft] = useState(false)

  const scanFile = async (file?: File) => {
    if (!file) return
    if (file.size > 12 * 1024 * 1024) { setError('Le fichier dépasse la limite de 12 Mo.'); return }
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
    if (!isPdf && !file.type.startsWith('image/')) { setError('Choisissez une photo ou un fichier PDF.'); return }
    setFileName(file.name)
    setSourceType(isPdf ? 'pdf' : 'image')
    setError('')
    setLines([])
    setAnalyzing(true)
    try {
      const result = await onAnalyze(file, setProgress)
      setExtractedText(result.text)
      setLines(result.lines.length ? result.lines : [{ inventoryItemId: '', name: '', quantity: 1, unit: 'unité' }])
      if (!result.lines.length) setError('Aucun article reconnu automatiquement. Ajoutez ou corrigez les lignes avant de créer le brouillon.')
      setProgress('Analyse terminée')
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : 'Analyse du document impossible.')
      setExtractedText('')
    } finally {
      setAnalyzing(false)
    }
  }

  const updateLine = (index: number, patch: Partial<StockReceiptLine>) => setLines((current) => current.map((line, lineIndex) => lineIndex === index ? { ...line, ...patch } : line))
  const submitDraft = async () => {
    const validLines = lines.filter((line) => line.name.trim() && Number.isFinite(line.quantity) && line.quantity > 0 && line.unit.trim())
    if (!fileName || !validLines.length || savingDraft) return
    setSavingDraft(true)
    try {
      const created = await onCreateDraft({ sourceFileName: fileName, sourceType, extractedText, lines: validLines })
      if (created) { setFileName(''); setExtractedText(''); setLines([]); setProgress(''); setError('') }
    } finally { setSavingDraft(false) }
  }

  return <div className="invoice-stock-stack">
    <section className="panel invoice-import-panel">
      <div className="module-list-heading"><strong>Importer une facture fournisseur</strong><span>Le stock reste inchangé avant approbation</span></div>
      <div className="invoice-upload-actions">
        <label className="upload-button camera-upload">Prendre une photo<input type="file" accept="image/*" capture="environment" onChange={(event) => scanFile(event.target.files?.[0])} /></label>
        <label className="upload-button">Importer une photo<input type="file" accept="image/*" onChange={(event) => scanFile(event.target.files?.[0])} /></label>
        <label className="upload-button">Importer un PDF<input type="file" accept="application/pdf,.pdf" onChange={(event) => scanFile(event.target.files?.[0])} /></label>
      </div>
      {fileName && <p className="invoice-file-state">{fileName}{progress && <span>{progress}</span>}</p>}
      {error && <p className="invoice-analysis-error">{error}</p>}
      {fileName && error && !lines.length && !analyzing && <button className="text-button add-manual-invoice-line" onClick={() => setLines([{ inventoryItemId: '', name: '', quantity: 1, unit: 'unité' }])}>Saisir les articles manuellement</button>}
      {analyzing && <div className="invoice-progress"><span /></div>}
      {!!lines.length && <div className="invoice-draft-editor"><div className="invoice-draft-heading"><strong>Vérifier les articles détectés</strong><button className="text-button" onClick={() => setLines((current) => [...current, { inventoryItemId: '', name: '', quantity: 1, unit: 'unité' }])}>+ Ajouter une ligne</button></div>{lines.map((line, index) => <div className="invoice-line" key={`${index}-${line.inventoryItemId}`}><select aria-label={`Produit ligne ${index + 1}`} value={line.inventoryItemId} onChange={(event) => { const item = items.find((candidate) => candidate.id === event.target.value); updateLine(index, item ? { inventoryItemId: item.id, name: item.name, unit: item.unit } : { inventoryItemId: '' }) }}><option value="">Nouveau produit…</option>{items.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.unit})</option>)}</select><input aria-label={`Nom ligne ${index + 1}`} placeholder="Article" value={line.name} onChange={(event) => updateLine(index, { name: event.target.value, inventoryItemId: '' })} /><input aria-label={`Quantité ligne ${index + 1}`} type="number" min="0.001" step="0.001" value={line.quantity} onChange={(event) => updateLine(index, { quantity: Number(event.target.value) })} /><input aria-label={`Unité ligne ${index + 1}`} value={line.unit} onChange={(event) => updateLine(index, { unit: event.target.value })} /><button className="remove-invoice-line" aria-label={`Supprimer ligne ${index + 1}`} onClick={() => setLines((current) => current.filter((_, lineIndex) => lineIndex !== index))}>×</button></div>)}<div className="invoice-draft-footer"><span>{lines.filter((line) => line.name.trim() && line.quantity > 0).length} ligne(s) valide(s) · À confirmer avant entrée</span><button className="primary-button" disabled={savingDraft || !lines.some((line) => line.name.trim() && line.quantity > 0)} onClick={submitDraft}>{savingDraft ? 'Création...' : 'Créer la fiche brouillon'}</button></div></div>}
    </section>
    <section className="panel invoice-receipts"><div className="module-list-heading"><strong>Fiches d’entrée à valider</strong><span>{receipts.filter((receipt) => receipt.status === 'draft').length} en attente</span></div>{receipts.length ? receipts.map((receipt) => <article className="receipt-card" key={receipt.id}><div className="receipt-heading"><div><strong>{receipt.sourceFileName}</strong><time>{new Date(receipt.createdAt).toLocaleString('fr-FR')}</time></div><span className={`status-pill ${receipt.status === 'draft' ? 'orange-pill' : ''}`}>{receipt.status === 'draft' ? 'Brouillon · stock non modifié' : receipt.status === 'approved' ? 'Validée' : 'Refusée'}</span></div><div className="receipt-lines">{receipt.lines.map((line, index) => <span key={`${receipt.id}-${index}`}>{line.name} · {line.quantity} {line.unit}</span>)}</div>{receipt.status === 'draft' && <div className="receipt-actions"><button className="action-button reject-receipt" onClick={() => onReviewReceipt(receipt.id, 'rejected')}>Refuser</button><button className="primary-button" onClick={() => onReviewReceipt(receipt.id, 'approved')}>Valider et entrer en stock</button></div>}</article>) : <p className="notification-empty">Aucune fiche d’entrée. Importez une facture pour créer un brouillon.</p>}</section>
    <InventoryLevelsModule items={items} onUpdate={onUpdate} />
  </div>
}

function InvoiceComposer({ order, restaurantName, onClose, onCreate }: { order: Order; restaurantName: string; onClose: () => void; onCreate: (orderId: string, details: Omit<Parameters<typeof createInvoice>[0], 'orderId'>) => Promise<Invoice | null> }) {
  const [seller, setSeller] = useState({ name: restaurantName, address: '', siren: '', vatNumber: '' })
  const [buyer, setBuyer] = useState({ name: '', address: '', email: '' })
  const [lines, setLines] = useState<Array<{ name: string; quantity: number; unitPrice: number; vatRate: number }>>(() => order.lines?.length ? order.lines.map((line) => ({ name: line.name, quantity: line.quantity, unitPrice: line.price, vatRate: 10 })) : [{ name: `Commande table ${order.table}`, quantity: 1, unitPrice: order.amount, vatRate: 10 }])
  const [saving, setSaving] = useState(false)
  const total = lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0)
  const create = async () => {
    if (saving) return
    setSaving(true)
    try { await onCreate(order.id, { seller, buyer, lines }) } finally { setSaving(false) }
  }
  return <div className="modal-backdrop" onClick={onClose}><section className="modal invoice-composer" onClick={(event) => event.stopPropagation()}><header className="modal-heading"><div><p className="eyebrow">FACTURATION</p><h2>Créer la facture</h2></div><button onClick={onClose} aria-label="Fermer">×</button></header><div className="invoice-form-grid"><label>Raison sociale<input value={seller.name} onChange={(event) => setSeller({ ...seller, name: event.target.value })} /></label><label>SIREN / SIRET<input inputMode="numeric" value={seller.siren} onChange={(event) => setSeller({ ...seller, siren: event.target.value })} placeholder="9 ou 14 chiffres" /></label><label className="wide-field">Adresse vendeur<input value={seller.address} onChange={(event) => setSeller({ ...seller, address: event.target.value })} /></label><label>TVA intracommunautaire<input value={seller.vatNumber} onChange={(event) => setSeller({ ...seller, vatNumber: event.target.value })} /></label><label>Nom client<input value={buyer.name} onChange={(event) => setBuyer({ ...buyer, name: event.target.value })} /></label><label className="wide-field">Adresse client<input value={buyer.address} onChange={(event) => setBuyer({ ...buyer, address: event.target.value })} /></label><label className="wide-field">E-mail client (facultatif)<input type="email" value={buyer.email} onChange={(event) => setBuyer({ ...buyer, email: event.target.value })} /></label></div><div className="invoice-composer-lines"><strong>Articles · commande #{order.id} · Table {order.table}</strong>{lines.map((line, index) => <div className="invoice-composer-line" key={`${line.name}-${index}`}><span>{line.name}</span><span>{line.quantity} × {line.unitPrice.toFixed(2)} €</span><select aria-label={`TVA ${line.name}`} value={line.vatRate} onChange={(event) => setLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, vatRate: Number(event.target.value) } : item))}><option value="0">TVA 0%</option><option value="5.5">TVA 5,5%</option><option value="10">TVA 10%</option><option value="20">TVA 20%</option></select></div>)}<div className="invoice-form-total"><strong>Total TTC encaissé</strong><strong>{total.toFixed(2).replace('.', ',')} €</strong></div></div><p className="invoice-legal-note">La facture sera numérotée à sa création. Vérifiez le vendeur, le SIREN/SIRET, le client et les taux de TVA avant émission.</p><footer className="invoice-composer-actions"><button className="action-button" onClick={onClose}>Annuler</button><button className="primary-button" disabled={saving || !seller.name.trim() || !seller.address.trim() || !/^\d{9,14}$/.test(seller.siren.replace(/\s/g, '')) || !buyer.name.trim()} onClick={create}>{saving ? 'Création...' : 'Créer la facture'}</button></footer></section></div>
}

function PrintPreview({ document, restaurantName, onClose, onEmail }: { document: { kind: 'ticket'; order: Order } | { kind: 'invoice'; invoice: Invoice }; restaurantName: string; onClose: () => void; onEmail?: () => Promise<boolean> }) {
  const [sending, setSending] = useState(false)
  const [emailMessage, setEmailMessage] = useState('')
  const invoice = document.kind === 'invoice' ? document.invoice : null
  const order = document.kind === 'ticket' ? document.order : null
  const send = async () => { if (!onEmail || sending) return; setSending(true); setEmailMessage(''); try { setEmailMessage(await onEmail() ? 'Facture envoyée.' : 'Échec de l’envoi. Vérifiez le message de service et la configuration SMTP.') } finally { setSending(false) } }
  return <div className="modal-backdrop print-backdrop" onClick={onClose}><section className="modal print-modal" onClick={(event) => event.stopPropagation()}><div className="print-actions"><strong>{invoice ? `Facture ${invoice.invoiceNumber}` : `Ticket · Table ${order?.table}`}</strong><button className="action-button" onClick={() => window.print()}>Imprimer</button>{invoice && onEmail && <button className="primary-button" disabled={sending || !invoice.buyer.email} onClick={send}>{sending ? 'Envoi...' : 'Envoyer par e-mail'}</button>}<button className="text-button" onClick={onClose}>Fermer</button></div>{emailMessage && <p className="email-send-message" role="status">{emailMessage}</p>}<article className="printed-document"><header><strong>{invoice?.seller.name || restaurantName}</strong><span>{invoice?.seller.address || 'Ticket de caisse'}</span>{invoice?.seller.siren && <span>SIREN/SIRET : {invoice.seller.siren}</span>}</header>{invoice ? <><h1>FACTURE</h1><p><strong>{invoice.invoiceNumber}</strong> · {new Date(invoice.issuedAt).toLocaleDateString('fr-FR')}</p><p>Client : {invoice.buyer.name}{invoice.buyer.address ? ` · ${invoice.buyer.address}` : ''}</p><table><thead><tr><th>Désignation</th><th>Qté</th><th>PU TTC</th><th>TVA</th><th>Total</th></tr></thead><tbody>{invoice.lines.map((line, index) => <tr key={index}><td>{line.name}</td><td>{line.quantity}</td><td>{line.unitPrice.toFixed(2)} €</td><td>{line.vatRate}%</td><td>{line.grossAmount.toFixed(2)} €</td></tr>)}</tbody></table><div className="printed-totals"><span>Total HT : {invoice.totalNet.toFixed(2)} €</span><span>TVA : {invoice.totalVat.toFixed(2)} €</span><strong>Total TTC : {invoice.totalGross.toFixed(2)} €</strong></div></> : <><h1>TICKET DE CAISSE</h1><p>{new Date(order!.createdAt).toLocaleString('fr-FR')} · Table {order!.table}</p><table><thead><tr><th>Désignation</th><th>Qté</th><th>Total</th></tr></thead><tbody>{(order!.lines || []).map((line, index) => <tr key={index}><td>{line.name}</td><td>{line.quantity}</td><td>{(line.quantity * line.price).toFixed(2)} €</td></tr>)}</tbody></table><div className="printed-totals"><strong>Total : {order!.amount.toFixed(2)} €</strong><span>Règlement : {order!.paymentMethod === 'cash' ? 'Espèces' : 'CB / TPE'}</span></div></>}<footer>Merci de votre visite.</footer></article></section></div>
}
