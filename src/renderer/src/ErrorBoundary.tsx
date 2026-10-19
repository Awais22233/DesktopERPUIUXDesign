import { Component, type ReactNode } from "react"

/**
 * If a screen ever fails to draw, the customer sees this calm message with a way back, never a blank white window.
 * Nothing is lost: everything already saved is safe in the database. The details go to the log (see index.ts).
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  override componentDidCatch(error: Error) {
    console.error("Screen failed to draw:", error.stack ?? error.message)
  }
  override render() {
    if (!this.state.failed) return this.props.children
    return (
      <div role="alert" style={{ maxWidth: 520, margin: "12vh auto", padding: 32, fontFamily: "Inter, system-ui, sans-serif", textAlign: "center", color: "#243046" }}>
        <h2 style={{ marginBottom: 8 }}>This screen could not be shown</h2>
        <p style={{ color: "#7c8799", lineHeight: 1.6 }}>
          Your saved data is safe. Please reload the screen. If this keeps happening, tell support and mention what you were doing. The details have been saved in the application log.
        </p>
        <button type="button" onClick={() => window.location.reload()} style={{ marginTop: 16, padding: "10px 22px", border: 0, borderRadius: 8, background: "#253b70", color: "#fff", fontSize: 15, cursor: "pointer" }}>
          Reload
        </button>
      </div>
    )
  }
}
