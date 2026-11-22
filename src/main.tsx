import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/manrope/cyrillic-400.css'
import '@fontsource/manrope/cyrillic-500.css'
import '@fontsource/manrope/cyrillic-600.css'
import '@fontsource/manrope/cyrillic-700.css'
import '@fontsource/manrope/latin-400.css'
import '@fontsource/manrope/latin-500.css'
import '@fontsource/manrope/latin-600.css'
import '@fontsource/manrope/latin-700.css'
import '@fontsource/jetbrains-mono/cyrillic-500.css'
import '@fontsource/jetbrains-mono/latin-500.css'
import './index.css'
import { App } from './App.tsx'

const embed = new URLSearchParams(window.location.search).get('embed') === '1'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App embed={embed} />
  </StrictMode>,
)
