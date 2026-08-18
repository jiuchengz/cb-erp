// 空闲自动退出：整个系统无操作超过阈值后触发登出
// 阈值：3 小时（毫秒）
export const IDLE_TIMEOUT_MS = 3 * 60 * 60 * 1000

// 监听这些用户活动事件，任一事件发生即重置计时器
const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'wheel'] as const

export interface IdleWatcher {
  start: () => void
  stop: () => void
  reset: () => void
}

export function createIdleWatcher(timeoutMs: number, onIdle: () => void): IdleWatcher {
  let timer: number | undefined

  function clearTimer() {
    if (timer !== undefined) {
      window.clearTimeout(timer)
      timer = undefined
    }
  }

  function reset() {
    clearTimer()
    timer = window.setTimeout(onIdle, timeoutMs)
  }

  function start() {
    for (const ev of ACTIVITY_EVENTS) {
      window.addEventListener(ev, reset, { passive: true })
    }
    reset()
  }

  function stop() {
    for (const ev of ACTIVITY_EVENTS) {
      window.removeEventListener(ev, reset)
    }
    clearTimer()
  }

  return { start, stop, reset }
}
