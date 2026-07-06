import { useEffect, useRef, useState } from 'react'

export function useScanEvents(onDone?: () => void) {
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone

  useEffect(() => {
    const es = new EventSource('/api/scan/events')
    es.addEventListener('progress', (e) => {
      const p = JSON.parse((e as MessageEvent).data) as { done: number; total: number }
      if (p.total > 0 && p.done < p.total) setRunning(true)
      setProgress(p)
    })
    es.addEventListener('done', () => {
      setRunning(false)
      onDoneRef.current?.()
    })
    es.addEventListener('failed', () => setRunning(false))
    return () => es.close()
  }, [])

  return { running, progress }
}
