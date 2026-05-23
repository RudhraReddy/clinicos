"use client"

import React, { createContext, useContext, useState, useEffect } from 'react'

interface SettingsContextType {
    clinicName: string
    clinicAddress: string
    clinicPhone: string
    referenceDoctor: string
    appFontSize: number
    expiryReminderMonths: number
    setSettings: (settings: Partial<Omit<SettingsContextType, 'setSettings' | 'setPreviewFontSize'>>) => void
    setPreviewFontSize: (size: number | null) => void
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined)

export function SettingsProvider({ children }: { children: React.ReactNode }) {
    const [clinicName, setClinicName] = useState("Teja Reddy Clinic")
    const [clinicAddress, setClinicAddress] = useState("#3145 Here and there, TS 500081")
    const [clinicPhone, setClinicPhone] = useState("+91 98765 43210")
    const [referenceDoctor, setReferenceDoctor] = useState("")
    const [appFontSize, setAppFontSize] = useState(16)
    const [expiryReminderMonths, setExpiryReminderMonths] = useState(6)
    const [previewFontSize, setPreviewFontSize] = useState<number | null>(null)

    const currentFontSize = previewFontSize !== null ? previewFontSize : appFontSize

    useEffect(() => {
        const storedName       = localStorage.getItem("clinic_name")
        const storedAddress    = localStorage.getItem("clinic_address")
        const storedPhone      = localStorage.getItem("clinic_phone")
        const storedRefDoc     = localStorage.getItem("clinic_ref_doc")
        const storedFontSize   = localStorage.getItem("clinic_font_size")
        const storedExpiry     = localStorage.getItem("expiry_reminder_months")

        if (storedName)    setClinicName(storedName)
        if (storedAddress !== null) setClinicAddress(storedAddress)
        if (storedPhone !== null)   setClinicPhone(storedPhone)
        if (storedRefDoc !== null)  setReferenceDoctor(storedRefDoc)
        if (storedFontSize) {
            const parsed = parseInt(storedFontSize, 10)
            if (!isNaN(parsed) && parsed >= 12 && parsed <= 24) setAppFontSize(parsed)
        }
        if (storedExpiry) {
            const parsed = parseInt(storedExpiry, 10)
            if (!isNaN(parsed) && parsed >= 1 && parsed <= 24) setExpiryReminderMonths(parsed)
        }
    }, [])

    useEffect(() => {
        document.documentElement.style.fontSize = `${currentFontSize}px`
    }, [currentFontSize])

    const setSettings = (settings: Partial<Omit<SettingsContextType, 'setSettings'>>) => {
        if (settings.clinicName !== undefined) {
            setClinicName(settings.clinicName)
            localStorage.setItem("clinic_name", settings.clinicName)
        }
        if (settings.clinicAddress !== undefined) {
            setClinicAddress(settings.clinicAddress)
            localStorage.setItem("clinic_address", settings.clinicAddress)
        }
        if (settings.clinicPhone !== undefined) {
            setClinicPhone(settings.clinicPhone)
            localStorage.setItem("clinic_phone", settings.clinicPhone)
        }
        if (settings.referenceDoctor !== undefined) {
            setReferenceDoctor(settings.referenceDoctor)
            localStorage.setItem("clinic_ref_doc", settings.referenceDoctor)
        }
        if (settings.appFontSize !== undefined) {
            setAppFontSize(settings.appFontSize)
            localStorage.setItem("clinic_font_size", settings.appFontSize.toString())
        }
        if (settings.expiryReminderMonths !== undefined) {
            setExpiryReminderMonths(settings.expiryReminderMonths)
            localStorage.setItem("expiry_reminder_months", settings.expiryReminderMonths.toString())
        }
    }

    return (
        <SettingsContext.Provider value={{
            clinicName,
            clinicAddress,
            clinicPhone,
            referenceDoctor,
            appFontSize: currentFontSize,
            expiryReminderMonths,
            setSettings,
            setPreviewFontSize
        }}>
            {children}
        </SettingsContext.Provider>
    )
}

export function useSettings() {
    const context = useContext(SettingsContext)
    if (context === undefined) {
        throw new Error("useSettings must be used within a SettingsProvider")
    }
    return context
}
