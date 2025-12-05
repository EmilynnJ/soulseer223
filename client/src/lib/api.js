import { getApiUrl } from './config'
const API_URL = getApiUrl();

export async function api(path, { method = 'GET', token, data } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API_URL}${path}`, { method, headers, body: data ? JSON.stringify(data) : undefined, credentials: 'include' });
  if (!res.ok) throw new Error((await res.json()).error || 'error');
  return res.json();
}
