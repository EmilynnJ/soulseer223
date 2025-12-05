import { api } from './lib/api'
import { useState } from 'react'

export default function ReaderDashboard({ token }) {
  const [onboardingUrl, setOnboardingUrl] = useState('')
  async function onboard() {
    const { url } = await api('/api/stripe/connect/create', { method: 'POST', token })
    setOnboardingUrl(url)
    window.open(url, '_blank')
  }
  return (
    <div className="p-6 max-w-xl mx-auto mt-10 bg-black/60 rounded-xl border border-white/10">
      <div className="brand text-3xl mb-4">Reader Dashboard</div>
      <button className="btn btn-primary" onClick={onboard}>Stripe Connect Onboarding</button>
      {onboardingUrl && <div className="mt-2 text-sm opacity-80">Onboarding link created</div>}
      <div className="mt-6">Waiting for incoming session requests…</div>
    </div>
  )
}
