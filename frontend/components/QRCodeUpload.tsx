"use client"

import { useState, useEffect } from "react"
import QRCode from "react-qr-code"
import { api, API_BASE_URL } from "@/lib/api"
import { Button } from "@/components/ui/button"
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter
} from "@/components/ui/dialog"
import { Loader2, CheckCircle2, FileText, RefreshCw, Smartphone, Image as ImageIcon } from "lucide-react"

interface QRCodeUploadProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    contextType: 'patient' | 'inventory'
    contextId: string
    onSuccess?: () => void
}

export function QRCodeUpload({ open, onOpenChange, contextType, contextId, onSuccess }: QRCodeUploadProps) {
    const [sessionId, setSessionId] = useState<string | null>(null)
    const [uploadUrl, setUploadUrl] = useState<string>("")
    const [status, setStatus] = useState<string>("WAITING") // WAITING, UPLOADED, COMPLETED
    const [files, setFiles] = useState<any[]>([])
    const [generated, setGenerated] = useState(false)

    // Reset when dialog opens
    useEffect(() => {
        if (open && !generated) {
            initSession()
        }
        if (!open) {
            // Cleanup or reset?
            // setGenerated(false) // If we want fresh session every time
        }
    }, [open])

    const initSession = async () => {
        try {
            const res = await api.createUploadSession(contextType, contextId)
            setSessionId(res.session_id)

            // Construct URL. We need to be careful about localhost.
            // Best effort: usage of window.location
            const protocol = window.location.protocol
            const host = window.location.hostname
            const port = window.location.port

            // If localhost, warn?
            const baseUrl = `${protocol}//${host}:${port}`
            setUploadUrl(`${baseUrl}/connect/${res.session_id}`)

            setGenerated(true)
            setStatus("WAITING")
            setFiles([])
        } catch (e) {
            console.error(e)
            alert("Failed to generate QR session")
        }
    }

    // Polling
    useEffect(() => {
        let interval: NodeJS.Timeout
        if (sessionId && status !== 'COMPLETED' && open) {
            interval = setInterval(async () => {
                try {
                    const res = await api.getUploadSession(sessionId)
                    if (res.files && res.files.length > files.length) {
                        setFiles(res.files)
                        if (status === 'WAITING') setStatus('UPLOADED')
                    }
                } catch (e) {
                    console.error("Polling error", e)
                }
            }, 2000)
        }
        return () => clearInterval(interval)
    }, [sessionId, status, open, files])

    const handleFinalize = async () => {
        if (!sessionId) return
        try {
            await api.finalizeUploadSession(sessionId)
            setStatus('COMPLETED')
            if (onSuccess) onSuccess()
            setTimeout(() => onOpenChange(false), 1500)
        } catch (e) {
            console.error(e)
            alert("Failed to save images")
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Upload via Mobile</DialogTitle>
                    <DialogDescription>
                        Scan this QR code with your phone to upload images directly.
                    </DialogDescription>
                </DialogHeader>

                <div className="flex flex-col items-center justify-center space-y-6 py-4">
                    {!sessionId ? (
                        <Loader2 className="h-8 w-8 animate-spin" />
                    ) : status === 'COMPLETED' ? (
                        <div className="flex flex-col items-center text-green-600">
                            <CheckCircle2 className="h-16 w-16 mb-2" />
                            <p className="font-semibold">Upload Complete!</p>
                        </div>
                    ) : (
                        <>
                            <div className="p-4 bg-white rounded-lg shadow-sm border">
                                <QRCode value={uploadUrl} size={200} />
                            </div>
                            <div className="text-center space-y-1">
                                <p className="text-sm font-medium">Session Active</p>
                                <p className="text-xs text-muted-foreground break-all max-w-[250px] mx-auto">
                                    {uploadUrl}
                                </p>
                            </div>

                            {/* File List */}
                            {files.length > 0 && (
                                <div className="w-full space-y-2">
                                    <h4 className="text-sm font-semibold flex items-center">
                                        <ImageIcon className="h-4 w-4 mr-2" />
                                        Received Files ({files.length})
                                    </h4>
                                    <div className="max-h-40 overflow-y-auto border rounded-md p-2 space-y-2">
                                        {files.map((f, i) => (
                                            <div key={i} className="flex items-center text-sm gap-2">
                                                <div className="w-8 h-8 bg-muted rounded overflow-hidden flex-shrink-0">
                                                    {/* We can't view temp files easily unless we expose static route for them.
                                                        For now just show icon.
                                                        Actually we can proxy via backend logic if we want, but name is enough.
                                                    */}
                                                    <img src={`/api/temp/file/${sessionId}/${f.filename}`}
                                                        alt="thumb"
                                                        className="w-full h-full object-cover"
                                                        onError={(e) => (e.currentTarget.src = "")}
                                                    />
                                                </div>
                                                <div className="flex-1 truncate">
                                                    <p className="truncate">{f.filename}</p>
                                                    <p className="text-xs text-muted-foreground">{f.tag}</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {status === 'WAITING' && (
                                <div className="flex items-center text-sm text-yellow-600 animate-pulse">
                                    <Smartphone className="h-4 w-4 mr-2" />
                                    Waiting for scan...
                                </div>
                            )}
                        </>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => initSession()}>
                        <RefreshCw className="h-4 w-4 mr-2" />
                        Regenerate
                    </Button>
                    <Button
                        onClick={handleFinalize}
                        disabled={files.length === 0 || status === 'COMPLETED'}
                        className="bg-green-600 hover:bg-green-700"
                    >
                        Save Images
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
