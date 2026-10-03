import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { ConfigProvider } from './config'
import { BusinessProvider } from './business'
import { LicenseGate } from './Activation'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <LicenseGate>
      <ConfigProvider>
        <BusinessProvider>
          <App />
        </BusinessProvider>
      </ConfigProvider>
    </LicenseGate>
  </React.StrictMode>,
)
