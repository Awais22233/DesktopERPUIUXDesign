import { useEffect, useState, type ReactNode } from "react"
import { ArrowRight, Check, Copy, HardDrive, KeyRound } from "lucide-react"
import type { LicenseStatus } from "@shared/ipc"
import { Button, Field, Heading, Textarea } from "./ui"
import { BrandMark } from "./business"

function ActivationScreen({ status, onActivated }: { status: LicenseStatus; onActivated: () => void }) {
  const [key, setKey] = useState("")
  const [error, setError] = useState(status.state === "missing" ? "" : status.message)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const blocked = status.state === "wrong_machine" || status.state === "expired" || status.state === "wrong_profile" || status.state === "clock_tampered"

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(status.machineId)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      /* the id is shown on screen and can be typed */
    }
  }
  const activate = async () => {
    setBusy(true)
    setError("")
    const r = await window.api!.invoke("license:activate", { key })
    setBusy(false)
    if (!r.ok) return setError(r.error.message)
    if (r.data.state === "valid") onActivated()
    else setError(r.data.message)
  }

  return (
    <div className="login-screen">
      <div className="login-brand">
        <BrandMark />
        <strong>WHOLESALE ERP</strong>
      </div>
      <div className="login-card activation-card">
        <span className="login-icon">
          <KeyRound size={26} />
        </span>
        <Heading level={1}>Activate your software</Heading>
        <p>Send the Computer ID below to your software provider. They will give you a license key to paste here.</p>
        <Field label="Computer ID">
          <div className="machine-id">
            <code>{status.machineId}</code>
            <Button type="button" onClick={copy}>
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </Field>
        {!blocked && (
          <Field label="License key" required>
            <Textarea rows={4} value={key} onChange={(e) => setKey(e.target.value)} placeholder="Paste the license key here" spellCheck={false} />
          </Field>
        )}
        {error && <div className="form-error">{error}</div>}
        {!blocked && (
          <Button variant="primary" className="full-width" disabled={busy || !key.trim()} onClick={activate}>
            {busy ? "Checking…" : "Activate"}
            <ArrowRight size={16} />
          </Button>
        )}
      </div>
      <div className="login-footer">
        <HardDrive size={15} />
        Activation works offline. Nothing is sent over the internet.
      </div>
    </div>
  )
}

/** Shows the activation screen until a valid license exists. In a plain browser preview it does nothing. */
export function LicenseGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<LicenseStatus | null>(null)
  const [round, setRound] = useState(0)

  useEffect(() => {
    if (!window.api) return
    void window.api.invoke("license:status").then((r) => {
      if (r.ok) setStatus(r.data)
    })
  }, [round])

  if (!window.api) return <>{children}</>
  if (!status) return null
  if (status.state !== "valid") return <ActivationScreen status={status} onActivated={() => setRound((n) => n + 1)} />
  return <div key={round} style={{ display: "contents" }}>{children}</div>
}
