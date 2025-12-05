import { useEffect, useState, useRef } from 'react'
import { api } from './lib/api'
import { socket, registerSocketUser } from './lib/socket'
import { createPeerConnection, getMedia } from './lib/webrtc'
import { fetchPublicConfig, getApiUrl } from './lib/config'
import WalletTopUp from './components/WalletTopUp'
import ReaderDashboard from './ReaderDashboard'
import PreCall from './PreCall'
import { SignedIn, SignedOut, SignIn, useAuth } from '@clerk/clerk-react'
import AdminDashboard from './AdminDashboard'
import { io as ioClient } from 'socket.io-client'
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

function Session({ token, user, session, config }) {
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

  const [muted, setMuted] = useState(false)
  const [cameraOff, setCameraOff] = useState(false)

  function toggleMic() {
    if (!localStream) return
    localStream.getAudioTracks().forEach(t => t.enabled = !t.enabled)
    setMuted(prev => !prev)
  }

  function toggleCamera() {
    if (!localStream) return
    localStream.getVideoTracks().forEach(t => t.enabled = !t.enabled)
    setCameraOff(prev => !prev)
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
      <div className="mt-3 flex gap-2 items-center">
        <button className="btn btn-primary" onClick={end}>End Session</button>
        <button className="btn btn-outline" onClick={reconnect}>Reconnect</button>
        <button className="btn btn-outline" onClick={toggleMic}>{muted ? 'Unmute' : 'Mute'}</button>
        <button className="btn btn-outline" onClick={toggleCamera}>{cameraOff ? 'Camera On' : 'Camera Off'}</button>
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

function LiveViewer({ liveSocket, stream, auth }) {
  const [pc, setPc] = useState(null)
  const [remoteStream, setRemoteStream] = useState(null)
  const videoRef = useRef(null)
  useEffect(()=>{
    if (!liveSocket || !stream) return
    const peer = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] })
    setPc(peer)
    peer.ontrack = (e)=> setRemoteStream(e.streams[0])
    peer.onicecandidate = (e)=> { if (e.candidate) liveSocket.emit('live:ice', { streamId: stream.streamId, candidate: e.candidate }) }

    async function start() {
      liveSocket.emit('live:join', { streamId: stream.streamId, clientId: auth?.user?.id })
      const offer = await peer.createOffer()
      await peer.setLocalDescription(offer)
      liveSocket.emit('live:offer', { streamId: stream.streamId, sdp: peer.localDescription })
    }

    const onAnswer = async ({ streamId, sdp }) => {
      if (streamId !== stream.streamId) return
      await peer.setRemoteDescription(new RTCSessionDescription(sdp))
    }
    const onIce = async ({ streamId, candidate }) => {
      if (streamId !== stream.streamId) return
      try { await peer.addIceCandidate(candidate) } catch {}
    }

    liveSocket.on('live:answer', onAnswer)
    liveSocket.on('live:ice', onIce)
    start()

    return ()=> { liveSocket.off('live:answer', onAnswer); liveSocket.off('live:ice', onIce); peer.close() }
  }, [liveSocket, stream?.streamId])

  useEffect(()=>{ if (videoRef.current && remoteStream) videoRef.current.srcObject = remoteStream }, [remoteStream])

  return (
    <div className="p-3 bg-black/50 rounded border border-white/10">
      <div className="font-bold mb-2">{stream.title} • Viewers {stream.viewers}</div>
      <video ref={videoRef} autoPlay playsInline className="w-full rounded" />
      <LiveChat liveSocket={liveSocket} streamId={stream.streamId} auth={auth} />
      <LiveGifts liveSocket={liveSocket} streamId={stream.streamId} auth={auth} />
    </div>
  )
}

function LiveChat({ liveSocket, streamId, auth }) {
  const [messages, setMessages] = useState([])
  const [text, setText] = useState('')
  useEffect(()=>{
    const handler = (m)=> setMessages(prev => [...prev, m])
    liveSocket.on('live:chat', handler)
    return ()=> liveSocket.off('live:chat', handler)
  },[liveSocket])
  function send() {
    if (!text) return; liveSocket.emit('live:chat', { streamId, sender: auth?.user?.name || 'Guest', message: text }); setText('')
  }
  return (
    <div className="mt-3">
      <div className="max-h-40 overflow-y-auto space-y-1 text-sm mb-2">
        {messages.map((m,i)=> <div key={i}><span className="font-bold">{m.sender}</span>: {m.message}</div>)}
      </div>
      <div className="flex gap-2">
        <input className="flex-1 p-2 rounded bg-black/50 border border-white/10" value={text} onChange={e=>setText(e.target.value)} placeholder="Say something nice" />
        <button className="btn btn-outline" onClick={send}>Send</button>
      </div>
    </div>
  )
}

function LiveGifts({ liveSocket, streamId, auth }) {
  async function gift(amount_cents) {
    if (!auth?.user) { alert('Sign in to send gifts'); return }
    liveSocket.emit('live:gift', { streamId, clientId: auth.user.id, amount_cents })
  }
  return (
    <div className="mt-3 flex gap-2 items-center">
      <div className="opacity-80">Send a gift:</div>
      <button className="btn btn-primary" onClick={()=> gift(100)}>+$1</button>
      <button className="btn btn-primary" onClick={()=> gift(500)}>+$5</button>
      <button className="btn btn-primary" onClick={()=> gift(1000)}>+$10</button>
    </div>
  )
}

function LiveBroadcast({ liveSocket, auth }) {
  const [streaming, setStreaming] = useState(false)
  const [localStream, setLocalStream] = useState(null)
  const videoRef = useRef(null)
  const pcsRef = useRef({}) // viewerSocketId -> RTCPeerConnection
  const [streamId, setStreamId] = useState(null)

  useEffect(()=>{ if (videoRef.current && localStream) videoRef.current.srcObject = localStream },[localStream])

  useEffect(()=>{
    if (!liveSocket) return
    const onViewerJoined = ({ streamId, viewerSocketId }) => {
      // Viewer will send offer; broadcaster must answer and handle ICE
    }
    liveSocket.on('live:viewer_joined', onViewerJoined)
    return ()=> liveSocket.off('live:viewer_joined', onViewerJoined)
  },[liveSocket])

  useEffect(()=>{ if (!liveSocket) return
    const onOffer = async ({ streamId: sId, sdp, viewerSocketId }) => {
      if (sId !== streamId) return
      let pc = pcsRef.current[viewerSocketId]
      if (!pc) {
        pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] })
        pcsRef.current[viewerSocketId] = pc
        localStream.getTracks().forEach(t=> pc.addTrack(t, localStream))
        pc.onicecandidate = (e)=> { if (e.candidate) liveSocket.emit('live:ice', { streamId: sId, candidate: e.candidate, to: viewerSocketId }) }
      }
      await pc.setRemoteDescription(new RTCSessionDescription(sdp))
      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)
      liveSocket.emit('live:answer', { streamId: sId, sdp: pc.localDescription, to: viewerSocketId })
    }
    const onIce = async ({ streamId: sId, candidate, viewerSocketId }) => {
      if (sId !== streamId) return
      const pc = pcsRef.current[viewerSocketId]
      if (!pc) return
      try { await pc.addIceCandidate(candidate) } catch {}
    }
    liveSocket.on('live:offer', onOffer)
    liveSocket.on('live:ice', onIce)
    return ()=> { liveSocket.off('live:offer', onOffer); liveSocket.off('live:ice', onIce) }
  }, [liveSocket, streamId, localStream])

  async function start() {
    if (!auth?.user || auth.user.role !== 'reader') { alert('Only readers can start live streams'); return }
    const s = await getMedia({ video: true, audio: true })
    setLocalStream(s)
    liveSocket.emit('live:start', { readerId: auth.user.id, title: 'Live Reading' })
    liveSocket.once('live:started', ({ streamId }) => setStreamId(streamId))
    setStreaming(true)
  }
  function end() {
    if (streamId) liveSocket.emit('live:end', { streamId })
    Object.values(pcsRef.current).forEach(pc=> pc.close())
    pcsRef.current = {}
    localStream?.getTracks().forEach(t=>t.stop())
    setLocalStream(null)
    setStreaming(false)
  }
  return (
    <div className="p-4 bg-black/60 rounded border border-white/10">
      <div className="font-bold mb-2">Live Broadcast</div>
      {!streaming ? (
        <button className="btn btn-primary" onClick={start}>Start Stream</button>
      ) : (
        <div>
          <video ref={videoRef} autoPlay playsInline muted className="w-full rounded" />
          <div className="mt-2"><button className="btn btn-outline" onClick={end}>End Stream</button></div>
        </div>
      )}
    </div>
  )
}

function LivePage({ auth }) {
  const [liveSocket, setLiveSocket] = useState(null)
  const [streams, setStreams] = useState([])
  useEffect(()=>{
    const s = ioClient(getApiUrl() + '/live', { autoConnect: true, transports: ['websocket'] })
    setLiveSocket(s)
    s.emit('live:list')
    const onStreams = (list)=> setStreams(list)
    s.on('live:streams', onStreams)
    return ()=> { s.off('live:streams', onStreams); s.close() }
  },[])

  return (
    <div className="max-w-5xl mx-auto mt-8 p-4 bg-black/60 rounded-xl border border-white/10">
      <div className="brand text-3xl mb-3">Live</div>
      {auth?.user?.role === 'reader' && liveSocket && (
        <div className="mb-4"><LiveBroadcast liveSocket={liveSocket} auth={auth} /></div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {streams.length === 0 && <div className="opacity-80">No live streams at the moment.</div>}
        {streams.map(st => (
          <LiveViewer key={st.streamId} liveSocket={liveSocket} stream={st} auth={auth} />
        ))}
      </div>
    </div>
  )
}

function HomePage({ auth }) {
  return (
    <div className="max-w-5xl mx-auto mt-6 p-4 bg-black/60 rounded-xl border border-white/10">
      <div className="brand text-5xl text-center">SoulSeer</div>
      <div className="mt-3"><img src="https://i.postimg.cc/tRLSgCPb/HERO-IMAGE-1.jpg" alt="Hero" className="w-full rounded" /></div>
      <div className="text-center mt-3 text-2xl" style={{ fontFamily: 'Playfair Display, serif' }}>A Community of Gifted Psychics</div>
      <div className="mt-6">
        <div className="brand text-2xl mb-2">Featured Readers</div>
        <ReadersList token={auth?.token} user={auth?.user || null} onStartSession={()=>{}} onRequireAuth={()=>{}} />
      </div>
    </div>
  )
}

function AboutPage() {
  return (
    <div className="max-w-4xl mx-auto mt-8 p-4 bg-black/60 rounded-xl border border-white/10">
      <div className="brand text-4xl mb-4">About SoulSeer</div>
      <img src="https://i.postimg.cc/s2ds9RtC/FOUNDER.jpg" alt="Founder" className="w-48 h-48 object-cover rounded-full border border-white/10 mb-4" />
      <div className="space-y-3" style={{ fontFamily: 'Playfair Display, serif' }}>
        <p>At SoulSeer, we are dedicated to providing ethical, compassionate, and judgment-free spiritual guidance. Our mission is twofold: to offer clients genuine, heart-centered readings and to uphold fair, ethical standards for our readers.</p>
        <p>Founded by psychic medium Emilynn, SoulSeer was created as a response to the corporate greed that dominates many psychic platforms. Unlike other apps, our readers keep the majority of what they earn and play an active role in shaping the platform.</p>
        <p>SoulSeer is more than just an app—it’s a soul tribe. A community of gifted psychics united by our life’s calling: to guide, heal, and empower those who seek clarity on their journey.</p>
      </div>
    </div>
  )
}

function Shop({ token }) {
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(()=>{ (async()=>{
    try {
      const res = await fetch(`${location.origin.replace(/:\\d+$/, '')}${''}`) // no-op to avoid tree-shaking
    } catch {}
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:4000'}/api/stripe/products`, { credentials: 'include' })
      if (!res.ok) throw new Error('Failed to load products')
      const data = await res.json()
      setProducts(data.products || [])
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  })() },[])

  async function buy(price_id) {
    try {
      if (!token) { alert('Please sign in to purchase.'); return }
      const res = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:4000'}/api/stripe/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        credentials: 'include',
        body: JSON.stringify({ price_id, quantity: 1 })
      })
      if (!res.ok) throw new Error((await res.json()).error || 'checkout_error')
      const { url } = await res.json()
      window.location.href = url
    } catch (e) { alert(e.message) }
  }

  if (loading) return <div className="max-w-5xl mx-auto mt-8 p-4 bg-black/60 rounded-xl border border-white/10">Loading products…</div>
  if (error) return <div className="max-w-5xl mx-auto mt-8 p-4 bg-black/60 rounded-xl border border-white/10">{error}</div>

  return (
    <div className="max-w-5xl mx-auto mt-8 p-4 bg-black/60 rounded-xl border border-white/10">
      <div className="brand text-3xl mb-3">Shop</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
        {products.map(p => (
          <div key={p.id} className="p-3 bg-black/50 rounded border border-white/10 flex flex-col">
            {p.images?.[0] && <img src={p.images[0]} alt={p.name} className="w-full h-40 object-cover rounded mb-2" />}
            <div className="font-bold text-lg">{p.name}</div>
            <div className="text-sm opacity-90 mb-2">{p.description}</div>
            <div className="mt-auto flex items-center justify-between">
              <div className="font-bold">{p.price ? `${(p.price.unit_amount/100).toFixed(2)}` : ''}</div>
              {p.price && <button className="btn btn-primary" onClick={()=> buy(p.price.id)}>Buy</button>}
            </div>
          </div>
        ))}
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
  const [readerTab, setReaderTab] = useState('dashboard')

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
      <div className="max-w-5xl mx-auto mt-4 flex gap-2">
        <button className={`btn ${view==='home'?'btn-primary':'btn-outline'}`} onClick={()=> setView('home')}>Home</button>
        <button className={`btn ${view==='live'?'btn-primary':'btn-outline'}`} onClick={()=> setView('live')}>Live</button>
        <button className={`btn ${view==='shop'?'btn-primary':'btn-outline'}`} onClick={()=> setView('shop')}>Shop</button>
        <button className={`btn ${view==='about'?'btn-primary':'btn-outline'}`} onClick={()=> setView('about')}>About</button>
        <button className={`btn ${view==='apply'?'btn-primary':'btn-outline'}`} onClick={()=> setView('apply')}>Apply</button>
      </div>
      {view==='home' && <HomePage auth={null} />}
      {view==='live' && <LivePage auth={null} />}
      {view==='shop' && <Shop token={undefined} />}
      {view==='about' && <AboutPage />}
      {view==='apply' && <ApplyReader onSubmitted={()=> setView('home')} />}
      {requireLogin && <Login />}
    </div>
  )
  if (preCall) return <PreCall onContinue={()=> setPreCall(false)} />
  if (session) return <Session token={auth.token} user={auth.user} session={session} config={config} />
  if (auth.user.role === 'client') return (
    <div>
      <div className="max-w-3xl mx-auto mt-6"><WalletTopUp token={auth.token} publishableKey={config?.stripe_publishable_key || import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY} /></div>
      <div className="max-w-5xl mx-auto mt-4 flex gap-2">
        <button className={`btn ${view==='readings'?'btn-primary':'btn-outline'}`} onClick={()=> setView('readings')}>Readings</button>
        <button className={`btn ${view==='live'?'btn-primary':'btn-outline'}`} onClick={()=> setView('live')}>Live</button>
        <button className={`btn ${view==='shop'?'btn-primary':'btn-outline'}`} onClick={()=> setView('shop')}>Shop</button>
      </div>
      {view==='shop' && <Shop token={auth.token} />}
      {view==='live' && <LivePage auth={auth} />}
      {(view==='readings' || (!['shop','live'].includes(view))) && (
        <>
          <ReadersList token={auth.token} user={auth.user} onStartSession={onStartSession} onRequireAuth={()=>{}} />
          <SupportForm token={auth.token} />
        </>
      )}
    </div>
  )
  if (auth.user.role === 'reader') return (
    <div>
      <div className="max-w-5xl mx-auto mt-4 flex gap-2">
        <button className={`btn ${readerTab==='dashboard'?'btn-primary':'btn-outline'}`} onClick={()=> setReaderTab('dashboard')}>Dashboard</button>
        <button className={`btn ${readerTab==='live'?'btn-primary':'btn-outline'}`} onClick={()=> setReaderTab('live')}>Live</button>
      </div>
      {readerTab==='dashboard' && <ReaderDashboard token={auth.token} />}
      {readerTab==='live' && <LivePage auth={auth} />}
    </div>
  )
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
