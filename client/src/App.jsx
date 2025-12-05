import { useEffect, useState } from 'react'
import { api } from './lib/api'
import { socket, registerSocketUser } from './lib/socket'
import { createPeerConnection, getMedia } from './lib/webrtc'
import { fetchPublicConfig } from './lib/config'
import WalletTopUp from './components/WalletTopUp'
import ReaderDashboard from './ReaderDashboard'
import PreCall from './PreCall'
import { SignedIn, SignedOut, SignIn, useAuth } from '@clerk/clerk-react'
import AdminDashboard from './AdminDashboard'
function SupportForm({ token }) {
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  async function submit() {
    try { await api('/api/auth/support/tickets', { method:'POST', token, data: { subject, message } }); setSubject(''); setMessage(''); alert('Support ticket submitted') } catch(e){ alert(e.message) }
  }
  return (
    <div className="max-w-xl mx-auto mt-6 p-4 bg-black/60 rounded-xl border border-white/10">
      <div className="font-bold mb-2">Contact Support</div>
      <input className="w-full mb-2 p-2 rounded bg-black/50 border border-white/10" placeholder="Subject" value={subject} onChange={e=>setSubject(e.target.value)} />
      <textarea className="w-full mb-2 p-2 rounded bg-black/50 border border-white/10" placeholder="Describe your issue" value={message} onChange={e=>setMessage(e.target.value)} />
      <button className="btn btn-primary" onClick={submit}>Submit</button>
    </div>
  )
}

function Login() {
  return (
    <div className="p-6 max-w-md mx-auto mt-10 bg-black/60 rounded-xl border border-white/10">
      <h1 className="text-3xl mb-4 brand">SoulSeer</h1>
      <SignIn signUp={{ enabled: true }} />
    </div>
  )
}

function ReadersList({ token, user, onStartSession, onRequireAuth }) {
  const [readers, setReaders] = useState([])
  useEffect(()=>{(async()=>{
    const { readers } = await api('/api/auth/readers', { token })
    setReaders(readers)
  })()},[token])

  useEffect(()=>{ if (user) registerSocketUser(user) },[user])

  useEffect(()=>{
    socket.on('session:accepted', ({ sessionId, roomId }) => {
      onStartSession({ sessionId, roomId })
    })
    return ()=>{
      socket.off('session:accepted')
    }
  },[onStartSession])

  function request(readerId) {
    if (!user) { onRequireAuth?.(); return }
    socket.emit('session:request', { readerId })
    alert('Requested session. Waiting for reader to accept.')
  }

  return (
    <div className="max-w-3xl mx-auto mt-8 p-4 bg-black/60 rounded-xl border border-white/10">
      <h2 className="text-2xl mb-3 brand">Available Readers</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {readers.map(r=> (
          <div key={r.id} className="p-3 bg-black/50 rounded border border-white/10">
            <div className="font-bold">{r.name}</div>
            <div className="opacity-80">Rate ${(r.reader_rate_cents/100).toFixed(2)}/min</div>
            <div className="opacity-80">Rating {r.avg_rating ?? 0} ({r.ratings_count ?? 0})</div>
            <button className="btn btn-outline mt-2" onClick={()=>request(r.id)}>Request Session</button>
          </div>
        ))}
      </div>
    </div>
  )
}

function Session({ token, user, session }) {
  const [localStream, setLocalStream] = useState(null)
  const [remoteStream, setRemoteStream] = useState(null)
  const [pc, setPc] = useState(null)
  const [minutes, setMinutes] = useState(0)
  const [ended, setEnded] = useState(false)
  const [rating, setRating] = useState(5)
  const [comment, setComment] = useState('')
  const role = user.role

  useEffect(()=>{
    async function start() {
      const stream = await getMedia({ video: true, audio: true })
      setLocalStream(stream)
      const peer = createPeerConnection({
        onTrack: (e)=> setRemoteStream(e.streams[0]),
        onIceCandidate: (candidate)=> socket.emit('rtc:ice', { sessionId: session.sessionId, candidate }),
        turn: config?.turn
      })
      stream.getTracks().forEach(t=> peer.addTrack(t, stream))
      setPc(peer)

      socket.on('rtc:offer', async ({ sdp }) => {
        await peer.setRemoteDescription(new RTCSessionDescription(sdp))
        const answer = await peer.createAnswer()
        await peer.setLocalDescription(answer)
        socket.emit('rtc:answer', { sessionId: session.sessionId, sdp: peer.localDescription })
      })
      socket.on('rtc:answer', async ({ sdp }) => {
        await peer.setRemoteDescription(new RTCSessionDescription(sdp))
      })
      socket.on('rtc:ice', async ({ candidate }) => {
        try { await peer.addIceCandidate(candidate) } catch {}
      })
      socket.on('billing:tick', ({ minuteIndex }) => setMinutes(minuteIndex))
      socket.on('session:end', ({ reason }) => { setEnded(true); alert(`Session ended: ${reason}`) })

      peer.onconnectionstatechange = ()=>{
        const state = peer.connectionState
        const connected = ['connected','completed'].includes(state)
        socket.emit('rtc:state', { sessionId: session.sessionId, role, connected })
      }

      if (role === 'client') {
        const offer = await peer.createOffer()
        await peer.setLocalDescription(offer)
        socket.emit('rtc:offer', { sessionId: session.sessionId, sdp: peer.localDescription })
      }
    }
    start()
    return ()=>{
      socket.off('rtc:offer'); socket.off('rtc:answer'); socket.off('rtc:ice'); socket.off('billing:tick'); socket.off('session:end')
      pc?.close(); localStream?.getTracks().forEach(t=>t.stop())
    }
  }, [session.sessionId])

  function end() {
    socket.emit('session:end', { sessionId: session.sessionId })
  }

  async function reconnect() {
    if (pc) { pc.close() }
    const stream = await getMedia({ video: true, audio: true })
    setLocalStream(stream)
    const peer = createPeerConnection({
      onTrack: (e)=> setRemoteStream(e.streams[0]),
      onIceCandidate: (candidate)=> socket.emit('rtc:ice', { sessionId: session.sessionId, candidate }),
      turn: config?.turn
    })
    stream.getTracks().forEach(t=> peer.addTrack(t, stream))
    setPc(peer)
    const offer = await peer.createOffer({ iceRestart: true })
    await peer.setLocalDescription(offer)
    socket.emit('rtc:offer', { sessionId: session.sessionId, sdp: peer.localDescription })
  }

  return (
    <div className="max-w-4xl mx-auto mt-6 p-4 bg-black/60 rounded-xl border border-white/10">
      <div className="flex items-center justify-between mb-3">
        <div className="brand text-2xl">SoulSeer Session</div>
        <div className="font-bold">Minutes {minutes}</div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <video className="w-full rounded" autoPlay playsInline muted ref={el=>{ if (el && localStream) el.srcObject = localStream }} />
        <video className="w-full rounded" autoPlay playsInline ref={el=>{ if (el && remoteStream) el.srcObject = remoteStream }} />
      </div>
      <div className="mt-3 flex gap-2">
        <button className="btn btn-primary" onClick={end}>End Session</button>
        <button className="btn btn-outline" onClick={reconnect}>Reconnect</button>
      </div>
      <div className="mt-4 p-3 bg-black/40 rounded border border-white/10">
        <Chat sessionId={session.sessionId} user={user} />
      </div>
      {ended && role==='client' && (
        <div className="mt-4 p-3 bg-black/40 rounded border border-white/10">
          <div className="font-bold mb-2">Rate your session</div>
          <div className="flex items-center gap-2 mb-2">
            <input type="number" min="1" max="5" value={rating} onChange={e=>setRating(Number(e.target.value))} className="w-20 p-2 rounded bg-black/50 border border-white/10" />
            <input placeholder="Optional comment" value={comment} onChange={e=>setComment(e.target.value)} className="flex-1 p-2 rounded bg-black/50 border border-white/10" />
            <button className="btn btn-primary" onClick={async()=>{ try { await api('/api/auth/ratings', { method:'POST', token, data: { session_id: session.sessionId, rating, comment } }); alert('Thanks for your rating!') } catch(e){ alert(e.message) } }}>Submit</button>
          </div>
        </div>
      )}
    </div>
  )
}

function Chat({ sessionId, user }) {
  const [text, setText] = useState('')
  const [messages, setMessages] = useState([])
  useEffect(()=>{
    const handler = (m)=> setMessages(prev=> [...prev, m])
    socket.on('chat:message', handler)
    return ()=> socket.off('chat:message', handler)
  },[])
  function send() {
    socket.emit('chat:send', { sessionId, message: text, sender: user.name })
    setText('')
  }
  return (
    <div>
      <div className="max-h-48 overflow-y-auto space-y-1 mb-2">
        {messages.map((m,i)=> (
          <div key={i} className="text-sm opacity-90"><span className="font-bold">{m.sender}</span>: {m.message}</div>
        ))}
      </div>
      <div className="flex gap-2">
        <input value={text} onChange={e=>setText(e.target.value)} className="flex-1 p-2 rounded bg-black/50 border border-white/10" placeholder="Type a message" />
        <button className="btn btn-primary" onClick={send}>Send</button>
      </div>
    </div>
  )
}

export default function App() {
  const { getToken, isSignedIn } = useAuth()
  const [auth, setAuth] = useState(null)
  const [session, setSession] = useState(null)
  const [config, setConfig] = useState(null)
  const [preCall, setPreCall] = useState(false)
  const [view, setView] = useState('home')

  useEffect(()=>{
    if (!isSignedIn) return
    (async()=>{
      let token = await getToken()
      if (!token) token = await getToken({ template: 'default' })
      if (!token) return
      const { user } = await api('/api/auth/me', { token })
      setAuth({ token, user })
      registerSocketUser(user)
      socket.on('session:new', ({ sessionId }) => {
        if (user.role === 'reader') {
          const accept = confirm('Incoming session. Accept?')
          if (accept) socket.emit('session:accept', { sessionId })
        }
      })
    })()
    return ()=> socket.off('session:new')
  },[isSignedIn])

  useEffect(()=>{ (async()=>{ try { const c = await fetchPublicConfig(); setConfig(c) } catch {} })() },[])

  function onStartSession(data) { setPreCall(true); setSession(data) }

  const [requireLogin, setRequireLogin] = useState(false)
  if (!auth) return (
    <div>
      <div className="max-w-3xl mx-auto mt-4 flex gap-2">
        <button className="btn btn-outline" onClick={()=> setView('home')}>Home</button>
        <button className="btn btn-outline" onClick={()=> setView('apply')}>Apply to be a Reader</button>
      </div>
      {view==='home' && <ReadersList token={undefined} user={null} onStartSession={onStartSession} onRequireAuth={()=> setRequireLogin(true)} />}
      {view==='apply' && <ApplyReader onSubmitted={()=> setView('home')} />}
      {requireLogin && <Login />}
    </div>
  )
  if (preCall) return <PreCall onContinue={()=> setPreCall(false)} />
  if (session) return <Session token={auth.token} user={auth.user} session={session} />
  if (auth.user.role === 'client') return (
    <div>
      <div className="max-w-3xl mx-auto mt-6"><WalletTopUp token={auth.token} publishableKey={config?.stripe_publishable_key || import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY} /></div>
      <ReadersList token={auth.token} user={auth.user} onStartSession={onStartSession} onRequireAuth={()=>{}} />
      <SupportForm token={auth.token} />
    </div>
  )
  if (auth.user.role === 'reader') return <ReaderDashboard token={auth.token} />
  if (auth.user.role === 'admin') return <AdminDashboard token={auth.token} />
  return <div className="p-6 max-w-xl mx-auto mt-10 bg-black/60 rounded-xl border border-white/10">Unknown role</div>
}
function ApplyReader({ onSubmitted }) {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [bio, setBio] = useState('')
  const [experience, setExperience] = useState(0)
  const [specialties, setSpecialties] = useState('Tarot, Astrology')
  const [rate, setRate] = useState(200)
  const [timezone, setTimezone] = useState('')
  const [availability, setAvailability] = useState('')
  async function submit() {
    try {
      await api('/api/auth/apply-reader', { method: 'POST', data: { email, name, bio, experience_years: experience, specialties, rate_cents: rate, timezone, availability } })
      alert('Application submitted. We will contact you by email.')
      onSubmitted?.()
    } catch (e) { alert(e.message) }
  }
  return (
    <div className="max-w-2xl mx-auto mt-8 p-4 bg-black/60 rounded-xl border border-white/10">
      <h2 className="text-2xl mb-3 brand">Apply to be a Reader</h2>
      <div className="space-y-2">
        <input className="w-full p-2 rounded bg-black/50 border border-white/10" placeholder="Email" value={email} onChange={e=>setEmail(e.target.value)} />
        <input className="w-full p-2 rounded bg-black/50 border border-white/10" placeholder="Full name" value={name} onChange={e=>setName(e.target.value)} />
        <textarea className="w-full p-2 rounded bg-black/50 border border-white/10" placeholder="Bio" value={bio} onChange={e=>setBio(e.target.value)} />
        <input type="number" className="w-full p-2 rounded bg-black/50 border border-white/10" placeholder="Years of experience" value={experience} onChange={e=>setExperience(Number(e.target.value))} />
        <input className="w-full p-2 rounded bg-black/50 border border-white/10" placeholder="Specialties" value={specialties} onChange={e=>setSpecialties(e.target.value)} />
        <input type="number" className="w-full p-2 rounded bg-black/50 border border-white/10" placeholder="Rate cents per minute" value={rate} onChange={e=>setRate(Number(e.target.value))} />
        <input className="w-full p-2 rounded bg-black/50 border border-white/10" placeholder="Timezone" value={timezone} onChange={e=>setTimezone(e.target.value)} />
        <textarea className="w-full p-2 rounded bg-black/50 border border-white/10" placeholder="Availability" value={availability} onChange={e=>setAvailability(e.target.value)} />
        <div className="flex gap-2">
          <button className="btn btn-primary" onClick={submit}>Submit Application</button>
          <button className="btn btn-outline" onClick={()=> onSubmitted?.()}>Cancel</button>
        </div>
      </div>
    </div>
  )
}
