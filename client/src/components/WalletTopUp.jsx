import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { loadStripe } from '@stripe/stripe-js'
import { Elements, CardElement, useElements, useStripe } from '@stripe/react-stripe-js'

function TopUpForm({ token }) {
  const stripe = useStripe()
  const elements = useElements()
  const [amount, setAmount] = useState(1000)
  const [balance, setBalance] = useState(0)

  async function refresh() {
    const { balance_cents } = await api('/api/auth/wallet', { token })
    setBalance(balance_cents)
  }
  useEffect(()=>{ refresh() },[])

  async function submit() {
    const { client_secret } = await api('/api/stripe/topup', { method: 'POST', token, data: { amount_cents: amount } })
    const result = await stripe.confirmCardPayment(client_secret, { payment_method: { card: elements.getElement(CardElement) } })
    if (result.error) alert(result.error.message)
    else { alert('Top-up succeeded'); refresh() }
  }

  return (
    <div className="p-4 bg-black/60 rounded border border-white/10">
      <div className="mb-2">Wallet Balance ${(balance/100).toFixed(2)}</div>
      <div className="mb-2"><CardElement /></div>
      <div className="flex gap-2 items-center">
        <input type="number" value={amount} onChange={e=>setAmount(Number(e.target.value))} className="p-2 rounded bg-black/50 border border-white/10 w-32" />
        <button className="btn btn-primary" onClick={submit}>Add Funds</button>
      </div>
    </div>
  )
}

export default function WalletTopUp({ token, publishableKey }) {
  const stripePromise = loadStripe(publishableKey || '')
  return (
    <Elements stripe={stripePromise}>
      <TopUpForm token={token} />
    </Elements>
  )
}
