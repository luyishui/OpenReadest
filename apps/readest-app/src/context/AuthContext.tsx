'use client';

import React, { createContext, useState, useContext, ReactNode, useEffect } from 'react';

export interface LocalUser {
  id: string;
  email?: string;
  user_metadata?: Record<string, string | undefined>;
}

interface AuthContextType {
  token: string | null;
  user: LocalUser | null;
  login: (token: string, user: LocalUser) => void;
  logout: () => void;
  refresh: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<LocalUser | null>(null);

  useEffect(() => {
    localStorage.removeItem('token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('user');
    setToken(null);
    setUser(null);
  }, []);

  const login = (newToken: string, newUser: LocalUser) => {
    void newToken;
    void newUser;
    setToken(null);
    setUser(null);
    localStorage.removeItem('token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('user');
  };

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('user');
    setToken(null);
    setUser(null);
  };

  const refresh = () => {};

  return (
    <AuthContext.Provider value={{ token, user, login, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};
