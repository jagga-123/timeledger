import { createContext, useEffect, useState } from 'react';
import api from '../api/axios';
import { isSameTimeZone } from '../utils/time';

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

  // Day boundaries and entry times use the user's saved time zone, which follows the device:
  // when the device is in a different zone, save that one.
  const syncTimezone = async (currentUser) => {
    const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!deviceZone || isSameTimeZone(deviceZone, currentUser.timezone)) return;

    try {
      const { data } = await api.patch('/auth/me', { timezone: deviceZone });
      setUser(data.user);
    } catch {
      // Keep the saved time zone; there is nothing useful to tell the user
    }
  };

  // Restore the logged-in user when the app loads
  useEffect(() => {
    if (!localStorage.getItem('token')) return;

    api
      .get('/auth/me')
      .then((res) => {
        setUser(res.data.user);
        syncTimezone(res.data.user);
      })
      .catch((err) => {
        if (err.response?.status === 401) clearSession();
      })
      .finally(() => setLoading(false));
  }, []);

  // login/register throw on failure so the page can show the errors
  const login = async (credentials) => {
    const { data } = await api.post('/auth/login', credentials);
    saveSession(data);
    syncTimezone(data.user);
  };

  const register = async (details) => {
    const { data } = await api.post('/auth/register', details);
    saveSession(data);
    syncTimezone(data.user);
  };

  // Saves the name, the time zone and/or the rounding rule (PATCH /auth/me) and keeps the logged-in user up to date
  const updateProfile = async (changes) => {
    const { data } = await api.patch('/auth/me', changes);
    setUser(data.user);
    return data.user;
  };

  const logout = clearSession;

  return (
    <AuthContext.Provider value={{ user, token, loading, login, register, updateProfile, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
