import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

const API_BASE = "/api";
const TOKEN_KEY = "inventiq_token";
const USER_KEY = "inventiq_user";
const DEMO_TOKEN_PREFIX = "demo-";

const AuthContext = createContext(null);

function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

function getUser() {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function isTokenExpired(token) {
  if (token.startsWith(DEMO_TOKEN_PREFIX)) return true;
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    if (payload.exp && payload.exp * 1000 < Date.now()) {
      return true;
    }
  } catch {
    return true;
  }
  return false;
}

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => {
    const t = getToken();
    if (t && !isTokenExpired(t) && !t.startsWith(DEMO_TOKEN_PREFIX)) return t;
    localStorage.removeItem(TOKEN_KEY);
    return null;
  });
  const [user, setUser] = useState(() => {
    if (!token) return null;
    return getUser();
  });
  const [loading, setLoading] = useState(false);

  const clearAuth = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setToken(null);
    setUser(null);
  }, []);

  const updateUser = useCallback((nextUser) => {
    localStorage.setItem(USER_KEY, JSON.stringify(nextUser));
    setUser(nextUser);
  }, []);

  const login = useCallback(async (email, password) => {
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.detail || "Login failed.");
      }
      if (!data.access_token || data.access_token.startsWith(DEMO_TOKEN_PREFIX)) {
        throw new Error("Login returned an invalid authentication token.");
      }
      localStorage.setItem(TOKEN_KEY, data.access_token);
      localStorage.setItem(USER_KEY, JSON.stringify(data.user));
      setToken(data.access_token);
      setUser(data.user);
      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error
          ? err.message
          : "Unable to sign in. Check the backend server and credentials.",
      };
    } finally {
      setLoading(false);
    }
  }, []);

  const register = useCallback(async (name, email, password) => {
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.detail || "Registration failed.");
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      const currentToken = getToken();
      if (currentToken && !currentToken.startsWith(DEMO_TOKEN_PREFIX)) {
        await fetch(`${API_BASE}/auth/logout`, {
          method: "POST",
          headers: { Authorization: `Bearer ${currentToken}` },
        });
      }
    } catch {
      // Ignore logout API errors
    }
    clearAuth();
  }, [clearAuth]);

  const getAuthHeaders = useCallback(() => {
    const t = getToken();
    if (!t || t.startsWith(DEMO_TOKEN_PREFIX)) return {};
    return { Authorization: `Bearer ${t}` };
  }, []);

  const apiFetch = useCallback(async (url, options = {}) => {
    const headers = getAuthHeaders();
    const response = await fetch(url, {
      ...options,
      headers: {
        ...(options.headers || {}),
        ...headers,
      },
    });
    if (response.status === 401 && !getToken()?.startsWith(DEMO_TOKEN_PREFIX)) {
      logout();
      window.location.href = "/";
      throw new Error("Unauthorized");
    }
    return response;
  }, [getAuthHeaders, logout]);

  const value = useMemo(() => ({
    token,
    user,
    isAuthenticated: !!token && !!user,
    loading,
    login,
    register,
    logout,
    updateUser,
    getAuthHeaders,
    apiFetch,
  }), [token, user, loading, login, register, logout, updateUser, getAuthHeaders, apiFetch]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
