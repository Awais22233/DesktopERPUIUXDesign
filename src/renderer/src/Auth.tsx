import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react"
import { ArrowRight, LockKeyhole, ShieldCheck } from "lucide-react"
import type { SessionUser } from "@shared/models"
import type { RestoreCandidate } from "@shared/ipc"
import { Button, Field, Heading, Input } from "./ui"
import { BrandMark, useBusiness } from "./business"
import { api } from "./backend"

type SessionValue = { user: SessionUser; logout: () => Promise<void>; can: (permission: string) => boolean }
const SessionContext = createContext<SessionValue | null>(null)

export function useSession() {
  const v = useContext(SessionContext)
  if (!v) throw new Error("useSession must be used inside AuthGate")
  return v
}

function Shell({ title, text, children, footer }: { title: string; text: string; children: ReactNode; footer: string }) {
  const { business } = useBusiness()
  return (
    <div className="login-screen">
      <div className="login-brand">
        <BrandMark logo={business.logo} />
        <strong>{(business.name || "Wholesale ERP").toUpperCase()}</strong>
      </div>
      <div className="login-card">
        <span className="login-icon">
          <LockKeyhole size={26} />
        </span>
        <Heading level={1}>{title}</Heading>
        <p>{text}</p>
        {children}
      </div>
      <div className="login-footer">
        <ShieldCheck size={15} />
        {footer}
      </div>
    </div>
  )
}

/** New computer, or a reinstall: bring the business back from a backup (USB drive, Google Drive folder, any folder). */
function RestoreScreen({ onBack }: { onBack: () => void }) {
  const [suggested, setSuggested] = useState<string[] | null>(null)
  const [folder, setFolder] = useState<string | null>(null)
  const [found, setFound] = useState<RestoreCandidate[] | null>(null)
  const [pick, setPick] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
  useEffect(() => {
    void api("restore:scan")
      .then((r) => setSuggested(r.suggested))
      .catch(() => setSuggested([]))
  }, [])
  async function open(dir: string) {
    setError("")
    setBusy(true)
    try {
      const r = await api("restore:scan", { folder: dir })
      setFolder(dir)
      setFound(r.found)
      setPick(r.found.find((c) => c.ok)?.name ?? "")
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  async function choose() {
    try {
      const r = await api("restore:chooseFolder")
      if (r.folder) await open(r.folder)
    } catch (e) {
      setError((e as Error).message)
    }
  }
  async function start() {
    if (!folder || !pick) return
    setBusy(true)
    setError("")
    try {
      await api("restore:start", { folder, name: pick })
      // the program restarts by itself; nothing more to do here
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }
  return (
    <Shell title="Restore from a backup" text="Use this on a new computer, or after reinstalling. Choose the USB drive or the Google Drive folder that holds your backups." footer="Your records and photos are copied back. Passwords stay as they were.">
      {found === null ? (
        <>
          {suggested === null && <p>Looking for backups…</p>}
          {suggested?.length === 0 && <p>No backup folder was found automatically. Plug in the USB drive, or choose the folder yourself.</p>}
          {suggested?.map((d) => (
            <Button key={d} className="full-width" onClick={() => void open(d)} disabled={busy}>
              {d}
            </Button>
          ))}
          <Button variant="primary" className="full-width" onClick={() => void choose()} disabled={busy}>
            Choose a folder…
          </Button>
        </>
      ) : (
        <>
          <p>
            <strong>{folder}</strong>
          </p>
          {found.length === 0 && <div className="form-error">No backups were found in this folder.</div>}
          <div className="restore-list" role="radiogroup" aria-label="Backups found">
            {found.map((c) => (
              <label key={c.name} className={`restore-item${c.ok ? "" : " bad"}`}>
                <input type="radio" name="restore" disabled={!c.ok} checked={pick === c.name} onChange={() => setPick(c.name)} />
                <span>
                  <strong>{c.business || "Business backup"}</strong> · {when(c.modified)}
                  <br />
                  {c.ok ? `${c.sales} sales, ${c.customers} customers` : c.reason}
                </span>
              </label>
            ))}
          </div>
          {error && <div className="form-error">{error}</div>}
          <Button variant="primary" className="full-width" disabled={!pick || busy} onClick={() => void start()}>
            {busy ? "Restoring…" : "Restore this backup"}
            <ArrowRight size={16} />
          </Button>
          <Button className="full-width" onClick={() => { setFound(null); setFolder(null) }} disabled={busy}>
            Choose another folder
          </Button>
        </>
      )}
      {found === null && error && <div className="form-error">{error}</div>}
      <Button variant="ghost" className="full-width" onClick={onBack} disabled={busy}>
        Back
      </Button>
    </Shell>
  )
}

function SetupScreen({ onDone }: { onDone: (u: SessionUser) => void }) {
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [restoring, setRestoring] = useState(false)
  if (restoring) return <RestoreScreen onBack={() => setRestoring(false)} />
  return (
    <Shell title="Create the owner account" text="This is the first sign-in for this business. The owner can add other users later." footer="Your password is stored securely on this computer only.">
      <form
        onSubmit={async (e) => {
          e.preventDefault()
          const f = new FormData(e.currentTarget)
          const password = String(f.get("password"))
          if (password !== String(f.get("again"))) return setError("The two passwords do not match.")
          setBusy(true)
          setError("")
          try {
            onDone(await api("auth:setup", { name: String(f.get("name")), username: String(f.get("username")).trim(), password }))
          } catch (err) {
            setError((err as Error).message)
          } finally {
            setBusy(false)
          }
        }}
      >
        <Field label="Your name" required>
          <Input name="name" required autoFocus />
        </Field>
        <Field label="Username" required>
          <Input name="username" required autoComplete="username" />
        </Field>
        <Field label="Password" required hint="At least 6 characters.">
          <Input name="password" type="password" minLength={6} required autoComplete="new-password" />
        </Field>
        <Field label="Repeat password" required>
          <Input name="again" type="password" minLength={6} required autoComplete="new-password" />
        </Field>
        {error && <div className="form-error">{error}</div>}
        <Button variant="primary" className="full-width" type="submit" disabled={busy}>
          Create account
          <ArrowRight size={16} />
        </Button>
        <Button type="button" variant="ghost" className="full-width" onClick={() => setRestoring(true)}>
          I already have data: restore from a backup
        </Button>
      </form>
    </Shell>
  )
}

function LoginScreen({ onDone }: { onDone: (u: SessionUser) => void }) {
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  return (
    <Shell title="Sign in" text="Enter your username and password to open the workspace." footer="Works offline. Your data stays on this computer.">
      <form
        onSubmit={async (e) => {
          e.preventDefault()
          const f = new FormData(e.currentTarget)
          setBusy(true)
          setError("")
          try {
            onDone(await api("auth:login", { username: String(f.get("username")), password: String(f.get("password")) }))
          } catch (err) {
            setError((err as Error).message)
          } finally {
            setBusy(false)
          }
        }}
      >
        <Field label="Username" required>
          <Input name="username" required autoFocus autoComplete="username" />
        </Field>
        <Field label="Password" required>
          <Input name="password" type="password" required autoComplete="current-password" />
        </Field>
        {error && <div className="form-error">{error}</div>}
        <Button variant="primary" className="full-width" type="submit" disabled={busy}>
          Sign in
          <ArrowRight size={16} />
        </Button>
      </form>
    </Shell>
  )
}

/** Sits above the application: first-run owner setup, then sign-in, then the workspace. */
export function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ loading: boolean; setupNeeded: boolean; user: SessionUser | null }>({ loading: true, setupNeeded: false, user: null })

  const load = useCallback(async () => {
    try {
      const s = await api("auth:status")
      setState({ loading: false, setupNeeded: s.setupNeeded, user: s.user })
    } catch {
      setState({ loading: false, setupNeeded: false, user: null })
    }
  }, [])

  useEffect(() => {
    void load()
    const lost = () => setState((s) => ({ ...s, user: null }))
    window.addEventListener("erp:auth-lost", lost)
    return () => window.removeEventListener("erp:auth-lost", lost)
  }, [load])

  if (state.loading) return null
  if (state.setupNeeded) return <SetupScreen onDone={(user) => setState({ loading: false, setupNeeded: false, user })} />
  if (!state.user) return <LoginScreen onDone={(user) => setState({ loading: false, setupNeeded: false, user })} />
  const user = state.user
  const value: SessionValue = {
    user,
    can: (p) => user.permissions.includes(p),
    logout: async () => {
      await api("auth:logout").catch(() => null)
      setState({ loading: false, setupNeeded: false, user: null })
    },
  }
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}
