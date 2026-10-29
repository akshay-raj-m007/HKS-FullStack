import {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, refreshSession, setAccessToken, Session } from "../../api/client";
import type { User } from "../../types";
interface Auth {
  user: User | null;
  loading: boolean;
  signIn: (session: Session) => void;
  logout: () => Promise<void>;
}
const Context = createContext<Auth | null>(null);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null),
    [loading, setLoading] = useState(true);
  const queryClient = useQueryClient();
  useEffect(() => {
    let active = true;
    void refreshSession()
      .then((s) => {
        if (active) setUser(s.user);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });
    const expired = () => {
      setUser(null);
      queryClient.clear();
    };
    window.addEventListener("session-expired", expired);
    return () => {
      active = false;
      window.removeEventListener("session-expired", expired);
    };
  }, [queryClient]);
  const signIn = (session: Session) => {
    setAccessToken(session.accessToken, session.user.id);
    queryClient.clear();
    setUser(session.user);
  };
  const logout = async () => {
    await api("/auth/logout", { method: "POST", body: "{}" });
    setAccessToken(null);
    setUser(null);
    queryClient.clear();
  };
  return (
    <Context.Provider value={{ user, loading, signIn, logout }}>
      {children}
    </Context.Provider>
  );
}
export function useAuth() {
  const value = useContext(Context);
  if (!value) throw new Error("AuthProvider is required");
  return value;
}
