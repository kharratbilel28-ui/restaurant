import { Pool } from 'pg'

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined })

const schema = [
  `CREATE TABLE IF NOT EXISTS restaurants (id text PRIMARY KEY, name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE TABLE IF NOT EXISTS users (restaurant_id text NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE, id text NOT NULL, name text NOT NULL, role text NOT NULL, pin text NOT NULL, PRIMARY KEY (restaurant_id, id))`,
  `CREATE TABLE IF NOT EXISTS reservations (restaurant_id text NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE, id text NOT NULL, reservation_time text NOT NULL, customer_name text NOT NULL, people integer NOT NULL, table_name text NOT NULL, status text NOT NULL, PRIMARY KEY (restaurant_id, id))`,
  `CREATE TABLE IF NOT EXISTS dining_tables (restaurant_id text NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE, id text NOT NULL, seats integer NOT NULL, status text NOT NULL, zone text NOT NULL, PRIMARY KEY (restaurant_id, id))`,
  `CREATE TABLE IF NOT EXISTS menu_items (restaurant_id text NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE, id text NOT NULL, name text NOT NULL, price numeric(10,2) NOT NULL, image text NOT NULL DEFAULT '', active boolean NOT NULL DEFAULT true, PRIMARY KEY (restaurant_id, id))`,
  `CREATE TABLE IF NOT EXISTS floor_plan_configs (restaurant_id text PRIMARY KEY REFERENCES restaurants(id) ON DELETE CASCADE, file_name text NOT NULL, pdf_data text NOT NULL, positions jsonb NOT NULL DEFAULT '{}'::jsonb, updated_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE TABLE IF NOT EXISTS inventory_items (restaurant_id text NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE, id text NOT NULL, name text NOT NULL, quantity numeric(12,3) NOT NULL, unit text NOT NULL, minimum numeric(12,3) NOT NULL, supplier text NOT NULL, PRIMARY KEY (restaurant_id, id))`,
  `CREATE TABLE IF NOT EXISTS inventory_receipts (restaurant_id text NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE, id text NOT NULL, source_file_name text NOT NULL, source_type text NOT NULL, extracted_text text NOT NULL DEFAULT '', status text NOT NULL, created_by text NOT NULL DEFAULT '', created_at timestamptz NOT NULL, approved_by text, approved_at timestamptz, rejected_at timestamptz, PRIMARY KEY (restaurant_id, id))`,
  `CREATE TABLE IF NOT EXISTS inventory_receipt_lines (restaurant_id text NOT NULL, receipt_id text NOT NULL, line_index integer NOT NULL, inventory_item_id text NOT NULL DEFAULT '', name text NOT NULL, quantity numeric(12,3) NOT NULL, unit text NOT NULL, PRIMARY KEY (restaurant_id, receipt_id, line_index), FOREIGN KEY (restaurant_id, receipt_id) REFERENCES inventory_receipts(restaurant_id, id) ON DELETE CASCADE)`,
  `CREATE TABLE IF NOT EXISTS invoice_sequences (restaurant_id text NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE, invoice_year integer NOT NULL, next_number integer NOT NULL DEFAULT 1, PRIMARY KEY (restaurant_id, invoice_year))`,
  `CREATE TABLE IF NOT EXISTS invoices (restaurant_id text NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE, id text NOT NULL, invoice_number text NOT NULL, order_id text NOT NULL, issued_at timestamptz NOT NULL, seller jsonb NOT NULL, buyer jsonb NOT NULL, total_net numeric(12,2) NOT NULL, total_vat numeric(12,2) NOT NULL, total_gross numeric(12,2) NOT NULL, emailed_at timestamptz, PRIMARY KEY (restaurant_id, id), UNIQUE (restaurant_id, invoice_number), UNIQUE (restaurant_id, order_id))`,
  `CREATE TABLE IF NOT EXISTS invoice_lines (restaurant_id text NOT NULL, invoice_id text NOT NULL, line_index integer NOT NULL, name text NOT NULL, quantity numeric(12,3) NOT NULL, unit_price numeric(12,2) NOT NULL, vat_rate numeric(5,2) NOT NULL, net_amount numeric(12,2) NOT NULL, vat_amount numeric(12,2) NOT NULL, gross_amount numeric(12,2) NOT NULL, PRIMARY KEY (restaurant_id, invoice_id, line_index), FOREIGN KEY (restaurant_id, invoice_id) REFERENCES invoices(restaurant_id, id) ON DELETE CASCADE)`,
  `CREATE TABLE IF NOT EXISTS stock_withdrawals (restaurant_id text NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE, id text NOT NULL, reason text NOT NULL, note text NOT NULL DEFAULT '', created_by text NOT NULL DEFAULT '', created_at timestamptz NOT NULL, PRIMARY KEY (restaurant_id, id))`,
  `CREATE TABLE IF NOT EXISTS stock_withdrawal_items (restaurant_id text NOT NULL, withdrawal_id text NOT NULL, line_index integer NOT NULL, inventory_item_id text NOT NULL, name text NOT NULL, quantity numeric(12,3) NOT NULL, unit text NOT NULL, PRIMARY KEY (restaurant_id, withdrawal_id, line_index), FOREIGN KEY (restaurant_id, withdrawal_id) REFERENCES stock_withdrawals(restaurant_id, id) ON DELETE CASCADE)`,
  `CREATE TABLE IF NOT EXISTS orders (restaurant_id text NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE, id text NOT NULL, table_name text NOT NULL, item_count integer NOT NULL, amount numeric(10,2) NOT NULL, status text NOT NULL, note text NOT NULL DEFAULT '', payment_method text, created_at timestamptz NOT NULL, PRIMARY KEY (restaurant_id, id))`,
  `CREATE TABLE IF NOT EXISTS order_lines (restaurant_id text NOT NULL, order_id text NOT NULL, line_index integer NOT NULL, name text NOT NULL, quantity numeric(12,3) NOT NULL, price numeric(10,2) NOT NULL, PRIMARY KEY (restaurant_id, order_id, line_index), FOREIGN KEY (restaurant_id, order_id) REFERENCES orders(restaurant_id, id) ON DELETE CASCADE)`,
  `CREATE INDEX IF NOT EXISTS reservations_by_service ON reservations (restaurant_id, reservation_time)`,
  `CREATE INDEX IF NOT EXISTS orders_by_service ON orders (restaurant_id, created_at DESC)`,
]

function withDefaults(state) {
  state.reservations ||= []
  state.users ||= []
  state.floorPlan ||= null
  state.orders ||= []
  state.tables ||= []
  state.inventory ||= [
    { id: 'inv-1', name: 'Tomates coeur de boeuf', quantity: 8, unit: 'kg', minimum: 10, supplier: 'Metro' },
    { id: 'inv-2', name: 'Filet de bar', quantity: 14, unit: 'pieces', minimum: 8, supplier: 'La Maree' },
    { id: 'inv-3', name: 'Beurre doux', quantity: 3, unit: 'kg', minimum: 5, supplier: 'Transgourmet' },
  ]
  state.stockReceipts ||= []
  state.menu ||= [
    { id: 'dish-1', name: 'Plat du jour', price: 18, image: 'https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=400&q=80', active: true },
    { id: 'dish-2', name: 'Filet de bar', price: 24, image: 'https://images.unsplash.com/photo-1519708227418-c8fd9a32b7a2?auto=format&fit=crop&w=400&q=80', active: true },
    { id: 'dish-3', name: 'Dessert maison', price: 9, image: 'https://images.unsplash.com/photo-1551024506-0bccd828d307?auto=format&fit=crop&w=400&q=80', active: true },
  ]
  return state
}

export async function initPostgres(fallbackState) {
  for (const statement of schema) await pool.query(statement)
  const existing = await pool.query('SELECT id FROM restaurants WHERE id = $1', ['restaurant-demo'])
  if (existing.rowCount > 0) return

  const legacyTable = await pool.query("SELECT to_regclass('public.restaurant_state') AS table_name")
  if (legacyTable.rows[0].table_name) {
    const legacy = await pool.query('SELECT data FROM restaurant_state WHERE id = 1')
    if (legacy.rows[0]?.data) fallbackState = legacy.rows[0].data
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const state = withDefaults(fallbackState)
    await client.query('INSERT INTO restaurants (id, name) VALUES ($1, $2)', ['restaurant-demo', 'Le Mijoté'])
    for (const user of state.users) await client.query('INSERT INTO users (restaurant_id, id, name, role, pin) VALUES ($1, $2, $3, $4, $5)', ['restaurant-demo', user.id, user.name, user.role, user.pin])
    for (const item of state.reservations) await client.query('INSERT INTO reservations (restaurant_id, id, reservation_time, customer_name, people, table_name, status) VALUES ($1, $2, $3, $4, $5, $6, $7)', ['restaurant-demo', item.id, item.time, item.name, item.people, item.table || 'À attribuer', item.status || 'confirmed'])
    for (const table of state.tables) await client.query('INSERT INTO dining_tables (restaurant_id, id, seats, status, zone) VALUES ($1, $2, $3, $4, $5)', ['restaurant-demo', table.id, table.seats, table.status, table.zone])
    for (const item of state.menu) await client.query('INSERT INTO menu_items (restaurant_id, id, name, price, image, active) VALUES ($1, $2, $3, $4, $5, $6)', ['restaurant-demo', item.id, item.name, item.price, item.image || '', item.active !== false])
    if (state.floorPlan?.pdfData) await client.query('INSERT INTO floor_plan_configs (restaurant_id, file_name, pdf_data, positions) VALUES ($1, $2, $3, $4::jsonb)', ['restaurant-demo', state.floorPlan.fileName, state.floorPlan.pdfData, JSON.stringify(state.floorPlan.positions || {})])
    for (const item of state.inventory) await client.query('INSERT INTO inventory_items (restaurant_id, id, name, quantity, unit, minimum, supplier) VALUES ($1, $2, $3, $4, $5, $6, $7)', ['restaurant-demo', item.id, item.name, item.quantity, item.unit, item.minimum, item.supplier || ''])
    for (const receipt of state.stockReceipts) {
      await client.query('INSERT INTO inventory_receipts (restaurant_id, id, source_file_name, source_type, extracted_text, status, created_by, created_at, approved_by, approved_at, rejected_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)', ['restaurant-demo', receipt.id, receipt.sourceFileName, receipt.sourceType, receipt.extractedText || '', receipt.status, receipt.createdBy || '', receipt.createdAt, receipt.approvedBy || null, receipt.approvedAt || null, receipt.rejectedAt || null])
      for (const [index, line] of receipt.lines.entries()) await client.query('INSERT INTO inventory_receipt_lines (restaurant_id, receipt_id, line_index, inventory_item_id, name, quantity, unit) VALUES ($1, $2, $3, $4, $5, $6, $7)', ['restaurant-demo', receipt.id, index, line.inventoryItemId || '', line.name, line.quantity, line.unit])
    }
    for (const order of state.orders) {
      await client.query('INSERT INTO orders (restaurant_id, id, table_name, item_count, amount, status, note, payment_method, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)', ['restaurant-demo', order.id, order.table, order.items, order.amount, order.status === 'kitchen' ? 'received' : order.status, order.note || '', order.paymentMethod || null, order.createdAt])
      for (const [index, line] of (order.lines || []).entries()) await client.query('INSERT INTO order_lines (restaurant_id, order_id, line_index, name, quantity, price) VALUES ($1, $2, $3, $4, $5, $6)', ['restaurant-demo', order.id, index, line.name, line.quantity, line.price])
    }
    for (const withdrawal of (state.stockWithdrawals || [])) {
      await client.query('INSERT INTO stock_withdrawals (restaurant_id, id, reason, note, created_by, created_at) VALUES ($1, $2, $3, $4, $5, $6)', ['restaurant-demo', withdrawal.id, withdrawal.reason, withdrawal.note || '', withdrawal.createdBy || '', withdrawal.createdAt])
      for (const [index, item] of withdrawal.items.entries()) await client.query('INSERT INTO stock_withdrawal_items (restaurant_id, withdrawal_id, line_index, inventory_item_id, name, quantity, unit) VALUES ($1, $2, $3, $4, $5, $6, $7)', ['restaurant-demo', withdrawal.id, index, item.inventoryItemId, item.name, item.quantity, item.unit])
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export async function findUserByCredentials(role, pin) {
  const result = await pool.query('SELECT id, restaurant_id, name, role FROM users WHERE role = $1 AND pin = $2 LIMIT 1', [role, pin])
  return result.rows[0] || null
}

export async function getInvoicePostgres(restaurantId, id) {
  const result = await pool.query('SELECT id, invoice_number AS "invoiceNumber", order_id AS "orderId", issued_at AS "issuedAt", seller, buyer, total_net AS "totalNet", total_vat AS "totalVat", total_gross AS "totalGross", emailed_at AS "emailedAt" FROM invoices WHERE restaurant_id = $1 AND id = $2', [restaurantId, id])
  if (!result.rows[0]) return null
  const lines = await pool.query('SELECT name, quantity, unit_price AS "unitPrice", vat_rate AS "vatRate", net_amount AS "netAmount", vat_amount AS "vatAmount", gross_amount AS "grossAmount" FROM invoice_lines WHERE restaurant_id = $1 AND invoice_id = $2 ORDER BY line_index', [restaurantId, id])
  return { ...result.rows[0], totalNet: Number(result.rows[0].totalNet), totalVat: Number(result.rows[0].totalVat), totalGross: Number(result.rows[0].totalGross), lines: lines.rows.map((line) => ({ ...line, quantity: Number(line.quantity), unitPrice: Number(line.unitPrice), vatRate: Number(line.vatRate), netAmount: Number(line.netAmount), vatAmount: Number(line.vatAmount), grossAmount: Number(line.grossAmount) })) }
}

export async function createInvoicePostgres(restaurantId, invoice) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const year = new Date(invoice.issuedAt).getFullYear()
    await client.query('INSERT INTO invoice_sequences (restaurant_id, invoice_year, next_number) VALUES ($1, $2, 1) ON CONFLICT DO NOTHING', [restaurantId, year])
    const counter = await client.query('SELECT next_number FROM invoice_sequences WHERE restaurant_id = $1 AND invoice_year = $2 FOR UPDATE', [restaurantId, year])
    const sequence = Number(counter.rows[0].next_number)
    const created = { ...invoice, invoiceNumber: `FAC-${year}-${String(sequence).padStart(6, '0')}` }
    await client.query('UPDATE invoice_sequences SET next_number = $1 WHERE restaurant_id = $2 AND invoice_year = $3', [sequence + 1, restaurantId, year])
    await client.query('INSERT INTO invoices (restaurant_id, id, invoice_number, order_id, issued_at, seller, buyer, total_net, total_vat, total_gross) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10)', [restaurantId, created.id, created.invoiceNumber, created.orderId, created.issuedAt, JSON.stringify(created.seller), JSON.stringify(created.buyer), created.totalNet, created.totalVat, created.totalGross])
    for (const [index, line] of created.lines.entries()) await client.query('INSERT INTO invoice_lines (restaurant_id, invoice_id, line_index, name, quantity, unit_price, vat_rate, net_amount, vat_amount, gross_amount) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)', [restaurantId, created.id, index, line.name, line.quantity, line.unitPrice, line.vatRate, line.netAmount, line.vatAmount, line.grossAmount])
    await client.query('COMMIT')
    return created
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally { client.release() }
}

export async function markInvoiceEmailed(restaurantId, id) {
  const result = await pool.query('UPDATE invoices SET emailed_at = now() WHERE restaurant_id = $1 AND id = $2 RETURNING emailed_at', [restaurantId, id])
  return result.rows[0]?.emailed_at || null
}

export async function readPostgres(restaurantId) {
  const client = await pool.connect()
  try {
    const [reservations, users, orders, tables, inventory, menu, withdrawals, floorPlan, receipts] = await Promise.all([
      client.query('SELECT id, reservation_time AS time, customer_name AS name, people, table_name AS "table", status FROM reservations WHERE restaurant_id = $1 ORDER BY reservation_time', [restaurantId]),
      client.query('SELECT id, name, role, pin FROM users WHERE restaurant_id = $1', [restaurantId]),
      client.query('SELECT id, table_name AS "table", item_count AS items, amount, status, note, payment_method AS "paymentMethod", created_at AS "createdAt" FROM orders WHERE restaurant_id = $1 ORDER BY created_at DESC', [restaurantId]),
      client.query('SELECT id, seats, status, zone FROM dining_tables WHERE restaurant_id = $1 ORDER BY zone, id', [restaurantId]),
      client.query('SELECT id, name, quantity, unit, minimum, supplier FROM inventory_items WHERE restaurant_id = $1 ORDER BY name', [restaurantId]),
      client.query('SELECT id, name, price, image, active FROM menu_items WHERE restaurant_id = $1 ORDER BY name', [restaurantId]),
      client.query('SELECT id, reason, note, created_by AS "createdBy", created_at AS "createdAt" FROM stock_withdrawals WHERE restaurant_id = $1 ORDER BY created_at DESC', [restaurantId]),
      client.query('SELECT file_name AS "fileName", pdf_data AS "pdfData", positions FROM floor_plan_configs WHERE restaurant_id = $1', [restaurantId]),
      client.query('SELECT id, source_file_name AS "sourceFileName", source_type AS "sourceType", extracted_text AS "extractedText", status, created_by AS "createdBy", created_at AS "createdAt", approved_by AS "approvedBy", approved_at AS "approvedAt", rejected_at AS "rejectedAt" FROM inventory_receipts WHERE restaurant_id = $1 ORDER BY created_at DESC', [restaurantId]),
    ])
    const [lines, withdrawalLines, receiptLines] = await Promise.all([
      client.query('SELECT order_id, name, quantity, price FROM order_lines WHERE restaurant_id = $1 ORDER BY order_id, line_index', [restaurantId]),
      client.query('SELECT withdrawal_id, inventory_item_id AS "inventoryItemId", name, quantity, unit FROM stock_withdrawal_items WHERE restaurant_id = $1 ORDER BY withdrawal_id, line_index', [restaurantId]),
      client.query('SELECT receipt_id, inventory_item_id AS "inventoryItemId", name, quantity, unit FROM inventory_receipt_lines WHERE restaurant_id = $1 ORDER BY receipt_id, line_index', [restaurantId]),
    ])
    const linesByOrder = new Map()
    for (const line of lines.rows) {
      const grouped = linesByOrder.get(line.order_id) || []
      grouped.push({ name: line.name, quantity: Number(line.quantity), price: Number(line.price) })
      linesByOrder.set(line.order_id, grouped)
    }
    const withdrawalItems = new Map()
    for (const item of withdrawalLines.rows) {
      const grouped = withdrawalItems.get(item.withdrawal_id) || []
      grouped.push({ ...item, quantity: Number(item.quantity) })
      withdrawalItems.set(item.withdrawal_id, grouped)
    }
    const receiptItems = new Map()
    for (const line of receiptLines.rows) {
      const grouped = receiptItems.get(line.receipt_id) || []
      grouped.push({ ...line, quantity: Number(line.quantity) })
      receiptItems.set(line.receipt_id, grouped)
    }
    return {
      reservations: reservations.rows,
      users: users.rows,
      orders: orders.rows.map((order) => ({ ...order, amount: Number(order.amount), lines: linesByOrder.get(order.id) || [] })),
      tables: tables.rows,
      inventory: inventory.rows.map((item) => ({ ...item, quantity: Number(item.quantity), minimum: Number(item.minimum) })),
      menu: menu.rows.map((item) => ({ ...item, price: Number(item.price) })),
      stockWithdrawals: withdrawals.rows.map((withdrawal) => ({ ...withdrawal, items: withdrawalItems.get(withdrawal.id) || [] })),
      floorPlan: floorPlan.rows[0] || null,
      stockReceipts: receipts.rows.map((receipt) => ({ ...receipt, lines: receiptItems.get(receipt.id) || [] })),
    }
  } finally {
    client.release()
  }
}

export async function savePostgres(restaurantId, state) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    for (const item of state.reservations) await client.query('INSERT INTO reservations (restaurant_id, id, reservation_time, customer_name, people, table_name, status) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (restaurant_id, id) DO UPDATE SET reservation_time = EXCLUDED.reservation_time, customer_name = EXCLUDED.customer_name, people = EXCLUDED.people, table_name = EXCLUDED.table_name, status = EXCLUDED.status', [restaurantId, item.id, item.time, item.name, item.people, item.table || 'À attribuer', item.status || 'confirmed'])
    for (const table of state.tables) await client.query('INSERT INTO dining_tables (restaurant_id, id, seats, status, zone) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (restaurant_id, id) DO UPDATE SET seats = EXCLUDED.seats, status = EXCLUDED.status, zone = EXCLUDED.zone', [restaurantId, table.id, table.seats, table.status, table.zone])
    for (const item of state.menu) await client.query('INSERT INTO menu_items (restaurant_id, id, name, price, image, active) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (restaurant_id, id) DO UPDATE SET name = EXCLUDED.name, price = EXCLUDED.price, image = EXCLUDED.image, active = EXCLUDED.active', [restaurantId, item.id, item.name, item.price, item.image || '', item.active !== false])
    if (state.floorPlan?.pdfData) await client.query('INSERT INTO floor_plan_configs (restaurant_id, file_name, pdf_data, positions) VALUES ($1, $2, $3, $4::jsonb) ON CONFLICT (restaurant_id) DO UPDATE SET file_name = EXCLUDED.file_name, pdf_data = EXCLUDED.pdf_data, positions = EXCLUDED.positions, updated_at = now()', [restaurantId, state.floorPlan.fileName, state.floorPlan.pdfData, JSON.stringify(state.floorPlan.positions || {})])
    for (const item of state.inventory) await client.query('INSERT INTO inventory_items (restaurant_id, id, name, quantity, unit, minimum, supplier) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (restaurant_id, id) DO UPDATE SET name = EXCLUDED.name, quantity = EXCLUDED.quantity, unit = EXCLUDED.unit, minimum = EXCLUDED.minimum, supplier = EXCLUDED.supplier', [restaurantId, item.id, item.name, item.quantity, item.unit, item.minimum, item.supplier || ''])
    for (const receipt of (state.stockReceipts || [])) {
      await client.query('INSERT INTO inventory_receipts (restaurant_id, id, source_file_name, source_type, extracted_text, status, created_by, created_at, approved_by, approved_at, rejected_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) ON CONFLICT (restaurant_id, id) DO UPDATE SET status = EXCLUDED.status, approved_by = EXCLUDED.approved_by, approved_at = EXCLUDED.approved_at, rejected_at = EXCLUDED.rejected_at', [restaurantId, receipt.id, receipt.sourceFileName, receipt.sourceType, receipt.extractedText || '', receipt.status, receipt.createdBy || '', receipt.createdAt, receipt.approvedBy || null, receipt.approvedAt || null, receipt.rejectedAt || null])
      await client.query('DELETE FROM inventory_receipt_lines WHERE restaurant_id = $1 AND receipt_id = $2', [restaurantId, receipt.id])
      for (const [index, line] of receipt.lines.entries()) await client.query('INSERT INTO inventory_receipt_lines (restaurant_id, receipt_id, line_index, inventory_item_id, name, quantity, unit) VALUES ($1, $2, $3, $4, $5, $6, $7)', [restaurantId, receipt.id, index, line.inventoryItemId || '', line.name, line.quantity, line.unit])
    }
    for (const order of state.orders) {
      await client.query('INSERT INTO orders (restaurant_id, id, table_name, item_count, amount, status, note, payment_method, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (restaurant_id, id) DO UPDATE SET table_name = EXCLUDED.table_name, item_count = EXCLUDED.item_count, amount = EXCLUDED.amount, status = EXCLUDED.status, note = EXCLUDED.note, payment_method = EXCLUDED.payment_method', [restaurantId, order.id, order.table, order.items, order.amount, order.status, order.note || '', order.paymentMethod || null, order.createdAt])
      await client.query('DELETE FROM order_lines WHERE restaurant_id = $1 AND order_id = $2', [restaurantId, order.id])
      for (const [index, line] of (order.lines || []).entries()) await client.query('INSERT INTO order_lines (restaurant_id, order_id, line_index, name, quantity, price) VALUES ($1, $2, $3, $4, $5, $6)', [restaurantId, order.id, index, line.name, line.quantity, line.price])
    }
    for (const withdrawal of (state.stockWithdrawals || [])) {
      await client.query('INSERT INTO stock_withdrawals (restaurant_id, id, reason, note, created_by, created_at) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (restaurant_id, id) DO UPDATE SET reason = EXCLUDED.reason, note = EXCLUDED.note', [restaurantId, withdrawal.id, withdrawal.reason, withdrawal.note || '', withdrawal.createdBy || '', withdrawal.createdAt])
      await client.query('DELETE FROM stock_withdrawal_items WHERE restaurant_id = $1 AND withdrawal_id = $2', [restaurantId, withdrawal.id])
      for (const [index, item] of withdrawal.items.entries()) await client.query('INSERT INTO stock_withdrawal_items (restaurant_id, withdrawal_id, line_index, inventory_item_id, name, quantity, unit) VALUES ($1, $2, $3, $4, $5, $6, $7)', [restaurantId, withdrawal.id, index, item.inventoryItemId, item.name, item.quantity, item.unit])
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export async function closePostgres() { await pool.end() }
