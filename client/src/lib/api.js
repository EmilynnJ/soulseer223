const API_URL = window.__CONFIG__?.API_URL || 'http://localhost:4000';

export async function api(path, { method = 'GET', token, data } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API_URL}${path}`, { method, headers, body: data ? JSON.stringify(data) : undefined });
  if (!res.ok) throw new Error((await res.json()).error || 'error');
  return res.json();
}
