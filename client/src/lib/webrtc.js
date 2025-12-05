export async function getMedia(constraints) {
  return await navigator.mediaDevices.getUserMedia(constraints || { audio: true, video: true })
}

export function createPeerConnection({ onTrack, onIceCandidate }) {
  const pc = new RTCPeerConnection({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' }
    ]
  })
  pc.ontrack = (e) => onTrack && onTrack(e)
  pc.onicecandidate = (e) => { if (e.candidate) onIceCandidate && onIceCandidate(e.candidate) }
  return pc
}
