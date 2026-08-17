import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { IconSprite } from './components/Icon'
import { ToastProvider } from './components/ui'
import './styles/app.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ToastProvider>
      <IconSprite />
      <App />
    </ToastProvider>
  </React.StrictMode>
)
