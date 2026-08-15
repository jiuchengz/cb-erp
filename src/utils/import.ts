import * as XLSX from 'xlsx'
import JSZip from 'jszip'

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

// 压缩 base64 图片（canvas 重绘，最长边 maxSize，质量 0.7），压缩失败时原样返回
export function compressImageDataUrl(dataUrl: string, maxSize = 800): Promise<string> {
  return new Promise((resolve) => {
    try {
      const img = new Image()
      img.onload = () => {
        try {
          let { width, height } = img
          if (width > maxSize || height > maxSize) {
            const ratio = Math.min(maxSize / width, maxSize / height)
            width = Math.round(width * ratio)
            height = Math.round(height * ratio)
          }
          const canvas = document.createElement('canvas')
          canvas.width = width
          canvas.height = height
          const ctx = canvas.getContext('2d')
          if (!ctx) return resolve(dataUrl)
          ctx.drawImage(img, 0, 0, width, height)
          const out = canvas.toDataURL('image/jpeg', 0.7)
          resolve(out.length < dataUrl.length ? out : dataUrl)
        } catch {
          resolve(dataUrl)
        }
      }
      img.onerror = () => resolve(dataUrl)
      img.src = dataUrl
    } catch {
      resolve(dataUrl)
    }
  })
}

// 从 xlsx 提取浮动图片（旧版功能移植）
// 返回 row -> col -> dataUrl；row 为 0-based Excel 行号（表头行=0，首条数据行=1），对应 sheet_to_json(header:1) 的下标
export async function extractFloatingImages(
  arrayBuffer: ArrayBuffer
): Promise<Record<number, Record<number, string>>> {
  const result: Record<number, Record<number, string>> = {}
  try {
    const zip = await JSZip.loadAsync(arrayBuffer)
    const drawingFiles = Object.keys(zip.files).filter((p) => /^xl\/drawings\/drawing\d+\.xml$/.test(p))
    // 先收集所有 (row, col, raw dataUrl) 压缩任务，再分批并行压缩，避免 600 张图串行等待
    const tasks: { row: number; col: number; raw: string }[] = []
    for (const df of drawingFiles) {
      const drawingXml = await zip.file(df)!.async('string')
      const relsPath = `xl/drawings/_rels/${df.split('/').pop()}.rels`
      const relsXml = zip.file(relsPath) ? await zip.file(relsPath)!.async('string') : ''
      const relsMap: Record<string, string> = {}
      const relRe = /<Relationship[^>]*Id="([^"]*)"[^>]*Target="([^"]*)"[^>]*\/>/g
      let relM: RegExpExecArray | null
      while ((relM = relRe.exec(relsXml)) !== null) relsMap[relM[1]] = relM[2]
      const anchorRe =
        /<(?:xdr:)?(twoCellAnchor|oneCellAnchor)[\s\S]*?<(?:xdr:)?from>[\s\S]*?<(?:xdr:)?col>(\d+)<\/(?:xdr:)?col>[\s\S]*?<(?:xdr:)?row>(\d+)<\/(?:xdr:)?row>[\s\S]*?<(?:a:)?blip[^>]*r:embed="([^"]*)"[\s\S]*?<\/(?:xdr:)?(?:twoCellAnchor|oneCellAnchor)>/g
      const anchors: { row: number; col: number; rId: string }[] = []
      let anchM: RegExpExecArray | null
      while ((anchM = anchorRe.exec(drawingXml)) !== null) {
        anchors.push({ row: parseInt(anchM[3]), col: parseInt(anchM[2]), rId: anchM[4] })
      }
      for (const a of anchors) {
        const target = relsMap[a.rId]
        if (!target || target === 'NULL') continue
        let imgPath = target
        if (imgPath.startsWith('../')) imgPath = 'xl/' + imgPath.substring(3)
        const imgFile = zip.file(imgPath)
        if (!imgFile) continue
        const b64 = await imgFile.async('base64')
        const ext = imgPath.split('.').pop()?.toLowerCase() || 'png'
        const mimeMap: Record<string, string> = {
          png: 'image/png',
          jpg: 'image/jpeg',
          jpeg: 'image/jpeg',
          gif: 'image/gif',
          bmp: 'image/bmp',
          webp: 'image/webp',
          svg: 'image/svg+xml',
        }
        const mime = mimeMap[ext] || 'image/png'
        tasks.push({ row: a.row, col: a.col, raw: `data:${mime};base64,${b64}` })
      }
    }
    // 每批 20 张并发压缩，结果仍按 row/col 写回，返回结构不变
    const BATCH = 20
    for (let i = 0; i < tasks.length; i += BATCH) {
      const batch = tasks.slice(i, i + BATCH)
      await Promise.all(
        batch.map(async (t) => {
          const compressed = await compressImageDataUrl(t.raw)
          if (!result[t.row]) result[t.row] = {}
          result[t.row][t.col] = compressed
        })
      )
    }
  } catch {
    // 解析失败返回空，不影响导入主流程
  }
  return result
}
