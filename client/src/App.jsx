import { useEffect, useState } from 'react'
import { api } from './lib/api'
import { socket, registerSocketUser } from './lib/socket'
import { createPeerConnection, getMedia } from './lib/webrtc'

function Login({ onAuth }) {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('client')
  const [mode, setMode] = useState('login')

  async function submit() {
    try {
      const path = mode === 'login' ? '/api/auth/login' : '/api/auth/register'
      const { token, user } = await api(path, { method: 'POST', data: { email, password, name, role } })
      onAuth({ token, user })
    } catch (e) { alert(e.message) }
  }

  return (
    <div className="p-6 max-w-md mx-auto mt-10 bg-black/60 rounded-xl border border-white/10">
      <h1 className="text-3xl mb-4 brand">SoulSeer</h1>
      <div className="flex gap-2 mb-4">
        <button className={`btn ${mode==='login'?'btn-primary':''}`} onClick={()=>setMode('login')}>Login</button>
        <button className={`btn ${mode==='register'?'btn-primary':''}`} onClick={()=>setMode('register')}>Register</button>
      </div>
      <input className="w-full mb-2 p-2 rounded bg-black/50 border border-white/10" placeholder="Email" value={email} onChange={e=>setEmail(e.target.value)} />
      {mode==='register' && (
        <>
          <input className="w-full mb-2 p-2 rounded bg-black/50 border border-white/10" placeholder="Name" value={name} onChange={e=>setName(e.target.value)} />
          <select className="w-full mb-2 p-2 rounded bg-black/50 border border-white/10" value={role} onChange={e=>setRole(e.target.value)}>
            <option value="client">Client</option>
            <option value="reader">Reader</option>
          </select>
        </>
      )}
      <input type="password" className="w-full mb-4 p-2 rounded bg-black/50 border border-white/10" placeholder="Password" value={password} onChange={e=>setPassword(e.target.value)} />
      <button className="btn btn-primary w-full" onClick={submit}>{mode==='login'?'Login':'Create account'}</button>
    </div>
  )
}

function ReadersList({ token, user, onStartSession }) {
  const [readers, setReaders] = useState([])
  useEffect(()=>{(async()=>{
    const { readers } = await api('/api/auth/readers', { token })
    setReaders(readers)
  })()},[token])

  useEffect(()=>{ registerSocketUser(user) },[user])

  useEffect(()=>{
    socket.on('session:accepted', ({ sessionId, roomId }) => {
      onStartSession({ sessionId, roomId })
    })
    return ()=>{
      socket.off('session:accepted')
    }
  },[onStartSession])

  function request(readerId) {
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
  const role = user.role

  useEffect(()=>{
    async function start() {
      const stream = await getMedia({ video: true, audio: true })
      setLocalStream(stream)
      const peer = createPeerConnection({
        onTrack: (e)=> setRemoteStream(e.streams[0]),
        onIceCandidate: (candidate)=> socket.emit('rtc:ice', { sessionId: session.sessionId, candidate })
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
      socket.on('session:end', ({ reason }) => alert(`Session ended: ${reason}`))

      peer.onconnectionstatechange = ()=>{
        const connected = ['connected','completed'].includes(peer.connectionState)
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
      </div>
      <div className="mt-4 p-3 bg-black/40 rounded border border-white/10">
        <Chat sessionId={session.sessionId} user={user} />
      </div>
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
  const [auth, setAuth] = useState(null)
  const [session, setSession] = useState(null)

  useEffect(()=>{
    if (!auth) return
    registerSocketUser(auth.user)
    socket.on('session:new', ({ sessionId, clientId }) => {
      if (auth.user.role === 'reader') {
        const accept = confirm('Incoming session. Accept?')
        if (accept) socket.emit('session:accept', { sessionId })
      }
    })
    return ()=> socket.off('session:new')
  },[auth])

  function onStartSession(data) { setSession(data) }

  if (!auth) return <Login onAuth={setAuth} />
  if (session) return <Session token={auth.token} user={auth.user} session={session} />
  if (auth.user.role === 'client') return <ReadersList token={auth.token} user={auth.user} onStartSession={onStartSession} />
  return (
    <div className="p-6 max-w-xl mx-auto mt-10 bg-black/60 rounded-xl border border-white/10">
      <div className="brand text-3xl mb-4">Reader Dashboard</div>
      <div>Waiting for incoming session requests…</div>
    </div>
  )
}
