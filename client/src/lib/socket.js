import { io } from 'socket.io-client'

const API_URL = window.__CONFIG__?.API_URL || 'http://localhost:4000'
export const socket = io(API_URL, { autoConnect: true })

export function registerSocketUser(user) {
  socket.emit('user:register', { userId: user.id, role: user.role })
}
