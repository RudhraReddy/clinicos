"use client"

import { Button } from "@/components/ui/button"
import { Check, Loader2, Pencil, Trash2, Package, CreditCard, Users, Menu, Plus, X, Image as ImageIcon, Smartphone } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { getTodayIST, orderTodayVisits } from "@/lib/utils"
import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { useAuth } from "@/lib/auth_context"
import { useMenu } from "@/components/layout/AppShell"
import { EditVisitDialog } from "@/components/EditVisitDialog"
import { WalkInForm } from "@/components/WalkInForm"
import { QRCodeUpload } from "@/components/QRCodeUpload"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { VisitsTab } from "@/components/VisitsTab"
import { api, type Visit } from "@/lib/api"
import { toast } from "sonner"

function formatTime(timeStr: string | null | undefined, createdAt?: string | null) {
    if (!timeStr) {
        if (!createdAt) return "ASAP"
        try {
            const date = new Date(createdAt)
            const h = date.getHours()
            const m = date.getMinutes().toString().padStart(2, '0')
            const ampm = h >= 12 ? 'PM' : 'AM'
            return `${h % 12 || 12}:${m} ${ampm}`
        } catch { return "ASAP" }
    }
    try {
        const [hours, minutes] = timeStr.split(':')
        const h = parseInt(hours, 10)
        const ampm = h >= 12 ? 'PM' : 'AM'
        return `${h % 12 || 12}:${minutes} ${ampm}`
    } catch { return timeStr }
}

function formatUpdatedTime(updatedAtStr?: string, createdAtStr?: string) {
    if (!updatedAtStr) return null
    try {
        const created = createdAtStr ? new Date(createdAtStr).getTime() : 0
        const updated = new Date(updatedAtStr).getTime()
        if (Math.abs(updated - created) > 5000) {
            const date = new Date(updatedAtStr)
            const h = date.getHours()
            const m = date.getMinutes().toString().padStart(2, '0')
            const ampm = h >= 12 ? 'PM' : 'AM'
            return `${h % 12 || 12}:${m} ${ampm}`
        }
    } catch { /* ignore */ }
    return null
}


export default function Dashboard() {
    const [visits, setVisits] = useState<Visit[]>([])
    const [loading, setLoading] = useState(true)
    const [editVisitOpen, setEditVisitOpen] = useState(false)
    const [selectedVisit, setSelectedVisit] = useState<Visit | null>(null)

    // Image upload dialog state
    const [uploadTargetVisit, setUploadTargetVisit] = useState<Visit | null>(null)
    const [uploadFiles, setUploadFiles] = useState<{ file: File, preview: string }[]>([])
    const [uploadNotes, setUploadNotes] = useState("")
    const [uploading, setUploading] = useState(false)
    const [showQR, setShowQR] = useState(false)

    const { role, isLoading } = useAuth()
    const router = useRouter()
    const { openMenu } = useMenu()

    useEffect(() => {
        if (!isLoading && role === 'doctor') router.push('/doctor')
    }, [role, isLoading, router])

    const fetchVisits = async () => {
        try {
            setLoading(true)
            const all = await api.getVisits()
            setVisits(all.filter(v => v.status !== 'deleted'))
        } catch (err) {
            console.error("Failed to fetch visits:", err)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => { fetchVisits() }, [])

    if (isLoading || role === 'doctor') {
        return (
            <div className="flex h-screen items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        )
    }

    const today = getTodayIST()
    const todayVisits = visits.filter(v => v.visit_date === today)
    const orderedTodayVisits = orderTodayVisits(todayVisits)
    const waitingCount = todayVisits.filter(v =>
        !['in_progress', 'done', 'cancelled'].includes(v.status.toLowerCase())
    ).length

    const handleDeleteVisit = async (visitId: string) => {
        if (!confirm("Delete this visit?")) return
        try {
            await api.updateVisit(visitId, { status: 'deleted' })
            fetchVisits()
        } catch { /* silent */ }
    }

    const handleMarkDone = async (visitId: string) => {
        try {
            await api.updateVisit(visitId, { status: 'done' })
            fetchVisits()
        } catch { /* silent */ }
    }

    const handleGoToBilling = (visit: Visit) => {
        router.push(`/billing?patient_id=${visit.patient_id}`)
    }

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
        e.target.value = ''
    }

    const removeUploadFile = (index: number) => {
        setUploadFiles(prev => prev.filter((_, i) => i !== index))
    }

    const clearUpload = () => {
        setUploadTargetVisit(null)
        setUploadFiles([])
        setUploadNotes("")
        setShowQR(false)
    }

    const confirmUpload = async () => {
        if (uploadFiles.length === 0 || !uploadTargetVisit) return

        setUploading(true)
        let successCount = 0
        let failCount = 0
        for (const { file } of uploadFiles) {
            try {
                await api.uploadPatientImage(uploadTargetVisit.patient_id, file, uploadTargetVisit.visit_id, uploadNotes)
                successCount++
            } catch (error) {
                console.error(error)
                failCount++
            }
        }
        setUploading(false)

        if (failCount === 0) {
            toast.success(successCount === 1 ? "Image uploaded" : `${successCount} images uploaded`)
        } else {
            toast.error(`${successCount} uploaded, ${failCount} failed`)
        }

        clearUpload()
    }

    const renderVisitCard = (visit: Visit) => (
        <div
            key={visit.visit_id}
            className={`mx-3 mb-2 rounded-lg border px-3 py-2.5 transition-colors ${
                visit.status === 'done'
                    ? 'border-border bg-background dark:bg-muted/10'
                    : 'border-border bg-muted/60 hover:bg-muted/80 dark:bg-muted/30 dark:hover:bg-muted/50'
            }`}
        >
            {/* Name row */}
            <div className="flex items-center justify-between gap-2 mb-2">
                <p className="font-semibold text-base leading-none truncate">{visit.patient_name}</p>
                {visit.status === 'done' && (
                    <span className="text-[10px] font-medium text-green-600 dark:text-green-400 shrink-0">Done</span>
                )}
            </div>
            {/* Fee + time + actions */}
            <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-3">
                    <span className={`text-sm font-medium tabular-nums ${visit.payment_status === 'full' ? 'text-green-600 dark:text-green-400' : ''}`}>
                        {visit.visiting_fee ? `₹${visit.visiting_fee}` : '—'}
                    </span>
                    <span className="text-xs text-muted-foreground font-mono">
                        {formatTime(visit.visit_time, visit.created_at)}
                    </span>
                </div>
                <div className="flex items-center gap-0.5">
                    {visit.status !== 'done' && (
                        <Button
                            variant="ghost" size="icon"
                            className="h-7 w-7 rounded-md hover:bg-green-100 hover:text-green-600 dark:hover:bg-green-500/20"
                            onClick={() => handleMarkDone(visit.visit_id)}
                            title="Mark done"
                        >
                            <Check className="h-3.5 w-3.5" />
                        </Button>
                    )}
                    <Button
                        variant="ghost" size="icon"
                        className="h-7 w-7 rounded-md hover:bg-emerald-100 hover:text-emerald-600 dark:hover:bg-emerald-500/20"
                        onClick={() => handleGoToBilling(visit)}
                        title="Go to Billing"
                    >
                        <CreditCard className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                        variant="ghost" size="icon"
                        className="h-7 w-7 rounded-md hover:bg-purple-100 hover:text-purple-600 dark:hover:bg-purple-500/20"
                        onClick={() => setUploadTargetVisit(visit)}
                        title="Add images"
                    >
                        <Plus className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                        variant="ghost" size="icon"
                        className="h-7 w-7 rounded-md hover:bg-blue-100 hover:text-blue-600 dark:hover:bg-blue-500/20"
                        onClick={() => { setSelectedVisit(visit); setEditVisitOpen(true) }}
                        title="Edit"
                    >
                        <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                        variant="ghost" size="icon"
                        className="h-7 w-7 rounded-md hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-500/20"
                        onClick={() => handleDeleteVisit(visit.visit_id)}
                        title="Delete"
                    >
                        <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                </div>
            </div>
        </div>
    )

    const renderTodaysList = () => (
        <Card className="flex-1 flex flex-col overflow-hidden">
            <CardHeader className="pb-2 pt-4 px-4 shrink-0">
                <div className="flex items-center justify-between">
                    <CardTitle className="text-base">Today&apos;s Visits</CardTitle>
                    <span className="text-xs font-normal text-muted-foreground bg-secondary px-2 py-0.5 rounded-md">
                        {loading ? "..." : waitingCount} waiting
                    </span>
                </div>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto pt-2 pb-3 px-0 custom-scrollbar">
                <style jsx global>{`
                    .custom-scrollbar::-webkit-scrollbar { width: 6px; }
                    .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
                    .custom-scrollbar::-webkit-scrollbar-thumb { background-color: #cbd5e1; border-radius: 20px; }
                    .custom-scrollbar::-webkit-scrollbar-thumb:hover { background-color: #94a3b8; }
                `}</style>
                {loading ? (
                    <div className="py-10 text-center text-muted-foreground text-sm">
                        <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />Loading...
                    </div>
                ) : orderedTodayVisits.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-6">No appointments today</p>
                ) : (
                    orderedTodayVisits.map(v => renderVisitCard(v))
                )}
            </CardContent>
        </Card>
    )

    return (
        <div className="space-y-6 h-[calc(100vh-100px)] flex flex-col">
            <Tabs defaultValue="overview" className="flex-1 flex flex-col overflow-hidden gap-4">
                <div className="flex items-center gap-3 flex-shrink-0">
                    <button
                        type="button"
                        onClick={openMenu}
                        className="shrink-0 rounded-md p-1 text-foreground hover:bg-accent transition-colors"
                    >
                        <Menu className="h-6 w-6" />
                        <span className="sr-only">Toggle Menu</span>
                    </button>
                    <h1 className="text-2xl font-bold tracking-tight text-foreground">Dashboard</h1>
                    <TabsList>
                        <TabsTrigger value="overview">Overview</TabsTrigger>
                        <TabsTrigger value="visits">All Visits</TabsTrigger>
                    </TabsList>
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

                <TabsContent value="overview" className="flex-1 overflow-hidden m-0">
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-full">
                        {/* Left 2/3: Walk-in form */}
                        <div className="lg:col-span-2 h-full overflow-hidden">
                            <WalkInForm onSuccess={fetchVisits} />
                        </div>
                        {/* Right 1/3: Today's list */}
                        <div className="lg:col-span-1 h-full flex flex-col gap-6 pr-1 overflow-hidden">
                            {renderTodaysList()}
                        </div>
                    </div>
                </TabsContent>

                <TabsContent value="visits" className="h-[calc(100%-40px)] m-0">
                    <VisitsTab visits={visits} loading={loading} onRefresh={fetchVisits} />
                </TabsContent>
            </Tabs>

            <EditVisitDialog
                open={editVisitOpen}
                onOpenChange={setEditVisitOpen}
                visit={selectedVisit}
                onSuccess={fetchVisits}
            />

            <input
                id="dashboard-image-upload-input"
                type="file"
                accept="image/*"
                multiple
                style={{ display: 'none' }}
                onChange={handleImageUpload}
            />

            <Dialog open={!!uploadTargetVisit} onOpenChange={(open) => !open && clearUpload()}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>
                            Upload Images{uploadFiles.length > 1 ? ` (${uploadFiles.length})` : ''}
                            {uploadTargetVisit ? ` — ${uploadTargetVisit.patient_name}` : ''}
                        </DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                        <Button variant="outline" size="sm" className="w-full" onClick={() => setShowQR(true)}>
                            <Smartphone className="mr-2 h-3.5 w-3.5" />
                            Upload via QR
                        </Button>
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
                                onClick={() => document.getElementById('dashboard-image-upload-input')?.click()}
                                className="aspect-square rounded-md border border-dashed flex items-center justify-center text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
                                title="Add more images"
                            >
                                {uploadFiles.length === 0 ? <ImageIcon className="h-5 w-5" /> : <Plus className="h-5 w-5" />}
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
                            <Button onClick={confirmUpload} disabled={uploading || uploadFiles.length === 0}>
                                {uploading
                                    ? "Uploading..."
                                    : uploadFiles.length > 1 ? `Upload ${uploadFiles.length} Images` : "Upload Image"}
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            {uploadTargetVisit && (
                <QRCodeUpload
                    open={showQR}
                    onOpenChange={setShowQR}
                    contextType="patient"
                    contextId={uploadTargetVisit.patient_id}
                    onSuccess={() => toast.success("Images uploaded via QR")}
                />
            )}
        </div>
    )
}
