"use client"

import React, { createContext, useContext, useState, useEffect } from "react"

export type UserRole = "frontdesk" | "doctor" | "admin"

interface AuthContextType {
    role: UserRole
    setRole: (role: UserRole) => void
    user: { name: string; avatar?: string } | null
    isLoading: boolean
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [role, setRoleState] = useState<UserRole>("frontdesk")
    const [isLoading, setIsLoading] = useState(true)

    // Persist to localStorage
    useEffect(() => {
        const savedRole = localStorage.getItem("clinic_role") as UserRole
        if (savedRole && ["frontdesk", "doctor", "admin"].includes(savedRole)) {
            setRoleState(savedRole)
        }
        setIsLoading(false)
    }, [])

    const setRole = (newRole: UserRole) => {
        setRoleState(newRole)
        localStorage.setItem("clinic_role", newRole)
    }

    // Mock User Data based on role
    const user = {
        name: role === "doctor" ? "Dr. Ayesha" : role === "admin" ? "Admin User" : "Front Desk Staff",
    }

    return (
        <AuthContext.Provider value={{ role, setRole, user, isLoading }}>
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
