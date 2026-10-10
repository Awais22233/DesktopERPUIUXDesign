import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { api } from "./backend"
import type { Channel, IpcContract } from "@shared/ipc"

/** Bumped after every successful command, so every open list reloads its page. */
let dataVersion = 0
const listeners = new Set<() => void>()
export function bumpData(): void {
  dataVersion++
  listeners.forEach((l) => l())
}
const useDataVersion = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => dataVersion,
  )

export function useDebounced<T>(value: T, ms = 220): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

/**
 * Loads one page from the engine and keeps it fresh. Late answers to an old request are ignored, so a fast typist
 * never sees results for what they typed a moment ago.
 */
export function useRemote<C extends Channel>(channel: C, payload: IpcContract[C]["req"], enabled = true): { data: IpcContract[C]["res"] | undefined; loading: boolean; error: string } {
  const version = useDataVersion()
  const [data, setData] = useState<IpcContract[C]["res"] | undefined>(undefined)
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState("")
  const seq = useRef(0)
  const key = JSON.stringify(payload ?? null)
  useEffect(() => {
    if (!enabled) return
    const mine = ++seq.current
    setLoading(true)
    api(channel, payload)
      .then((r) => {
        if (mine !== seq.current) return
        setData(r)
        setError("")
      })
      .catch((e: Error) => {
        if (mine === seq.current) setError(e.message)
      })
      .finally(() => {
        if (mine === seq.current) setLoading(false)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, key, version, enabled])
  return { data, loading, error }
}
