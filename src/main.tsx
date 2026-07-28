import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import { App } from './ui/App'

registerSW({
  onOfflineReady() {
    window.dispatchEvent(new CustomEvent('unsettled:notice', {
      detail: 'Ready to use offline.',
    }))
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
