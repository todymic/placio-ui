import { ref } from 'vue';

const TOKEN_KEY = 'bo_jwt';

export const auth = {
  loggedIn: ref(!!localStorage.getItem(TOKEN_KEY)),

  getToken() {
    return localStorage.getItem(TOKEN_KEY);
  },

  setToken(token) {
    localStorage.setItem(TOKEN_KEY, token);
    auth.loggedIn.value = true;
  },

  clear() {
    localStorage.removeItem(TOKEN_KEY);
    auth.loggedIn.value = false;
  },

  isLoggedIn() {
    return !!localStorage.getItem(TOKEN_KEY);
  },

  async login(email, password) {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) throw new Error('Identifiants invalides');
    const data = await res.json();
    auth.setToken(data.token);
    return data;
  },

  async me() {
    const res = await apiFetch('/api/auth/me');
    return res.json();
  },
};

export async function apiFetch(url, options = {}) {
  const token = auth.getToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  };

  const res = await fetch(url, { ...options, headers });

  if (res.status === 401) {
    auth.clear();
    throw new Error('SESSION_EXPIRED');
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || body.detail || `Erreur ${res.status}`);
  }

  return res;
}
