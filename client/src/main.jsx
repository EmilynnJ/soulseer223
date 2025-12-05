import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import { ClerkProvider } from '@clerk/clerk-react'

const clerkKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ClerkProvider publishableKey={clerkKey} frontendApi={import.meta.env.VITE_CLERK_FRONTEND_API_URL}>
      <App />
    </ClerkProvider>
  </React.StrictMode>
)
