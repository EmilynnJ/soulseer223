export function getApiUrl() {
  return import.meta.env.VITE_API_URL || 'http://localhost:4000'
}

export async function fetchPublicConfig() {
  const res = await fetch(`${getApiUrl()}/api/config`)
  if (!res.ok) throw new Error('config_error')
  return res.json()
}
