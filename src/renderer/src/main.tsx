import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { ConfigProvider } from './config'
import { BusinessProvider } from './business'
import { LicenseGate } from './Activation'
import { AuthGate } from './Auth'

// The application only works inside the desktop shell, which provides the engine (window.api).
const root = ReactDOM.createRoot(document.getElementById('root')!)
root.render(
  window.api ? (
    <React.StrictMode>
      <LicenseGate>
        <BusinessProvider>
          <AuthGate>
            <ConfigProvider>
              <App />
            </ConfigProvider>
          </AuthGate>
        </BusinessProvider>
      </LicenseGate>
    </React.StrictMode>
  ) : (
    <div style={{ padding: 40, fontFamily: 'sans-serif' }}>
      <h2>Please open the desktop application</h2>
      <p>This program runs as an installed app. It cannot run inside a web browser.</p>
    </div>
  ),
)
