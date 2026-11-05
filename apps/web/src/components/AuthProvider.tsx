"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  authBackendLabel,
  loginAsDemo,
  loginWithPassword,
  logout as clearSession,
  resendConfirmationEmail,
  restoreSession,
  signUpWithPassword,
  type LoginResult,
  type ResendResult,
  type Session,
  type SignUpResult,
} from "@/lib/auth";

type AuthContextValue = {
  session: Session | null;
  ready: boolean;
  backend: string;
  login: (email: string, password: string) => Promise<LoginResult>;
  loginDemo: () => Promise<LoginResult>;
  signup: (email: string, password: string) => Promise<SignUpResult>;
  resendConfirmation: (email: string) => Promise<ResendResult>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void (async () => {
      const s = await restoreSession();
      setSession(s);
      setReady(true);
    })();
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const result = await loginWithPassword(email, password);
    if (result.ok) setSession(result.session);
    return result;
  }, []);

  const loginDemo = useCallback(async () => {
    const result = await loginAsDemo();
    if (result.ok) setSession(result.session);
    return result;
  }, []);

  const signup = useCallback(async (email: string, password: string) => {
    const result = await signUpWithPassword(email, password);
    if (result.ok && !result.needsEmailConfirmation) {
      setSession(result.session);
    }
    return result;
  }, []);

  const resendConfirmation = useCallback(async (email: string) => {
    return resendConfirmationEmail(email);
  }, []);

  const logout = useCallback(async () => {
    await clearSession();
    setSession(null);
  }, []);

  const value = useMemo(
    () => ({
      session,
      ready,
      backend: authBackendLabel(),
      login,
      loginDemo,
      signup,
      resendConfirmation,
      logout,
    }),
    [session, ready, login, loginDemo, signup, resendConfirmation, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
