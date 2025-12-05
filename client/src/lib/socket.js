import { io } from 'socket.io-client'
import { getApiUrl } from './config'
export const socket = io(getApiUrl(), { autoConnect: true })

export function registerSocketUser(user) {
  socket.emit('user:register', { userId: user.id, role: user.role })
}
