import { useEffect, useState } from 'react'
import { api } from './lib/api'

export default function AdminDashboard({ token }) {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [rate, setRate] = useState(200)
  const [readers, setReaders] = useState([])

  async function createReader() {
    try {
      const { reader } = await api('/api/auth/admin/create-reader', { method: 'POST', token, data: { email, name, rate_cents: rate } })
      alert(`Reader created: ${reader.name}`)
      setEmail(''); setName(''); setRate(200);
      loadReaders()
    } catch (e) { alert(e.message) }
  }

  async function loadReaders() {
    const { readers } = await api('/api/auth/readers', { token })
    setReaders(readers)
  }
  useEffect(()=>{ loadReaders() },[])

  return (
    <div className="max-w-3xl mx-auto mt-8 p-4 bg-black/60 rounded-xl border border-white/10">
      <div className="brand text-3xl mb-4">Admin Dashboard</div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-3 bg-black/50 rounded border border-white/10">
          <div className="font-bold mb-2">Create Reader</div>
          <input className="w-full mb-2 p-2 rounded bg-black/50 border border-white/10" placeholder="Reader Email" value={email} onChange={e=>setEmail(e.target.value)} />
          <input className="w-full mb-2 p-2 rounded bg-black/50 border border-white/10" placeholder="Reader Name" value={name} onChange={e=>setName(e.target.value)} />
          <input type="number" className="w-full mb-2 p-2 rounded bg-black/50 border border-white/10" placeholder="Rate cents per minute" value={rate} onChange={e=>setRate(Number(e.target.value))} />
          <button className="btn btn-primary" onClick={createReader}>Create Reader</button>
        </div>
        <div className="p-3 bg-black/50 rounded border border-white/10">
          <div className="font-bold mb-2">Readers</div>
          <div className="space-y-2 max-h-72 overflow-auto">
            {readers.map(r=> (
              <div key={r.id} className="flex justify-between"><span>{r.name}</span><span>${(r.reader_rate_cents/100).toFixed(2)}/min</span></div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
