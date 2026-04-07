import { useState, useEffect, useRef } from 'react'

export function useThrottledValue<T>(value: T, intervalMs: number): T {
  const [throttled, setThrottled] = useState(value)
  const lastUpdate = useRef(Date.now())
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const now = Date.now()
    const elapsed = now - lastUpdate.current

    if (elapsed >= intervalMs) {
      lastUpdate.current = now
      setThrottled(value)
      if (pending.current) {
        clearTimeout(pending.current)
        pending.current = null
      }
    } else if (!pending.current) {
      pending.current = setTimeout(() => {
        lastUpdate.current = Date.now()
        setThrottled(value)
        pending.current = null
      }, intervalMs - elapsed)
    }

    return () => {
      if (pending.current) {
        clearTimeout(pending.current)
        pending.current = null
      }
    }
  }, [value, intervalMs])

  return throttled
}
