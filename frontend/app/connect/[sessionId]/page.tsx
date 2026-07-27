"use client"

import { useState, useEffect } from "react"
import { useParams } from "next/navigation"
import { api } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Loader2, Upload, X, CheckCircle2, Image as ImageIcon } from "lucide-react"

export default function MobileUploadPage() {
    const params = useParams()
    const sessionId = params.sessionId as string

    const [loading, setLoading] = useState(true)
    const [sessionValid, setSessionValid] = useState(false)
    const [submitting, setSubmitting] = useState(false)
    const [success, setSuccess] = useState(false)
    const [contextType, setContextType] = useState<string>("")

    // Form State
    const [files, setFiles] = useState<File[]>([])
    const [notes, setNotes] = useState("")

    useEffect(() => {
        checkSession()
    }, [sessionId])

    const checkSession = async () => {
        try {
            const res = await api.getUploadSession(sessionId)
            if (res.status !== 'COMPLETED') {
                setSessionValid(true)
                if (res.context_type) setContextType(res.context_type)
            }
        } catch (e) {
            console.error(e)
            setSessionValid(false)
        } finally {
            setLoading(false)
        }
    }

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            const picked = Array.from(e.target.files)
            setFiles(prev => [...prev, ...picked])
        }
        e.target.value = ''
    }

    const removeFile = (index: number) => {
        setFiles(prev => prev.filter((_, i) => i !== index))
    }

    const handleSubmit = async () => {
        if (files.length === 0) return

        setSubmitting(true)
        try {
            await api.uploadMobileFiles(sessionId, files, [], notes)
            setSuccess(true)
            setFiles([])
            setNotes("")
        } catch (e) {
            console.error(e)
            alert("Upload failed. Please try again.")
        } finally {
            setSubmitting(false)
        }
    }

    if (loading) {
        return <div className="flex h-screen items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>
    }

    if (!sessionValid) {
        return (
            <div className="flex h-screen flex-col items-center justify-center p-4 text-center">
                <X className="h-12 w-12 text-destructive mb-4" />
                <h1 className="text-xl font-bold">Invalid or Expired Session</h1>
                <p className="text-muted-foreground">Please obtain a new QR code from the desktop application.</p>
            </div>
        )
    }

    if (success) {
        return (
            <div className="flex h-screen flex-col items-center justify-center p-4 text-center bg-green-50 dark:bg-green-900/10">
                <CheckCircle2 className="h-16 w-16 text-green-600 mb-4" />
                <h1 className="text-2xl font-bold text-green-700">Upload Successful!</h1>
                <p className="text-green-600 mb-8">Your images have been sent.</p>
                <Button onClick={() => setSuccess(false)} variant="outline">Upload More</Button>
            </div>
        )
    }

    return (
        <div className="container max-w-md mx-auto py-6 px-4 space-y-6">
            <div className="text-center space-y-1">
                <h1 className="text-2xl font-bold">
                    {contextType === 'inventory' ? 'Upload Report Image' : 'Upload Images'}
                </h1>
                <p className="text-muted-foreground text-sm">
                    {contextType === 'inventory' ? 'Upload an image of your inventory report.' : 'Upload images for this visit.'}
                </p>
            </div>

            <Card className={files.length > 0 ? "border-green-500/50 bg-green-50/10" : ""}>
                <CardHeader className="pb-2">
                    <CardTitle className="text-base flex justify-between items-center">
                        <span>Images{files.length > 0 ? ` (${files.length})` : ''}</span>
                        {files.length > 0 && <CheckCircle2 className="h-4 w-4 text-green-600" />}
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                    {files.map((file, i) => (
                        <div key={i} className="flex items-center gap-3 p-3 border rounded-md bg-background">
                            <div className="w-10 h-10 bg-muted rounded flex items-center justify-center flex-shrink-0">
                                <ImageIcon className="h-5 w-5 text-muted-foreground" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate">{file.name}</p>
                                <p className="text-xs text-muted-foreground">{(file.size / 1024).toFixed(1)} KB</p>
                            </div>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive flex-shrink-0" onClick={() => removeFile(i)}>
                                <X className="h-4 w-4" />
                            </Button>
                        </div>
                    ))}

                    <div>
                        <Label htmlFor="image-upload" className="cursor-pointer block">
                            <div className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-lg bg-muted/20 hover:bg-muted/40 transition-colors">
                                <Upload className="h-8 w-8 text-muted-foreground mb-2" />
                                <span className="text-sm font-medium text-muted-foreground">
                                    {files.length > 0 ? 'Tap to Add More' : 'Tap to Select Images'}
                                </span>
                            </div>
                        </Label>
                        <Input
                            id="image-upload"
                            type="file"
                            accept="image/*"
                            multiple
                            className="hidden"
                            onChange={handleFileSelect}
                        />
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">Additional Notes</CardTitle>
                </CardHeader>
                <CardContent>
                    <Textarea
                        placeholder="Add any notes for these files..."
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                    />
                </CardContent>
            </Card>

            <Button
                size="lg"
                className="w-full font-bold text-lg h-12"
                onClick={handleSubmit}
                disabled={files.length === 0 || submitting}
            >
                {submitting ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : null}
                Upload {files.length > 1 ? `${files.length} Images` : 'Image'}
            </Button>
        </div>
    )
}
