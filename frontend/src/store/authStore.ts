import { create } from "zustand";

export interface AuthUser {
  id: string;
  organizationId: string | null;
  email: string;
  firstName: string;
  lastName: string;
  phone?: string | null;
  role: "admin" | "accountant" | "driver";
}

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  setAuth: (token: string, user: AuthUser) => void;
  clearAuth: () => void;
  logout: () => void;
}

const TOKEN_KEY = "fleet_auth_token";
const USER_KEY = "fleet_auth_user";

const persistedToken = typeof window !== "undefined" ? localStorage.getItem(TOKEN_KEY) : null;
const persistedUser =
  typeof window !== "undefined" && localStorage.getItem(USER_KEY)
    ? (JSON.parse(localStorage.getItem(USER_KEY) as string) as AuthUser)
    : null;

export const useAuthStore = create<AuthState>((set) => ({
  token: persistedToken,
  user: persistedUser,
  setAuth: (token, user) => {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    set({ token, user });
  },
  clearAuth: () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    set({ token: null, user: null });
  },
  logout: () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    set({ token: null, user: null });
    if (typeof window !== "undefined") {
      window.location.href = "login";
    }
  },
}));

