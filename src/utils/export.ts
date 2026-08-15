import * as XLSX from 'xlsx'

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

/** 将当前列表行导出为 .xlsx，null/undefined 统一导出为空字符串 */
export function exportTable<T extends object>(
  rows: T[],
  columns: ExportColumn<T>[],
  fileName: string
) {
  const data = rows.map((row) => {
    const out: Record<string, unknown> = {}
    for (const col of columns) {
      const raw = col.value ? col.value(row) : (row as Record<string, unknown>)[col.key]
      out[col.label] = raw === null || raw === undefined ? '' : raw
    }
    return out
  })
  const ws = XLSX.utils.json_to_sheet(data)
  ws['!cols'] = columns.map((c) => ({ wch: Math.max(c.label.length * 2, 12) }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  XLSX.writeFile(wb, fileName)
}
