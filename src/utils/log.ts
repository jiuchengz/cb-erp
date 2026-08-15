// 前端操作日志工具（对应旧版 legacy/index.html 的 addLog 机制）
// 记录操作时间 / 类型 / 内容到 localStorage(cb_logs)，供 MainLayout 操作日志面板展示
export interface OpLogEntry {
  time: string
  type: 'info' | 'success' | 'warn' | 'error'
  msg: string
  detail?: string
}

const KEY = 'cb_logs'
const MAX = 500

export function formatLogTime(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

export function getLogs(): OpLogEntry[] {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as OpLogEntry[]) : []
  } catch {
    return []
  }
}

export function addLog(type: OpLogEntry['type'], msg: string, detail = ''): void {
  const entry: OpLogEntry = { time: formatLogTime(), type, msg, detail }
  const logs = getLogs()
  logs.unshift(entry)
  if (logs.length > MAX) logs.length = MAX
  try {
    localStorage.setItem(KEY, JSON.stringify(logs))
  } catch {
    /* ignore quota errors */
  }
}

export function clearLogs(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}
