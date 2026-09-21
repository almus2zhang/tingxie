import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem('tingxie_auth_token') || '');
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Auth Modal State
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalMode, setAuthModalMode] = useState('login'); // 'login' | 'register'

  // Audit Modal State
  const [auditModalOpen, setAuditModalOpen] = useState(false);
  const [auditModalTab, setAuditModalTab] = useState('pending'); // 'pending' | 'my'

  // Change Request Submit Modal State
  const [submitAuditModalOpen, setSubmitAuditModalOpen] = useState(false);
  const [submitAuditData, setSubmitAuditData] = useState(null); // { type, targetId, targetName, payload, title }

  const refreshUser = useCallback(async () => {
    const curToken = localStorage.getItem('tingxie_auth_token');
    if (!curToken) {
      setUser(null);
      setLoading(false);
      return;
    }

    try {
      const data = await api.getMe();
      if (data && data.user) {
        setUser(data.user);
      } else {
        setUser(null);
        localStorage.removeItem('tingxie_auth_token');
        setToken('');
      }
    } catch (err) {
      console.error('Failed to load current user:', err);
      setUser(null);
      localStorage.removeItem('tingxie_auth_token');
      setToken('');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  const login = async (email, password) => {
    const data = await api.login(email, password);
    if (data.token) {
      localStorage.setItem('tingxie_auth_token', data.token);
      setToken(data.token);
      setUser(data.user);
      setAuthModalOpen(false);
    }
    return data;
  };

  const register = async (email, code, username, password) => {
    const data = await api.register(email, code, username, password);
    if (data.token) {
      localStorage.setItem('tingxie_auth_token', data.token);
      setToken(data.token);
      setUser(data.user);
      setAuthModalOpen(false);
    }
    return data;
  };

  const logout = () => {
    localStorage.removeItem('tingxie_auth_token');
    setToken('');
    setUser(null);
  };

  const openAuthModal = (mode = 'login') => {
    setAuthModalMode(mode);
    setAuthModalOpen(true);
  };

  const closeAuthModal = () => {
    setAuthModalOpen(false);
  };

  const openAuditModal = (tab = null) => {
    if (tab) {
      setAuditModalTab(tab);
    } else {
      setAuditModalTab(user?.role === 'admin' ? 'pending' : 'my');
    }
    setAuditModalOpen(true);
  };

  const closeAuditModal = () => {
    setAuditModalOpen(false);
  };

  const openSubmitAudit = ({ type, targetId, targetName, payload, title }) => {
    setSubmitAuditData({ type, targetId, targetName, payload, title });
    setSubmitAuditModalOpen(true);
  };

  const closeSubmitAudit = () => {
    setSubmitAuditModalOpen(false);
    setSubmitAuditData(null);
  };

  const value = {
    user,
    token,
    loading,
    isAuthenticated: !!user,
    isAdmin: user?.role === 'admin',
    login,
    register,
    logout,
    refreshUser,
    authModalOpen,
    authModalMode,
    openAuthModal,
    closeAuthModal,
    auditModalOpen,
    auditModalTab,
    setAuditModalTab,
    openAuditModal,
    closeAuditModal,
    submitAuditModalOpen,
    submitAuditData,
    openSubmitAudit,
    closeSubmitAudit,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
