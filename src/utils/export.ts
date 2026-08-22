import { api } from '../services/api'

export interface ExportColumn<T = any> {
  key: string
  label: string
  value?: (row: T) => unknown
}

export function todayStr(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export interface ExportCell {
  r: number
  c: number
  url: string
}

export interface BuildExportOptions<T> {
  rows: T[]
  columns: ExportColumn<T>[]
  /** 带图片模式：图片列留空并收集 imageCells；仅链接模式：图片列填 URL 文本 */
  withImages?: boolean
  /** 图片列的 key 集合，用于识别哪些列需要插图 */
  imageKeys?: string[]
}

/**
 * 将列表行 + 列定义转为后端导出所需的 aoa / cols / imageCells
 * 第一行为表头；图片列在带图片模式下留空并记录 imageCells
 */
export function buildExportPayload<T>(opts: BuildExportOptions<T>) {
  const { rows, columns, withImages = false, imageKeys = [] } = opts
  const aoa: unknown[][] = [columns.map((c) => c.label)]
  const imageCells: ExportCell[] = []
  rows.forEach((row, i) => {
    const r = i + 1
    const line: unknown[] = columns.map((col, c) => {
      const raw = col.value ? col.value(row) : (row as Record<string, unknown>)[col.key]
      const v = raw === null || raw === undefined ? '' : raw
      if (withImages && imageKeys.includes(col.key)) {
        if (typeof v === 'string' && (v.startsWith('http://') || v.startsWith('https://') || v.startsWith('data:image/'))) {
          imageCells.push({ r, c, url: v })
          return ''
        }
      }
      return v
    })
    aoa.push(line)
  })
  const cols = columns.map((c) => ({ wch: Math.max(c.label.length * 2, 12) }))
  return { aoa, cols, imageCells }
}

export interface ServerExportPayload {
  aoa: unknown[][]
  merges?: { s: { r: number; c: number }; e: { r: number; c: number } }[]
  cols?: { wch?: number }[]
  imageCells?: ExportCell[]
}

/**
 * 统一走后端导出：POST /api/export/xlsx，返回 blob 触发下载
 * withImages=true 时后端拉取图片插入单元格；false 时图片列由前端写 URL 文本
 */
export async function exportViaServer(fileName: string, payload: ServerExportPayload, withImages = false, sheetName = 'Sheet1') {
  const res = await api.post(
    '/export/xlsx',
    { ...payload, fileName, sheetName, withImages },
    { responseType: 'blob', timeout: 120000 }
  )
  const url = URL.createObjectURL(new Blob([res.data]))
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
