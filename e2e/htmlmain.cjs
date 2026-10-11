// Minimal shell that just opens a local html file; used to drive the license generator page in a real browser engine.
const { app, BrowserWindow } = require("electron")
app.whenReady().then(() => {
  const w = new BrowserWindow({ width: 1000, height: 1100, webPreferences: { contextIsolation: true, sandbox: true } })
  w.loadFile(process.env.HTML_FILE)
})
app.on("window-all-closed", () => app.quit())
