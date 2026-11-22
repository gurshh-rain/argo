import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { LandingPage } from '../src/LandingPage'

// Only the public landing page is included. The Wasp console and server stay local.
createRoot(document.getElementById('root')!).render(
  <BrowserRouter><LandingPage /></BrowserRouter>
)
