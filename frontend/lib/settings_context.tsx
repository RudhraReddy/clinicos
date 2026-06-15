"use client"

import React, { createContext, useContext, useState, useEffect } from 'react'

export const ALL_INVENTORY_COLUMNS = [
    { id: 'item_name',       label: 'Item Name',   required: true  },
    { id: 'quantity',        label: 'Qty',          required: false },
    { id: 'price',           label: 'MRP',          required: false },
    { id: 'expiry_date',     label: 'Next Expiry',  required: false },
    { id: 'status',          label: 'Status',       required: false },
    { id: 'manufacturer',    label: 'MFG',          required: false },
    { id: 'vendor',          label: 'Vendor',       required: false },
    { id: 'pack_size',       label: 'Pack',         required: false },
    { id: 'category',        label: 'Category',     required: false },
    { id: 'total_value',     label: 'Total Value',  required: false },
    { id: 'id',              label: 'ID',           required: false },
    { id: 'hsn_code',        label: 'HSN',          required: false },
    { id: 'gst_rate',        label: 'GST %',        required: false },
    { id: 'min_stock_level', label: 'Min Stock',    required: false },
]

export const DEFAULT_INVENTORY_COLUMNS = [
    'item_name', 'manufacturer', 'vendor', 'pack_size',
    'quantity', 'price', 'expiry_date', 'status',
]

interface SettingsContextType {
    clinicName: string
    clinicAddress: string
    clinicPhone: string
    referenceDoctor: string
    appFontSize: number
    expiryReminderMonths: number
    defaultMinStock: number
    defaultInventoryColumns: string[]
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
    const [defaultMinStock, setDefaultMinStock] = useState(10)
    const [defaultInventoryColumns, setDefaultInventoryColumns] = useState<string[]>(DEFAULT_INVENTORY_COLUMNS)
    const [previewFontSize, setPreviewFontSize] = useState<number | null>(null)

    const currentFontSize = previewFontSize !== null ? previewFontSize : appFontSize

    useEffect(() => {
        const storedName       = localStorage.getItem("clinic_name")
        const storedAddress    = localStorage.getItem("clinic_address")
        const storedPhone      = localStorage.getItem("clinic_phone")
        const storedRefDoc     = localStorage.getItem("clinic_ref_doc")
        const storedFontSize   = localStorage.getItem("clinic_font_size")
        const storedExpiry     = localStorage.getItem("expiry_reminder_months")
        const storedDefaultMinStock = localStorage.getItem("inventory_default_min_stock")
        const storedCols       = localStorage.getItem("inventory_default_columns")

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
        if (storedDefaultMinStock) {
            const parsed = parseInt(storedDefaultMinStock, 10)
            if (!isNaN(parsed) && parsed >= 1) setDefaultMinStock(parsed)
        }
        if (storedCols) {
            try {
                const parsed = JSON.parse(storedCols)
                if (Array.isArray(parsed) && parsed.length > 0) setDefaultInventoryColumns(parsed)
            } catch { /* ignore corrupt value */ }
        }
    }, [])

    useEffect(() => {
        document.documentElement.style.fontSize = `${currentFontSize}px`
    }, [currentFontSize])

    const setSettings = (settings: Partial<Omit<SettingsContextType, 'setSettings' | 'setPreviewFontSize'>>) => {
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
        if (settings.defaultMinStock !== undefined) {
            setDefaultMinStock(settings.defaultMinStock)
            localStorage.setItem("inventory_default_min_stock", settings.defaultMinStock.toString())
        }
        if (settings.defaultInventoryColumns !== undefined) {
            const cols = ['item_name', ...settings.defaultInventoryColumns.filter(c => c !== 'item_name')]
            setDefaultInventoryColumns(cols)
            localStorage.setItem("inventory_default_columns", JSON.stringify(cols))
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
            defaultMinStock,
            defaultInventoryColumns,
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
