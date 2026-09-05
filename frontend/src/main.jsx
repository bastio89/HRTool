import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

// The router now lives inside App (a data router via RouterProvider), so the
// providers wrap it from here. None of them use router hooks, so this order is
// safe and keeps auth/theme/i18n state alive across navigations.
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
