import { createContext, useEffect, useState } from 'react';
import api from '../api/axios';

export const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(() => localStorage.getItem('token'));
  // Only "loading" while we verify an existing token on app start
  const [loading, setLoading] = useState(() => Boolean(localStorage.getItem('token')));

  const saveSession = ({ user, token }) => {
    localStorage.setItem('token', token);
    setToken(token);
    setUser(user);
  };

  const clearSession = () => {
    localStorage.removeItem('token');
    setToken(null);
    setUser(null);
  };

  // Restore the logged-in user when the app loads
  useEffect(() => {
    if (!localStorage.getItem('token')) return;

    api
      .get('/auth/me')
      .then((res) => setUser(res.data.user))
      .catch((err) => {
        if (err.response?.status === 401) clearSession();
      })
      .finally(() => setLoading(false));
  }, []);

  // login/register throw on failure so the page can show the errors
  const login = async (credentials) => {
    const { data } = await api.post('/auth/login', credentials);
    saveSession(data);
  };

  const register = async (details) => {
    const { data } = await api.post('/auth/register', details);
    saveSession(data);
  };

  const logout = clearSession;

  return (
    <AuthContext.Provider value={{ user, token, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
