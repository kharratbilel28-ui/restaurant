import * as pdfjs from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { createWorker } from 'tesseract.js'
import type { InventoryItem } from './api'

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

export type InvoiceDraftLine = { inventoryItemId: string; name: string; quantity: number; unit: string }
export type InvoiceAnalysis = { text: string; lines: InvoiceDraftLine[] }

const units = /\b(kg|kgs|kilogrammes?|g|gr|grammes?|l|litres?|ml|pcs?|pi[eè]ces?|unit[eé]s?|u|cartons?|bo[iî]tes?|sachets?|colis)\b/i
const ignoredLine = /\b(total|sous[- ]total|tva|ht|ttc|net [aà] payer|facture|date|client|livraison|r[eè]glement|merci)\b/i

function normalizeUnit(value: string) {
  const unit = value.toLocaleLowerCase('fr-FR')
  if (unit.startsWith('k') || unit === 'kilogramme' || unit === 'kilogrammes') return 'kg'
  if (unit === 'g' || unit === 'gr' || unit.startsWith('gramme')) return 'g'
  if (unit === 'l' || unit.startsWith('litre')) return 'L'
  if (unit === 'ml') return 'ml'
  if (unit.startsWith('pi') || unit.startsWith('pc') || unit === 'u' || unit.startsWith('unit')) return 'unité'
  if (unit.startsWith('bo')) return 'boîte'
  if (unit.startsWith('carton')) return 'carton'
  if (unit.startsWith('sachet')) return 'sachet'
  return unit
}

function numberValue(value: string) {
  return Number(value.replace(/\s/g, '').replace(',', '.'))
}

function matchInventory(name: string, inventory: InventoryItem[]) {
  const key = name.toLocaleLowerCase('fr-FR').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
  return inventory.find((item) => {
    const candidate = item.name.toLocaleLowerCase('fr-FR').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
    return candidate === key || candidate.includes(key) || key.includes(candidate)
  })
}

export function parseInvoiceText(text: string, inventory: InventoryItem[]): InvoiceDraftLine[] {
  const parsed: InvoiceDraftLine[] = []
  for (const rawLine of text.split(/[\r\n]+/)) {
    const line = rawLine.replace(/\s+/g, ' ').trim()
    if (line.length < 5 || ignoredLine.test(line)) continue
    const unitMatch = units.exec(line)
    let name = ''
    let quantity = 0
    let unit = ''
    if (unitMatch?.index !== undefined) {
      const beforeUnit = line.slice(0, unitMatch.index).trim()
      const quantityMatch = beforeUnit.match(/(\d+(?:[,.]\d+)?)\s*$/)
      if (!quantityMatch || quantityMatch.index === undefined) continue
      name = beforeUnit.slice(0, quantityMatch.index).replace(/^\d{3,}\s+/, '').replace(/[|:;,\.\-]+$/, '').trim()
      quantity = numberValue(quantityMatch[1])
      unit = normalizeUnit(unitMatch[1])
    } else {
      const quantityTimes = line.match(/^(\d+(?:[,.]\d+)?)\s*[x×]\s*(.+?)\s+\d+[,.]\d+/i)
      const numbers = [...line.matchAll(/\d+(?:[,.]\d+)?/g)]
      if (quantityTimes) {
        quantity = numberValue(quantityTimes[1])
        name = quantityTimes[2].trim()
      } else if (numbers.length >= 2 && numbers[0].index !== undefined && numbers[0].index > 1) {
        name = line.slice(0, numbers[0].index).replace(/[|:;,\.\-]+$/, '').trim()
        quantity = numberValue(numbers[0][0])
      } else continue
      unit = 'unité'
    }
    if (name.length < 2 || !Number.isFinite(quantity) || quantity <= 0) continue
    const match = matchInventory(name, inventory)
    parsed.push({ inventoryItemId: match?.id || '', name: match?.name || name, quantity, unit: unit === 'unité' && match ? match.unit : unit })
  }
  const deduplicated = new Map<string, InvoiceDraftLine>()
  for (const item of parsed) {
    const key = `${item.name.toLocaleLowerCase('fr-FR')}|${item.unit}`
    const previous = deduplicated.get(key)
    if (previous) previous.quantity += item.quantity
    else deduplicated.set(key, item)
  }
  return [...deduplicated.values()]
}

export async function analyzeInvoice(file: File, inventory: InventoryItem[], onProgress: (message: string) => void): Promise<InvoiceAnalysis> {
  let text = ''
  let scannedPages: Array<{ page: pdfjs.PDFPageProxy; pageNumber: number }> = []
  if (file.type === 'application/pdf' || file.name.toLocaleLowerCase().endsWith('.pdf')) {
    onProgress('Lecture du PDF...')
    const document = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
    const pagesToRead = Math.min(document.numPages, 5)
    for (let pageNumber = 1; pageNumber <= pagesToRead; pageNumber += 1) {
      onProgress(`Lecture de la page ${pageNumber}/${pagesToRead}...`)
      const page = await document.getPage(pageNumber)
      const content = await page.getTextContent()
      const pageText = content.items.map((item) => ('str' in item ? `${item.str}${item.hasEOL ? '\n' : ' '}` : '')).join('')
      text += `${pageText}\n`
      if (pageText.trim().length < 20) scannedPages.push({ page, pageNumber })
    }
  } else if (!file.type.startsWith('image/')) {
    throw new Error('Importez une image ou un PDF.')
  }

  if (file.type.startsWith('image/') || scannedPages.length) {
    onProgress(file.type.startsWith('image/') ? 'Reconnaissance du texte de la photo...' : 'OCR des pages PDF scannées...')
    const worker = await createWorker('fra', undefined, { logger: (event) => { if (event.status === 'recognizing text') onProgress(`Lecture de la photo : ${Math.round(event.progress * 100)} %...`) } })
    try {
      if (file.type.startsWith('image/')) {
        const result = await worker.recognize(file)
        text = result.data.text
      } else {
        for (const { page, pageNumber } of scannedPages) {
          onProgress(`OCR de la page ${pageNumber}/${scannedPages.length}...`)
          const viewport = page.getViewport({ scale: 1.6 })
          const canvas = document.createElement('canvas')
          canvas.width = Math.ceil(viewport.width)
          canvas.height = Math.ceil(viewport.height)
          const context = canvas.getContext('2d')
          if (!context) continue
          await page.render({ canvas, canvasContext: context, viewport }).promise
          text += `${(await worker.recognize(canvas)).data.text}\n`
          canvas.width = 0
          canvas.height = 0
        }
      }
    } finally {
      await worker.terminate()
    }
  }
  const lines = parseInvoiceText(text, inventory)
  return { text, lines }
}
