import { useEffect, useState } from 'react'
import { api } from './lib/api'

export default function AdminDashboard({ token }) {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [rate, setRate] = useState(200)
  const [readers, setReaders] = useState([])
  const [applications, setApplications] = useState([])
  const [ledger, setLedger] = useState([])
  const [metrics, setMetrics] = useState(null)
  const [tickets, setTickets] = useState([])
  const [avatar, setAvatar] = useState('')
  const [bio, setBio] = useState('')
  const [specialties, setSpecialties] = useState('')
  const [view, setView] = useState('readers')

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
  async function loadApplications() {
    const { applications } = await api('/api/auth/admin/reader-applications', { token })
    setApplications(applications)
  }
  async function approve(id) {
    try {
      await api(`/api/auth/admin/reader-applications/${id}/approve`, { method: 'POST', token })
      await loadApplications(); await loadReaders()
      alert('Approved')
    } catch (e) { alert(e.message) }
  }
  async function loadLedger() {
    const { ledger } = await api('/api/auth/admin/ledger', { token })
    setLedger(ledger)
  }
  async function loadMetrics() {
    const m = await api('/api/auth/admin/metrics', { token })
    setMetrics(m)
  }
  async function loadTickets() {
    const { tickets } = await api('/api/auth/admin/support/tickets', { token })
    setTickets(tickets)
  }
  async function updateReader(rid) {
    try {
      const { reader } = await api(`/api/auth/admin/readers/${rid}/update`, { method: 'POST', token, data: { name, rate_cents: rate, avatar_url: avatar, bio, specialties } })
      alert('Updated')
      await loadReaders()
    } catch (e) { alert(e.message) }
  }
  async function uploadAvatar(rid, file) {
    try {
      const reader = new FileReader()
      reader.onload = async () => {
        try {
          const { reader: r } = await api(`/api/auth/admin/readers/${rid}/avatar`, { method: 'POST', token, data: { data_url: reader.result } })
          setAvatar(r.avatar_url || '')
          await loadReaders()
          alert('Avatar uploaded')
        } catch (e) { alert(e.message) }
      }
      reader.readAsDataURL(file)
    } catch (e) { alert('upload_error') }
  }
  async function refund(user_id, amount_cents) {
    try { await api('/api/auth/admin/refund', { method: 'POST', token, data: { user_id, amount_cents, reason: 'admin_adjustment' } }); await loadLedger(); alert('Refunded') } catch (e){ alert(e.message) }
  }
  useEffect(()=>{ loadReaders(); loadApplications(); loadLedger(); loadMetrics(); loadTickets() },[])

  return (
    <div className="max-w-5xl mx-auto mt-8 p-4 bg-black/60 rounded-xl border border-white/10">
      <div className="brand text-3xl mb-4">Admin Dashboard</div>
      <div className="flex gap-2 mb-4">
        <button className={`btn ${view==='readers'?'btn-primary':'btn-outline'}`} onClick={()=> setView('readers')}>Readers</button>
        <button className={`btn ${view==='applications'?'btn-primary':'btn-outline'}`} onClick={()=> setView('applications')}>Applications</button>
        <button className={`btn ${view==='ledger'?'btn-primary':'btn-outline'}`} onClick={()=> setView('ledger')}>Ledger</button>
        <button className={`btn ${view==='metrics'?'btn-primary':'btn-outline'}`} onClick={()=> setView('metrics')}>Analytics</button>
        <button className={`btn ${view==='support'?'btn-primary':'btn-outline'}`} onClick={()=> setView('support')}>Support</button>
      </div>
      {view==='readers' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-3 bg-black/50 rounded border border-white/10">
            <div className="font-bold mb-2">Create Reader</div>
            <input className="w-full mb-2 p-2 rounded bg-black/50 border border-white/10" placeholder="Reader Email" value={email} onChange={e=>setEmail(e.target.value)} />
            <input className="w-full mb-2 p-2 rounded bg-black/50 border border-white/10" placeholder="Reader Name" value={name} onChange={e=>setName(e.target.value)} />
            <input type="number" className="w-full mb-2 p-2 rounded bg-black/50 border border-white/10" placeholder="Rate cents per minute" value={rate} onChange={e=>setRate(Number(e.target.value))} />
            <button className="btn btn-primary" onClick={createReader}>Create Reader</button>
          </div>
          <div className="p-3 bg-black/50 rounded border border-white/10">
            <div className="font-bold mb-2">Manage Readers</div>
            <div className="space-y-2 max-h-80 overflow-auto">
              {readers.map(r=> (
                <div key={r.id} className="p-2 border border-white/10 rounded">
                  <div className="flex justify-between items-center"><span>{r.name}</span><span>${(r.reader_rate_cents/100).toFixed(2)}/min</span></div>
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <input className="p-2 rounded bg-black/50 border border-white/10" placeholder="Name" value={name} onChange={e=>setName(e.target.value)} />
                  <input type="number" className="p-2 rounded bg-black/50 border border-white/10" placeholder="Rate cents" value={rate} onChange={e=>setRate(Number(e.target.value))} />
                  <input className="p-2 rounded bg-black/50 border border-white/10" placeholder="Avatar URL" value={avatar} onChange={e=>setAvatar(e.target.value)} />
                  <div className="p-2 rounded bg-black/50 border border-white/10">
                    <input type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>{ const f=e.target.files?.[0]; if (f) uploadAvatar(r.id, f) }} />
                  </div>
                  <input className="p-2 rounded bg-black/50 border border-white/10" placeholder="Specialties" value={specialties} onChange={e=>setSpecialties(e.target.value)} />
                  <textarea className="col-span-2 p-2 rounded bg-black/50 border border-white/10" placeholder="Bio" value={bio} onChange={e=>setBio(e.target.value)} />
                </div>
                <div className="mt-2"><button className="btn btn-outline" onClick={()=> updateReader(r.id)}>Save</button></div>
              </div>
              ))}
            </div>
          </div>
        </div>
      )}
      {view==='applications' && (
        <div className="p-3 bg-black/50 rounded border border-white/10">
          <div className="font-bold mb-2">Reader Applications</div>
          <div className="space-y-2 max-h-96 overflow-auto">
            {applications.map(a=> (
              <div key={a.id} className="p-2 border border-white/10 rounded">
                <div className="flex justify-between"><span>{a.name} ({a.email})</span><span>{a.status}</span></div>
                <div className="opacity-80">Rate {(a.rate_cents/100).toFixed(2)}/min • {a.specialties}</div>
                <div className="mt-2 flex gap-2">
                  <button className="btn btn-primary" onClick={()=> approve(a.id)}>Approve</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {view==='ledger' && (
        <div className="p-3 bg-black/50 rounded border border-white/10">
          <div className="font-bold mb-2">Ledger</div>
          <div className="space-y-2 max-h-96 overflow-auto">
            {ledger.map(l=> (
              <div key={l.id} className="p-2 border border-white/10 rounded flex justify-between">
                <div>{l.name} ({l.email})</div>
                <div>{l.type} ${(l.amount_cents/100).toFixed(2)} {l.source}</div>
                <div><button className="btn btn-outline" onClick={()=> refund(l.user_id, 100)}>Refund $1</button></div>
              </div>
            ))}
          </div>
        </div>
      )}
      {view==='metrics' && metrics && (
        <div className="p-3 bg-black/50 rounded border border-white/10 grid grid-cols-2 gap-2">
          <div className="p-2 border border-white/10 rounded">Users {metrics.users}</div>
          <div className="p-2 border border-white/10 rounded">Readers {metrics.readers}</div>
          <div className="p-2 border border-white/10 rounded">Sessions {metrics.sessions}</div>
          <div className="p-2 border border-white/10 rounded">Revenue ${(metrics.revenue_cents/100).toFixed(2)}</div>
          <div className="p-2 border border-white/10 rounded">Refunds ${(metrics.refunds_cents/100).toFixed(2)}</div>
        </div>
      )}
      {view==='support' && (
        <div className="p-3 bg-black/50 rounded border border-white/10">
          <div className="font-bold mb-2">Support Tickets</div>
          <div className="space-y-2 max-h-96 overflow-auto">
            {tickets.map(t=> (
              <div key={t.id} className="p-2 border border-white/10 rounded">
                <div className="flex justify-between"><span>{t.subject}</span><span>{t.status}</span></div>
                <div className="opacity-80">{t.name} ({t.email})</div>
                <div className="mt-2 text-sm opacity-90">{t.message}</div>
                <div className="mt-2 flex gap-2">
                  <button className="btn btn-outline" onClick={async()=>{ try { await api(`/api/auth/admin/support/tickets/${t.id}/status`, { method:'POST', token, data: { status: 'in_review' } }); await loadTickets() } catch(e){ alert(e.message) } }}>Mark In Review</button>
                  <button className="btn btn-outline" onClick={async()=>{ try { await api(`/api/auth/admin/support/tickets/${t.id}/status`, { method:'POST', token, data: { status: 'closed' } }); await loadTickets() } catch(e){ alert(e.message) } }}>Close</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
