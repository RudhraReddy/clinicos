"use client"

import React, { createContext, useContext, useState, useEffect, useCallback } from "react"

export type UserRole = 'frontdesk' | 'doctor' | 'admin'

export interface AuthUser {
  user_id: string
  username: string
  role: 'staff' | 'doctor' | 'admin'
  location_label?: string | null
  location_id?: number | null
}

interface AuthContextType {
  user: AuthUser | null
  isLoading: boolean
  role: 'frontdesk' | 'doctor' | 'admin'  // computed from user.role; 'frontdesk' when logged out or staff
  /** @deprecated Will be removed once profile-switcher is updated to use server auth */
  setRole: (role: UserRole) => void
  logout: () => Promise<void>
  // Doctor-only: controls which staff member's data to view
  activeStaffFilter: string  // 'all' | <user_id>
  setActiveStaffFilter: (id: string) => void
  assignedStaff: AuthUser[]
  refreshAssignedStaff: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [activeStaffFilter, setActiveStaffFilter] = useState<string>('all')
  const [assignedStaff, setAssignedStaff] = useState<AuthUser[]>([])

  const fetchMe = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me', { credentials: 'include' })
      if (res.ok) {
        const data = await res.json()
        setUser({
          user_id: data.user_id,
          username: data.username,
          role: data.role,
          location_label: data.location_label,
          location_id: data.location_id ?? null,
        })
      } else {
        setUser(null)
      }
    } catch {
      setUser(null)
    } finally {
      setIsLoading(false)
    }
  }, [])

  const refreshAssignedStaff = useCallback(async () => {
    if (!user || user.role !== 'doctor') return
    try {
      const res = await fetch('/api/auth/users/me/assigned-staff', { credentials: 'include' })
      if (res.ok) {
        const data = await res.json()
        setAssignedStaff(data)
      }
    } catch {
      // ignore
    }
  }, [user])

  useEffect(() => {
    fetchMe()
  }, [fetchMe])

  useEffect(() => {
    if (user?.role === 'doctor') {
      refreshAssignedStaff()
    }
  }, [user, refreshAssignedStaff])

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
    setUser(null)
    setAssignedStaff([])
    window.location.href = '/login'
  }

  // Computed role for nav/page guards
  const role: 'frontdesk' | 'doctor' | 'admin' =
    user?.role === 'admin' ? 'admin' :
    user?.role === 'doctor' ? 'doctor' :
    'frontdesk'

  // Deprecated no-op — kept so profile-switcher.tsx compiles until it is updated
  const setRole = (_role: UserRole) => {
    // no-op: role is now derived from the authenticated session
  }

  return (
    <AuthContext.Provider value={{
      user,
      isLoading,
      role,
      setRole,
      logout,
      activeStaffFilter,
      setActiveStaffFilter,
      assignedStaff,
      refreshAssignedStaff,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider")
  }
  return context
}

export function useRole(): 'frontdesk' | 'doctor' | 'admin' {
  const { user } = useAuth()
  if (user?.role === 'admin') return 'admin'
  if (user?.role === 'doctor') return 'doctor'
  return 'frontdesk'
}
