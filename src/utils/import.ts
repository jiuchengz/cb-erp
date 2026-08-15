import * as XLSX from 'xlsx'

export interface TemplateColumn {
  label: string
  sample?: string | number
}

// 下载含中文表头 + 示例行的 xlsx 模板
export function downloadTemplate(columns: TemplateColumn[], sheetName: string, fileName: string) {
  const headers = columns.map((c) => c.label)
  const sample = columns.map((c) => (c.sample === undefined ? '' : c.sample))
  const ws = XLSX.utils.aoa_to_sheet([headers, sample])
  ws['!cols'] = headers.map(() => ({ wch: 18 }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  XLSX.writeFile(wb, fileName)
}

// 解析 Excel 文件（array 读取，兼容 xlsx/xls/csv），返回表头与数据行（不含表头行）
export function readExcelFile(file: File): Promise<{ headers: string[]; rows: any[][] }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target?.result as ArrayBuffer)
        const wb = XLSX.read(data, { type: 'array' })
        const sheet = wb.Sheets[wb.SheetNames[0]]
        const raw = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][]
        if (!raw.length) {
          reject(new Error('文件为空'))
          return
        }
        const headers = raw[0].map((h) => String(h ?? '').trim())
        resolve({ headers, rows: raw.slice(1) })
      } catch (e: any) {
        reject(new Error('文件解析失败：' + (e?.message || e)))
      }
    }
    reader.onerror = () => reject(new Error('文件读取失败'))
    reader.readAsArrayBuffer(file)
  })
}

// 表头别名匹配（中文/英文双匹配），返回字段名 -> 列号
export function buildColMap(headers: string[], aliases: Record<string, string[]>): Record<string, number> {
  const map: Record<string, number> = {}
  headers.forEach((h, i) => {
    for (const key of Object.keys(aliases)) {
      if (!(key in map) && aliases[key].includes(h)) {
        map[key] = i
        break
      }
    }
  })
  return map
}

// 取单元格字符串（空值归一为空串）
export function cellStr(row: any[], idx: number | undefined): string {
  if (idx === undefined || !row || row[idx] === null || row[idx] === undefined) return ''
  return String(row[idx]).trim()
}

// 取单元格数值
export function cellNum(row: any[], idx: number | undefined, def = 0): number {
  const s = cellStr(row, idx)
  if (!s) return def
  const n = Number(s)
  return Number.isFinite(n) ? n : def
}

// 自动生成单号：PREFIX-YYYYMMDD-序号
export function autoNo(prefix: string, seq: number) {
  const d = new Date()
  const pad = (n: number, l = 2) => String(n).padStart(l, '0')
  return `${prefix}-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(seq, 3)}`
}
