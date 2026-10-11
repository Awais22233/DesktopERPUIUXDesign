import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react"
import { ArrowRight, LockKeyhole, ShieldCheck } from "lucide-react"
import type { SessionUser } from "@shared/models"
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

function SetupScreen({ onDone }: { onDone: (u: SessionUser) => void }) {
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
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
