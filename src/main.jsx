import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@/index.css'
import { logPerf } from '@/lib/safeBoot'

console.log('[PERF] app boot start')

ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
)

setTimeout(() => logPerf('first render complete'), 0)