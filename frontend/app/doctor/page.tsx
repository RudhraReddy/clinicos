"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Plus, Search, Calendar as CalendarIcon, Clock, ChevronRight, ChevronLeft, Trash2, X, Stethoscope, FileText, ChevronDown, MoreHorizontal, ArrowUpDown, Filter, Download, Printer, Edit, ExternalLink, AlertCircle, CheckCircle2, XCircle, Loader2, Upload, Paperclip, Eye, Save, RotateCcw, ZoomIn, ZoomOut, Edit2, Columns, LayoutGrid, List as ListIcon, Maximize2, Minimize2, Calendar, Image as ImageIcon, User, Smartphone, Menu, Package, CreditCard, Users } from 'lucide-react'
import { ImagePreviewDialog } from "@/components/ImagePreviewDialog"
import { QRCodeUpload } from "@/components/QRCodeUpload"
import { StaffAssignmentDialog } from "@/components/StaffAssignmentDialog"
import { getTodayIST, orderTodayVisits, cn } from "@/lib/utils"
import { useState, useEffect, useMemo } from "react"
import { api, type Visit, API_BASE_URL } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import Link from "next/link"
import { useMenu } from "@/components/layout/AppShell"

import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { toast } from "sonner"

export default function DoctorDashboard() {
    const { openMenu } = useMenu()
    const [visits, setVisits] = useState<Visit[]>([])
    const [loading, setLoading] = useState(true)
    const [selectedVisitId, setSelectedVisitId] = useState<string | null>(null)
    const [mobileDetailOpen, setMobileDetailOpen] = useState(false)

    // Active Console State
    // const [rxHistory, setRxHistory] = useState<any[]>([]) // Removed
    const [refreshTrigger, setRefreshTrigger] = useState(0)



    const fetchVisits = async () => {
        try {
            setLoading(true)
            const allVisits = await api.getVisits()
            // Filter for standard active visits
            setVisits(allVisits.filter(v => v.status !== 'deleted'))
        } catch (err) {
            console.error("Failed to fetch visits:", err)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        fetchVisits()
    }, [])

    // Calculate stats
    const today = getTodayIST()
    const todayVisits = visits.filter(v => v.visit_date === today)

    // Not-done visits ordered by time; done visits sink below, most recent first
    const orderedTodayVisits = orderTodayVisits(todayVisits)

    const selectedVisit = visits.find(v => v.visit_id === selectedVisitId)

    // History State
    const [patientHistory, setPatientHistory] = useState<Visit[]>([])
    const [patientImages, setPatientImages] = useState<any[]>([])
    const [showTrash, setShowTrash] = useState(false)
    const [trashImages, setTrashImages] = useState<any[]>([])

    // Load Notes and History when selection changes
    useEffect(() => {
        if (selectedVisit && selectedVisit.patient_id) {

            // Fetch Visit History (for Timeline)
            api.getVisits(selectedVisit.patient_id)
                .then(data => {
                    // Filter out current visit and sort desc (already sorted by API mostly)
                    setPatientHistory(data.filter(v => v.visit_id !== selectedVisit.visit_id))
                })
                .catch(err => console.error("Failed to load visit history", err))

            // Fetch Images
            api.getPatientImages(selectedVisit.patient_id)
                .then(setPatientImages)
                .catch(err => console.error("Failed to load images", err))

        } else {

            setPatientHistory([])
            setPatientImages([])
        }
    }, [selectedVisitId, selectedVisit?.visit_id, selectedVisit?.patient_id, refreshTrigger])

    // Image Dialog State
    const [uploadFiles, setUploadFiles] = useState<{ file: File, preview: string }[]>([])
    const [uploadNotes, setUploadNotes] = useState("")
    const [uploading, setUploading] = useState(false)

    // Lightbox State: holds the current image AND the list of images to navigate through
    const [lightboxState, setLightboxState] = useState<{ image: any, context: any[] } | null>(null)

    // Handle File Selection -> Show Preview Dialog
    const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files
        if (!files || files.length === 0) return

        const fileArray = Array.from(files)
        const readAsDataURL = (file: File) => new Promise<string>((resolve) => {
            const reader = new FileReader()
            reader.onloadend = () => resolve(reader.result as string)
            reader.readAsDataURL(file)
        })
        const previews = await Promise.all(fileArray.map(readAsDataURL))
        setUploadFiles(prev => [...prev, ...fileArray.map((file, i) => ({ file, preview: previews[i] }))])
    }

    const removeUploadFile = (index: number) => {
        setUploadFiles(prev => prev.filter((_, i) => i !== index))
    }

    const confirmUpload = async () => {
        if (uploadFiles.length === 0 || !selectedVisitId || !selectedVisit) return

        setUploading(true)
        let successCount = 0
        let failCount = 0
        for (const { file } of uploadFiles) {
            try {
                await api.uploadPatientImage(selectedVisit.patient_id, file, selectedVisitId, uploadNotes)
                successCount++
            } catch (error) {
                console.error(error)
                failCount++
            }
        }
        setUploading(false)

        if (successCount > 0) {
            const imgs = await api.getPatientImages(selectedVisit.patient_id)
            setPatientImages(imgs)
        }

        if (failCount === 0) {
            toast.success(successCount === 1 ? "Image uploaded" : `${successCount} images uploaded`)
        } else {
            toast.error(`${successCount} uploaded, ${failCount} failed`)
        }

        clearUpload()
    }

    const clearUpload = () => {
        setUploadFiles([])
        setUploadNotes("")
        // Reset input value if possible, but difficult with hidden input.
        // We can just rely on the key prop or replace input.
        const input = document.getElementById('image-upload-input') as HTMLInputElement
        if (input) input.value = ''
    }



    // QR Upload State
    const [showQR, setShowQR] = useState(false)

    // Image Gallery Filter State
    const [selectedDateFilter, setSelectedDateFilter] = useState<string | null>(null)

    // Reset filter and trash view when changing patient
    useEffect(() => {
        setSelectedDateFilter(null)
        setShowTrash(false)
        setTrashImages([])
    }, [selectedVisit?.patient_id])

    // Load trash images when trash view is toggled on
    useEffect(() => {
        if (showTrash && selectedVisit?.patient_id) {
            api.getTrashImages(selectedVisit.patient_id)
                .then(setTrashImages)
                .catch(err => console.error("Failed to load trash images", err))
        }
    }, [showTrash, selectedVisit?.patient_id])

    const handleDeleteImage = async (imageId: number) => {
        try {
            await api.deletePatientImage(imageId)
            setPatientImages(prev => prev.filter(img => img.id !== imageId))
            toast.success("Moved to trash")
        } catch (err) {
            console.error(err)
            toast.error("Failed to delete image")
        }
    }

    const handleRestoreImage = async (img: any) => {
        try {
            await api.restorePatientImage(img.id)
            setTrashImages(prev => prev.filter(t => t.id !== img.id))
            setPatientImages(prev => [img, ...prev])
            toast.success("Image restored")
        } catch (err) {
            console.error(err)
            toast.error("Failed to restore image")
        }
    }

    const handlePermanentDelete = async (imageId: number) => {
        try {
            await api.permanentDeleteImage(imageId)
            setTrashImages(prev => prev.filter(t => t.id !== imageId))
            toast.success("Image permanently deleted")
        } catch (err) {
            console.error(err)
            toast.error("Failed to permanently delete image")
        }
    }

    const handleDeleteVisit = async (visitId: string) => {
        try {
            await api.deleteVisit(visitId)
            if (selectedVisitId === visitId) {
                setSelectedVisitId(null)
                setMobileDetailOpen(false)
            }
            setVisits(prev => prev.filter(v => v.visit_id !== visitId))
            toast.success("Visit deleted")
        } catch (err) {
            console.error(err)
            toast.error("Failed to delete visit")
        }
    }

    const getDaysAgo = (isoString: string): string => {
        const deleted = new Date(isoString)
        const now = new Date()
        const diffMs = now.getTime() - deleted.getTime()
        const days = Math.floor(diffMs / (1000 * 60 * 60 * 24))
        if (days === 0) return "Today"
        if (days === 1) return "1 day ago"
        return `${days} days ago`
    }

    // Filter images logic hoisted for navigation context
    const filteredImages = useMemo(() => {
        // 1. Get all unique dates from Visits and Images
        const allDates = new Set<string>();
        [selectedVisit, ...patientHistory].filter((v): v is Visit => !!v).forEach(v => {
            if (v.visit_date) allDates.add(v.visit_date);
        });
        patientImages.forEach(img => {
            if (img.timestamp) {
                try {
                    const dateStr = new Date(img.timestamp).toISOString().split('T')[0];
                    allDates.add(dateStr);
                } catch (e) { }
            }
        });

        // 2. Sort dates descending
        let sortedDates = Array.from(allDates).sort().reverse();

        // 3. FILTER dates based on selection
        if (selectedDateFilter) {
            sortedDates = sortedDates.filter(d => d === selectedDateFilter);
        }

        // 4. Flatten images in order of dates
        const orderedImages: any[] = [];
        sortedDates.forEach(date => {
            const imagesForDate = patientImages.filter(img => {
                if (!img.timestamp) return false;
                try { return new Date(img.timestamp).toISOString().split('T')[0] === date; } catch (e) { return false; }
            });
            // We want images sorted by ID or timestamp within the date? Usually descending or ascending.
            // Let's assume as they come from API or sort by ID desc (newest first)
            imagesForDate.sort((a, b) => b.id - a.id);
            orderedImages.push(...imagesForDate);
        });

        return orderedImages;
    }, [patientImages, selectedVisit, patientHistory, selectedDateFilter]);

    const allTimelineDates = useMemo(() => {
        const s = new Set<string>()
        ;[selectedVisit, ...patientHistory].filter((v): v is Visit => !!v).forEach(v => {
            if (v.visit_date) s.add(v.visit_date)
        })
        patientImages.forEach(img => {
            if (img.timestamp) {
                try { s.add(new Date(img.timestamp).toISOString().split('T')[0]) } catch {}
            }
        })
        return Array.from(s).sort().reverse()
    }, [patientImages, selectedVisit, patientHistory])

    // Navigation Handlers
    const handleNextImage = () => {
        if (!lightboxState) return
        const { image, context } = lightboxState
        const currentIndex = context.findIndex(img => img.id === image.id)
        if (currentIndex !== -1 && currentIndex < context.length - 1) {
            setLightboxState({ image: context[currentIndex + 1], context })
        }
    }

    const handlePrevImage = () => {
        if (!lightboxState) return
        const { image, context } = lightboxState
        const currentIndex = context.findIndex(img => img.id === image.id)
        if (currentIndex !== -1 && currentIndex > 0) {
            setLightboxState({ image: context[currentIndex - 1], context })
        }
    }

    return (
        <div>
            <input
                id="image-upload-input"
                type="file"
                accept="image/*"
                multiple
                style={{ display: 'none' }}
                onChange={handleImageUpload}
            />
            {/* ── MOBILE LAYOUT (hidden md+) ── */}
            <div className="md:hidden flex flex-col">

                {/* Header */}
                <div className="flex items-center gap-3 px-4 py-3 bg-card border-b">
                    <button
                        type="button"
                        onClick={openMenu}
                        className="shrink-0 rounded-md p-1 text-foreground hover:bg-accent transition-colors"
                    >
                        <Menu className="h-6 w-6" />
                        <span className="sr-only">Toggle Menu</span>
                    </button>
                    <h1 className="text-xl font-bold tracking-tight truncate">
                        {selectedVisit ? selectedVisit.patient_name : "Dashboard"}
                    </h1>
                </div>

                {/* Stat strip */}
                <div className="flex border-b bg-card">
                    <div className="flex-1 text-center py-2.5 border-r">
                        <p className="text-2xl font-bold">{orderedTodayVisits.length}</p>
                        <p className="text-[10px] uppercase text-muted-foreground tracking-wide">Today</p>
                    </div>
                    <div className="flex-1 text-center py-2.5 border-r">
                        <p className="text-2xl font-bold">{orderedTodayVisits.filter(v => v.status === 'done').length}</p>
                        <p className="text-[10px] uppercase text-muted-foreground tracking-wide">Done</p>
                    </div>
                    <div className="flex-1 text-center py-2.5">
                        <p className="text-2xl font-bold">{orderedTodayVisits.filter(v => v.status !== 'done' && v.status !== 'cancelled').length}</p>
                        <p className="text-[10px] uppercase text-muted-foreground tracking-wide">Waiting</p>
                    </div>
                </div>

                {mobileDetailOpen && selectedVisit ? (
                    /* ── MOBILE DETAIL PANEL ── */
                    <div className="flex flex-col">
                        {/* Back + name header */}
                        <div className="flex items-center gap-3 px-4 py-2.5 bg-primary/10 border-b border-primary/20">
                            <button
                                type="button"
                                className="text-sm font-semibold text-primary"
                                onClick={() => setMobileDetailOpen(false)}
                            >
                                ← Back
                            </button>
                            <span className="flex-1 font-bold text-sm truncate">{selectedVisit.patient_name}</span>
                            <Badge variant={selectedVisit.status === 'done' ? 'secondary' : 'outline'} className="text-[10px] uppercase">
                                {selectedVisit.status}
                            </Badge>
                        </div>

                        {/* Meta chips */}
                        <div className="flex flex-wrap gap-1.5 px-4 py-2 bg-card border-b">
                            {selectedVisit.dob && (
                                <span className="text-xs bg-muted text-muted-foreground px-2.5 py-0.5 rounded-full">
                                    {Math.floor((Date.now() - new Date(selectedVisit.dob).getTime()) / (1000 * 60 * 60 * 24 * 365.25))} yrs
                                </span>
                            )}
                            {selectedVisit.visit_time && (
                                <span className="text-xs bg-muted text-muted-foreground px-2.5 py-0.5 rounded-full">
                                    {selectedVisit.visit_time.substring(0, 5)}
                                </span>
                            )}
                            {selectedVisit.reason && (
                                <span className="text-xs bg-muted text-muted-foreground px-2.5 py-0.5 rounded-full">
                                    {selectedVisit.reason}
                                </span>
                            )}
                        </div>

                        {/* Patient Pictures card header */}
                        <div className="flex items-center justify-between px-4 py-2 bg-card border-b">
                            <span className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                                <ImageIcon className="h-3.5 w-3.5" /> Patient Pictures
                            </span>
                            <div className="flex items-center gap-1">
                                {!showTrash && (
                                    <>
                                        <button
                                            type="button"
                                            onClick={() => document.getElementById('image-upload-input')?.click()}
                                            className="text-[10px] font-semibold px-2 py-1 rounded bg-primary/10 hover:bg-primary/20 text-primary transition-colors"
                                        >
                                            + Add
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setShowQR(true)}
                                            className="text-[10px] font-semibold px-2 py-1 rounded bg-muted hover:bg-muted/80 text-muted-foreground transition-colors"
                                        >
                                            QR
                                        </button>
                                    </>
                                )}
                                <button
                                    type="button"
                                    onClick={() => setShowTrash(prev => !prev)}
                                    className={`text-[10px] font-semibold px-2 py-1 rounded transition-colors ${showTrash ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground'}`}
                                >
                                    {showTrash ? 'Back' : 'Trash'}
                                </button>
                            </div>
                        </div>

                        {/* Timeline chips — horizontal scroll */}
                        <div className="flex gap-1.5 px-4 py-2 overflow-x-auto border-b bg-muted/30">
                            <button
                                type="button"
                                onClick={() => setSelectedDateFilter(null)}
                                className={`text-xs px-3 py-1 rounded-full border flex-shrink-0 transition-colors ${selectedDateFilter === null ? 'bg-primary/10 border-primary/20 text-primary font-semibold' : 'bg-card border-border text-muted-foreground'}`}
                            >
                                All History
                            </button>
                            {allTimelineDates.map(date => {
                                const hasImages = patientImages.some(img => {
                                    try { return new Date(img.timestamp).toISOString().split('T')[0] === date } catch { return false }
                                })
                                return (
                                    <button
                                        key={date}
                                        type="button"
                                        onClick={() => setSelectedDateFilter(date)}
                                        className={`text-xs px-3 py-1 rounded-full border flex-shrink-0 transition-colors ${selectedDateFilter === date ? 'bg-primary/10 border-primary/20 text-primary font-semibold' : 'bg-card border-border text-muted-foreground'}`}
                                    >
                                        {new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' })}
                                        {hasImages && <span className="ml-1 opacity-50">·</span>}
                                    </button>
                                )
                            })}
                        </div>

                        {/* 2-col image grid */}
                        <div className="grid grid-cols-2 gap-2 p-3 bg-card">
                            {filteredImages.length === 0 ? (
                                <div className="col-span-2 py-10 flex flex-col items-center text-muted-foreground opacity-50">
                                    <ImageIcon className="h-8 w-8 mb-2" />
                                    <span className="text-sm">No images</span>
                                </div>
                            ) : (
                                filteredImages.map(img => (
                                    <div
                                        key={img.id}
                                        className="aspect-square rounded-md overflow-hidden border bg-muted cursor-pointer relative group"
                                        onClick={() => setLightboxState({ image: img, context: filteredImages })}
                                    >
                                        <img
                                            src={`${API_BASE_URL}/api/patients/images/${img.id}/file`}
                                            alt={img.notes || ''}
                                            className="w-full h-full object-cover"
                                            loading="lazy"
                                        />
                                        {img.notes && (
                                            <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-[9px] px-1.5 py-1 truncate">
                                                {img.notes}
                                            </div>
                                        )}
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                ) : (
                    /* ── MOBILE QUEUE LIST ── */
                    <div>
                        <p className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground bg-muted/30 border-b">
                            {today}
                        </p>
                        {loading ? (
                            <div className="flex justify-center py-12">
                                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                            </div>
                        ) : orderedTodayVisits.length === 0 ? (
                            <p className="text-center py-12 text-sm text-muted-foreground">No appointments today.</p>
                        ) : (
                            orderedTodayVisits.map(visit => (
                                <div
                                    key={visit.visit_id}
                                    className={cn(
                                        "flex items-center gap-2 px-4 py-3 border-b border-l-4 cursor-pointer transition-colors",
                                        visit.status === 'done'
                                            ? 'opacity-60 border-l-green-500'
                                            : selectedVisitId === visit.visit_id
                                                ? 'bg-primary/10 border-l-primary'
                                                : 'border-l-transparent hover:bg-muted/40'
                                    )}
                                    onClick={() => { setSelectedVisitId(visit.visit_id); setMobileDetailOpen(true) }}
                                >
                                    <span className="font-bold text-sm min-w-[38px] flex-shrink-0">{visit.visit_time?.substring(0, 5) || 'ASAP'}</span>
                                    <span className="text-xs font-medium tabular-nums text-muted-foreground min-w-[3.5rem] flex-shrink-0">
                                        {visit.visiting_fee ? `₹${visit.visiting_fee}` : '—'}
                                    </span>
                                    <p className="flex-1 min-w-0 font-semibold text-sm truncate">{visit.patient_name}</p>
                                    {visit.billed_amount != null && (
                                        <span className="text-xs font-semibold tabular-nums text-green-700 dark:text-green-400 flex-shrink-0">
                                            ₹{visit.billed_amount}
                                        </span>
                                    )}
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 flex-shrink-0"
                                        onClick={(e) => { e.stopPropagation(); handleDeleteVisit(visit.visit_id) }}
                                    >
                                        <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                </div>
                            ))
                        )}
                    </div>
                )}
            </div>

            {/* ── DESKTOP LAYOUT (hidden on mobile) ── */}
            <div className="hidden md:flex md:flex-col h-[calc(100vh-100px)] bg-background overflow-hidden relative">
            {/* Header */}
            <div className="flex items-center justify-between shrink-0 px-6 pt-6 pb-4">
                <div className="flex items-center gap-3">
                    <button
                        type="button"
                        onClick={openMenu}
                        className="shrink-0 rounded-md p-1 text-foreground hover:bg-accent transition-colors"
                    >
                        <Menu className="h-6 w-6" />
                        <span className="sr-only">Toggle Menu</span>
                    </button>
                    <h1 className="text-3xl font-bold tracking-tight">
                        {selectedVisit ? selectedVisit.patient_name : "Dashboard"}
                    </h1>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" asChild>
                        <Link href="/inventory">
                            <Package className="mr-1.5 h-3.5 w-3.5" />
                            Inventory
                        </Link>
                    </Button>
                    <Button variant="outline" size="sm" asChild>
                        <Link href="/billing">
                            <CreditCard className="mr-1.5 h-3.5 w-3.5" />
                            Billing
                        </Link>
                    </Button>
                    <Button variant="outline" size="sm" asChild>
                        <Link href="/patients">
                            <Users className="mr-1.5 h-3.5 w-3.5" />
                            Patients
                        </Link>
                    </Button>
                </div>
            </div>

            <div className="flex-1 flex min-h-0">
            {/* MAIN CONTENT AREA (Left, ~75%) */}
            <div className="flex-1 flex flex-col min-w-0 p-6 pt-0 gap-3 overflow-hidden">
                {selectedVisit ? (
                    <>
                        {/* Content Grid */}
                        <div className="flex-1 flex flex-col gap-6 min-h-0">

                            {/* Pictures & Timeline */}
                            <div className="flex flex-col gap-6 flex-1 min-h-0">
                                <Card className="flex-1 flex flex-col min-h-0">
                                    <CardHeader className="pb-2 py-3 px-4 border-b bg-muted/10 flex flex-row items-center justify-between">
                                        <CardTitle className="text-sm font-medium opacity-80 flex items-center gap-2">
                                            <ImageIcon className="h-4 w-4" /> Patient Pictures
                                        </CardTitle>
                                        <div className="flex gap-2">
                                            {!showTrash && (
                                                <>
                                                    <button
                                                        type="button"
                                                        onClick={() => document.getElementById('image-upload-input')?.click()}
                                                        className="cursor-pointer bg-primary/10 hover:bg-primary/20 text-primary text-xs font-medium px-2 py-1 rounded-md flex items-center gap-1 transition-colors"
                                                    >
                                                        <Plus className="h-3 w-3" /> Add Image
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => setShowQR(true)}
                                                        className="cursor-pointer bg-secondary/50 hover:bg-secondary text-secondary-foreground text-xs font-medium px-2 py-1 rounded-md flex items-center gap-1 transition-colors"
                                                    >
                                                        <Smartphone className="h-3 w-3" /> Upload via QR
                                                    </button>
                                                </>
                                            )}
                                            <button
                                                type="button"
                                                onClick={() => setShowTrash(prev => !prev)}
                                                className={`cursor-pointer text-xs font-medium px-2 py-1 rounded-md flex items-center gap-1 transition-colors ${showTrash ? 'bg-destructive/10 text-destructive hover:bg-destructive/20' : 'bg-muted/50 hover:bg-muted text-muted-foreground'}`}
                                            >
                                                <Trash2 className="h-3 w-3" /> {showTrash ? 'Back' : 'Trash'}
                                            </button>
                                        </div>
                                    </CardHeader>
                                    <div className="flex-1 flex overflow-hidden">
                                        {/* Timeline Sidebar */}
                                        <div className="w-1/3 border-r bg-muted/50 overflow-y-auto p-2 space-y-2">
                                            <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-2 px-2 sticky top-0 bg-muted/50 backdrop-blur-sm py-1 z-10">Visit Timeline</div>

                                            {/* Show All Option */}
                                            <div
                                                className={`p-2 rounded-md cursor-pointer transition-colors border text-sm flex items-center justify-between ${selectedDateFilter === null ? 'bg-primary/10 border-primary/20 text-primary font-medium' : 'hover:bg-background/80 border-transparent hover:border-border'}`}
                                                onClick={() => setSelectedDateFilter(null)}
                                            >
                                                <span>Show All History</span>
                                                <ListIcon className="h-4 w-4 opacity-50" />
                                            </div>

                                            {/* Computed Dates List */}
                                            {(() => {
                                                const allDates = new Set<string>();
                                                // From visits
                                                [selectedVisit, ...patientHistory].filter(Boolean).forEach(v => {
                                                    if (v.visit_date) allDates.add(v.visit_date);
                                                });
                                                // From images
                                                patientImages.forEach(img => {
                                                    if (img.timestamp) {
                                                        try {
                                                            const dateStr = new Date(img.timestamp).toISOString().split('T')[0];
                                                            allDates.add(dateStr);
                                                        } catch (e) { }
                                                    }
                                                });
                                                const sortedDates = Array.from(allDates).sort().reverse();

                                                return sortedDates.map(date => {
                                                    const visit = [selectedVisit, ...patientHistory].find(v => v?.visit_date === date);
                                                    const hasImages = patientImages.some(img => {
                                                        try { return new Date(img.timestamp).toISOString().split('T')[0] === date } catch (e) { return false }
                                                    });

                                                    const isActive = selectedDateFilter === date;

                                                    return (
                                                        <div
                                                            key={date}
                                                            className={`p-2 rounded-md cursor-pointer transition-colors border text-sm group ${isActive ? 'bg-primary/10 border-primary/20 text-primary' : 'hover:bg-background/80 border-transparent hover:border-border'}`}
                                                            onClick={() => setSelectedDateFilter(date)}
                                                        >
                                                            <div className="font-medium flex items-center justify-between">
                                                                <span>{new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' })}</span>
                                                                {visit?.visit_id === selectedVisit?.visit_id && <Badge variant="secondary" className="text-[10px] h-4">Today</Badge>}
                                                            </div>


                                                            {/* Mini Indicator dots for images */}
                                                            {hasImages && (
                                                                <div className="flex gap-0.5 mt-1">
                                                                    <div className="h-1 w-1 rounded-full bg-current opacity-50" />
                                                                    <div className="h-1 w-1 rounded-full bg-current opacity-50" />
                                                                </div>
                                                            )}
                                                        </div>
                                                    )
                                                })
                                            })()}
                                        </div>

                                        {/* Images Grid */}
                                        <div className="flex-1 overflow-y-auto p-4 space-y-6">
                                            {showTrash ? (
                                                /* Trash View */
                                                trashImages.length === 0 ? (
                                                    <div className="text-muted-foreground text-sm flex flex-col items-center justify-center h-full opacity-50">
                                                        <Trash2 className="h-8 w-8 mb-2" />
                                                        Trash is empty
                                                    </div>
                                                ) : (
                                                    <div className="space-y-2">
                                                        <p className="text-xs text-muted-foreground px-1">Items are permanently deleted after 30 days.</p>
                                                        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                                                            {trashImages.map((img) => (
                                                                <div key={img.id} className="relative rounded-md overflow-hidden border bg-muted/20 shadow-sm">
                                                                    <div className="aspect-square">
                                                                        <img
                                                                            src={`${API_BASE_URL}/api/patients/images/${img.id}/file`}
                                                                            alt="Trashed"
                                                                            className="w-full h-full object-cover opacity-60"
                                                                            loading="lazy"
                                                                            onError={(e) => {
                                                                                (e.target as HTMLImageElement).src = '/placeholder-image.png'
                                                                                ;(e.target as HTMLImageElement).classList.add('opacity-30', 'p-4')
                                                                            }}
                                                                        />
                                                                    </div>
                                                                    <div className="p-2 space-y-1 bg-background/80 backdrop-blur-sm">
                                                                        <p className="text-[10px] text-muted-foreground truncate">
                                                                            {img.notes || img.tag || "No notes"}
                                                                        </p>
                                                                        <p className="text-[10px] text-destructive font-medium">
                                                                            Trashed {getDaysAgo(img.deleted_at)}
                                                                        </p>
                                                                        <div className="flex gap-1 pt-1">
                                                                            <button
                                                                                type="button"
                                                                                onClick={() => handleRestoreImage(img)}
                                                                                className="flex-1 flex items-center justify-center gap-1 text-[10px] font-medium py-1 rounded bg-primary/10 hover:bg-primary/20 text-primary transition-colors"
                                                                            >
                                                                                <RotateCcw className="h-3 w-3" /> Restore
                                                                            </button>
                                                                            <button
                                                                                type="button"
                                                                                onClick={() => handlePermanentDelete(img.id)}
                                                                                className="flex-1 flex items-center justify-center gap-1 text-[10px] font-medium py-1 rounded bg-destructive/10 hover:bg-destructive/20 text-destructive transition-colors"
                                                                            >
                                                                                <X className="h-3 w-3" /> Delete Forever
                                                                            </button>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )
                                            ) : patientImages.length === 0 ? (
                                                <div className="text-muted-foreground text-sm flex flex-col items-center justify-center h-full opacity-50">
                                                    <ImageIcon className="h-8 w-8 mb-2" />
                                                    No images uploaded
                                                </div>
                                            ) : (
                                                // Group EVERYTHING by Date (YYYY-MM-DD)
                                                (() => {
                                                    // 1. Get all unique dates from Visits and Images
                                                    const allDates = new Set<string>();

                                                    // Add dates from visits
                                                    [selectedVisit, ...patientHistory].filter(Boolean).forEach(v => {
                                                        if (v.visit_date) allDates.add(v.visit_date);
                                                    });

                                                    // Add dates from images
                                                    patientImages.forEach(img => {
                                                        if (img.timestamp) {
                                                            try {
                                                                const dateStr = new Date(img.timestamp).toISOString().split('T')[0];
                                                                allDates.add(dateStr);
                                                            } catch (e) {
                                                                console.warn("Invalid image timestamp", img);
                                                            }
                                                        }
                                                    });

                                                    // 2. Sort dates descending
                                                    let sortedDates = Array.from(allDates).sort().reverse();

                                                    // 3. FILTER based on selection
                                                    if (selectedDateFilter) {
                                                        sortedDates = sortedDates.filter(d => d === selectedDateFilter);
                                                    }

                                                    if (sortedDates.length === 0) {
                                                        return (
                                                            <div className="text-muted-foreground text-sm flex flex-col items-center justify-center h-full opacity-50">
                                                                No records for selected date
                                                            </div>
                                                        )
                                                    }

                                                    // 4. Render groups
                                                    return sortedDates.map(date => {
                                                        // Find visit for this date
                                                        const visitForDate = [selectedVisit, ...patientHistory].find(v => v?.visit_date === date);

                                                        // Find images for this date
                                                        // We match images if their timestamp matches the date
                                                        const imagesForDate = patientImages.filter(img => {
                                                            if (!img.timestamp) return false;
                                                            return new Date(img.timestamp).toISOString().split('T')[0] === date;
                                                        });

                                                        // If we are showing ALL dates (no filter), hide empty dates to reduce clutter? 
                                                        // User logic: "see those dates images only". 
                                                        // If a date has a visit but no images, do we show it in the filtered view? 
                                                        // Probably yes, to show "No images".
                                                        // But in "Show All", maybe skip if empty? 
                                                        // Let's keep consistency: Show header, say "No images" if empty.

                                                        // Actually, if filtering by specific date, definitely show it even if empty images.
                                                        // If showing ALL, maybe hide empty dates if they are just historical visits with no content?
                                                        // Current logic below handles it well.

                                                        return (
                                                            <div key={date} id={`gallery-group-${date}`} className="space-y-3">
                                                                <div className="flex items-center justify-start gap-4 border-b pb-2 bg-background/50 backdrop-blur-sm sticky top-0 z-10 pt-2">
                                                                    <div className="flex items-center gap-2">
                                                                        <Calendar className="h-4 w-4 text-primary" />
                                                                        <span className="text-sm font-bold tracking-tight">{new Date(date).toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })}</span>
                                                                    </div>
                                                                    {visitForDate ? (
                                                                        <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 px-2 py-0.5 rounded-full">
                                                                            <Clock className="h-3 w-3" />
                                                                            <span className="font-medium">{visitForDate.reason || "General Checkup"}</span>
                                                                        </div>
                                                                    ) : (
                                                                        <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 px-2 py-0.5 rounded-full">
                                                                            <ImageIcon className="h-3 w-3" />
                                                                            <span className="font-medium">Direct Uploads</span>
                                                                        </div>
                                                                    )}
                                                                </div>

                                                                {imagesForDate.length > 0 ? (
                                                                    <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                                                                        {imagesForDate.map((img) => (
                                                                            <div
                                                                                key={img.id}
                                                                                className="relative aspect-square rounded-md overflow-hidden border bg-muted/20 group cursor-pointer shadow-sm hover:shadow-md transition-all"
                                                                                onClick={() => setLightboxState({ image: img, context: imagesForDate })}
                                                                            >
                                                                                <img
                                                                                    src={`${API_BASE_URL}/api/patients/images/${img.id}/file`}
                                                                                    alt="Patient"
                                                                                    className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                                                                                    loading="lazy"
                                                                                    onError={(e) => {
                                                                                        (e.target as HTMLImageElement).src = '/placeholder-image.png';
                                                                                        (e.target as HTMLImageElement).classList.add('opacity-50', 'p-4');
                                                                                    }}
                                                                                />
                                                                                {/* Overlay Gradient */}
                                                                                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200" />

                                                                                {/* Icons/Info on Hover */}
                                                                                {img.tag && (
                                                                                    <div className="absolute top-2 right-2 bg-black/50 backdrop-blur-md text-white text-[10px] px-1.5 py-0.5 rounded font-medium opacity-0 group-hover:opacity-100 transition-opacity">
                                                                                        {img.tag}
                                                                                    </div>
                                                                                )}

                                                                                {img.notes && (
                                                                                    <div className="absolute bottom-0 left-0 right-0 p-2 text-white text-xs truncate font-medium transform translate-y-full group-hover:translate-y-0 transition-transform duration-200">
                                                                                        {img.notes}
                                                                                    </div>
                                                                                )}

                                                                                {/* Delete (trash) button */}
                                                                                <button
                                                                                    type="button"
                                                                                    className="absolute bottom-2 right-2 p-1.5 rounded-full bg-black/50 text-white hover:bg-red-600 hover:text-white transition-colors z-10"
                                                                                    onClick={(e) => { e.stopPropagation(); handleDeleteImage(img.id) }}
                                                                                    title="Move to trash"
                                                                                >
                                                                                    <Trash2 className="h-3.5 w-3.5" />
                                                                                </button>
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                ) : (
                                                                    <div className="text-xs text-muted-foreground italic pl-6 py-2">
                                                                        No images for this date.
                                                                    </div>
                                                                )}
                                                            </div>
                                                        );
                                                    });
                                                })()
                                            )}
                                        </div>
                                    </div>
                                </Card>

                                {/* Upload Preview Dialog */}
                                <Dialog open={uploadFiles.length > 0} onOpenChange={(open) => !open && clearUpload()}>
                                    <DialogContent className="max-w-md">
                                        <DialogHeader>
                                            <DialogTitle>
                                                Upload Patient Image{uploadFiles.length > 1 ? `s (${uploadFiles.length})` : ''}
                                            </DialogTitle>
                                        </DialogHeader>
                                        <div className="space-y-4">
                                            <div className="grid grid-cols-3 gap-2 max-h-64 overflow-y-auto">
                                                {uploadFiles.map((entry, i) => (
                                                    <div key={i} className="group aspect-square relative rounded-md overflow-hidden bg-muted border">
                                                        <img src={entry.preview} alt={`Preview ${i + 1}`} className="w-full h-full object-cover" />
                                                        <button
                                                            type="button"
                                                            onClick={() => removeUploadFile(i)}
                                                            className="absolute top-1 right-1 bg-black/60 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                                                            title="Remove"
                                                        >
                                                            <X className="h-3 w-3" />
                                                        </button>
                                                    </div>
                                                ))}
                                                <button
                                                    type="button"
                                                    onClick={() => document.getElementById('image-upload-input')?.click()}
                                                    className="aspect-square rounded-md border border-dashed flex items-center justify-center text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
                                                    title="Add more images"
                                                >
                                                    <Plus className="h-5 w-5" />
                                                </button>
                                            </div>
                                            <div className="space-y-2">
                                                <label className="text-sm font-medium">Notes (Optional)</label>
                                                <Textarea
                                                    placeholder="Add clinical notes about this image..."
                                                    value={uploadNotes}
                                                    onChange={(e) => setUploadNotes(e.target.value)}
                                                />
                                            </div>
                                            <div className="flex justify-end gap-2">
                                                <Button variant="outline" onClick={clearUpload} disabled={uploading}>Cancel</Button>
                                                <Button onClick={confirmUpload} disabled={uploading}>
                                                    {uploading
                                                        ? "Uploading..."
                                                        : uploadFiles.length > 1 ? `Upload ${uploadFiles.length} Images` : "Upload Image"}
                                                </Button>
                                            </div>
                                        </div>
                                    </DialogContent>
                                </Dialog>

                                {/* QR Upload Dialog */}
                                {selectedVisit && (
                                    <QRCodeUpload
                                        open={showQR}
                                        onOpenChange={setShowQR}
                                        contextType="patient"
                                        contextId={selectedVisit.patient_id}
                                        onSuccess={async () => {
                                            const imgs = await api.getPatientImages(selectedVisit.patient_id)
                                            setPatientImages(imgs)
                                            toast.success("Images uploaded via QR")
                                        }}
                                    />
                                )}

                                {/* View Image Dialog */}
                                <ImagePreviewDialog
                                    image={lightboxState?.image}
                                    isOpen={!!lightboxState}
                                    onClose={() => setLightboxState(null)}
                                    allImages={lightboxState?.context || []}
                                    onNavigate={(dir) => {
                                        if (dir === 'next') handleNextImage()
                                        else handlePrevImage()
                                    }}
                                    onSave={async (img, notes, tag) => {
                                        await api.updatePatientImage(img.id, { notes, tag })
                                        toast.success("Image updated")
                                        setRefreshTrigger(prev => prev + 1)
                                        // Update the currently viewed image state so changes reflect immediately
                                        if (lightboxState) {
                                            setLightboxState({
                                                ...lightboxState,
                                                image: { ...img, notes, tag }
                                            })
                                        }
                                    }}
                                    title={lightboxState?.image?.patient_name}
                                    subtitle={lightboxState?.image?.timestamp ? new Date(lightboxState.image.timestamp).toLocaleDateString() : ""}
                                    fullScreen={true}
                                />
                            </div>
                        </div>
                    </>
                ) : (
                    <div className="h-full flex flex-col items-center justify-center text-muted-foreground">
                        <User className="h-16 w-16 mb-4 opacity-20" />
                        <h2 className="text-xl font-semibold">No Patient Selected</h2>
                        <p>Select a patient from the sidebar to view details.</p>
                    </div>
                )}
            </div >

            {/* RIGHT SIDEBAR (Fixed Width, ~30%) */}
            < div className="w-[380px] p-6 flex flex-col gap-6 shrink-0 bg-transparent" >

                {/* Summary Card */}
                < Card className="bg-transparent border-input shadow-sm" >
                    <CardHeader className="pb-2 pt-5 px-6">
                        <CardTitle className="text-lg font-medium">Summary</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="flex justify-between items-center pb-2">
                            <span className="text-muted-foreground">Total Appointments</span>
                            <span className="font-bold">{orderedTodayVisits.length}</span>
                        </div>
                        <div className="flex justify-between items-center pb-2">
                            <span className="text-muted-foreground">Completed</span>
                            <span className="font-bold text-green-600">
                                {orderedTodayVisits.filter(v => v.status === 'done').length}
                            </span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="text-muted-foreground">Pending</span>
                            <span className="font-bold text-blue-600">
                                {orderedTodayVisits.filter(v => v.status !== 'done' && v.status !== 'cancelled').length}
                            </span>
                        </div>
                    </CardContent>
                </Card >

                {/* Today's Appointments Card */}
                < Card className="flex-1 flex flex-col bg-transparent border-input shadow-sm overflow-hidden min-h-0" >
                    <CardHeader className="pb-3 pt-5 px-6 bg-muted/10">
                        <div className="flex items-center justify-between">
                            <CardTitle className="text-sm font-medium flex items-center gap-2">
                                <User className="h-4 w-4" /> Today&apos;s Appointments
                            </CardTitle>
                            <Badge variant="secondary" className="text-[10px] font-normal">{today}</Badge>
                        </div>
                    </CardHeader>

                    <div className="flex-1 overflow-y-auto p-4 space-y-3">
                        {loading ? (
                            <div className="text-center py-8"><Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" /></div>
                        ) : orderedTodayVisits.length === 0 ? (
                            <div className="text-center py-12 text-muted-foreground text-sm">No appointments today.</div>
                        ) : (
                            orderedTodayVisits.map(visit => (
                                <div
                                    key={visit.visit_id}
                                    onClick={() => { setSelectedVisitId(visit.visit_id); setMobileDetailOpen(true) }}
                                    className={cn(
                                        "p-3 rounded-md border transition-all duration-200 cursor-pointer flex items-center gap-2",
                                        visit.status === 'done'
                                            ? 'opacity-60 border-green-500 bg-green-500/5 hover:bg-green-500/10'
                                            : selectedVisitId === visit.visit_id
                                                ? 'bg-primary/10 border-primary shadow-sm'
                                                : 'bg-transparent border-transparent hover:bg-muted/50 hover:border-border/50'
                                    )}
                                >
                                    <span className="font-bold text-sm min-w-[3rem] flex-shrink-0">{visit.visit_time?.substring(0, 5) || "ASAP"}</span>
                                    <span className="text-xs font-medium tabular-nums text-muted-foreground min-w-[3.5rem] flex-shrink-0">
                                        {visit.visiting_fee ? `₹${visit.visiting_fee}` : '—'}
                                    </span>
                                    <div className="font-medium text-sm truncate flex-1 min-w-0">{visit.patient_name}</div>
                                    {visit.billed_amount != null && (
                                        <span className="text-xs font-semibold tabular-nums text-green-700 dark:text-green-400 flex-shrink-0">
                                            ₹{visit.billed_amount}
                                        </span>
                                    )}
                                    <button
                                        type="button"
                                        onClick={(e) => { e.stopPropagation(); handleDeleteVisit(visit.visit_id) }}
                                        className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors flex-shrink-0"
                                        title={`Delete visit ${visit.visit_id}`}
                                    >
                                        <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                </div>
                            ))
                        )}
                    </div>
                </Card >

            </div >

            </div>
            </div>
        </div>
    )
}


// ImagePreviewDialog removed - imported from components/ImagePreviewDialog

