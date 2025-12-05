import { useEffect, useState } from 'react'
import { getMedia } from './lib/webrtc'

export default function PreCall({ onContinue }) {
  const [micOk, setMicOk] = useState(false)
  const [camOk, setCamOk] = useState(false)
  const [err, setErr] = useState('')

  useEffect(()=>{
    (async()=>{
      try {
        const s = await getMedia({ audio: true, video: true })
        setMicOk(true); setCamOk(true)
        s.getTracks().forEach(t=>t.stop())
      } catch(e) {
        setErr('Please allow camera and microphone permissions')
      }
    })()
  },[])

  const canProceed = micOk && camOk

  return (
    <div className="max-w-xl mx-auto mt-8 p-4 bg-black/60 rounded-xl border border-white/10">
      <div className="brand text-3xl mb-2">Pre-Call Check</div>
      <div className="mb-2">Microphone: {micOk? 'OK':'Blocked'}</div>
      <div className="mb-4">Camera: {camOk? 'OK':'Blocked'}</div>
      {err && <div className="mb-2 text-pink-500">{err}</div>}
      <button className="btn btn-primary" disabled={!canProceed} onClick={onContinue}>Continue</button>
    </div>
  )
}
