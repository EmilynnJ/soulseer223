export async function getMedia(constraints) {
  return await navigator.mediaDevices.getUserMedia(constraints || { audio: true, video: true })
}

export function createPeerConnection({ onTrack, onIceCandidate, turn }) {
  const iceServers = [{ urls: 'stun:stun.l.google.com:19302' }]
  if (turn?.url && turn?.username && turn?.password) iceServers.push({ urls: turn.url, username: turn.username, credential: turn.password })
  const pc = new RTCPeerConnection({ iceServers })
  pc.ontrack = (e) => onTrack && onTrack(e)
  pc.onicecandidate = (e) => { if (e.candidate) onIceCandidate && onIceCandidate(e.candidate) }
  return pc
}
