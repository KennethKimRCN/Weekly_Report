import { create } from 'zustand'
import type { User, LookupData, Notification } from '../types'

interface AuthState {
  token: string | null
  user: User | null
  setAuth: (token: string, user: User) => void
  clearAuth: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  token: localStorage.getItem('token'),
  user: null,
  setAuth: (token, user) => {
    localStorage.setItem('token', token)
    set({ token, user })
  },
  clearAuth: () => {
    localStorage.removeItem('token')
    set({ token: null, user: null })
  },
}))

interface AppState {
  lookups: LookupData | null
  notifications: Notification[]
  unreadCount: number
  sidebarOpen: boolean
  setLookups: (l: LookupData) => void
  setNotifications: (n: Notification[]) => void
  toggleSidebar: () => void
}

export const useAppStore = create<AppState>((set) => ({
  lookups: null,
  notifications: [],
  unreadCount: 0,
  sidebarOpen: true,
  setLookups: (lookups) => set({ lookups }),
  setNotifications: (notifications) =>
    set({ notifications, unreadCount: notifications.filter((n) => !n.is_read).length }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
}))
