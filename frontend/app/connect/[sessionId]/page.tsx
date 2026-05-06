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

    // Form State
    const [frontFile, setFrontFile] = useState<File | null>(null)
    const [backFile, setBackFile] = useState<File | null>(null)
    const [notes, setNotes] = useState("")

    useEffect(() => {
        checkSession()
    }, [sessionId])

    const checkSession = async () => {
        try {
            const res = await api.getUploadSession(sessionId)
            if (res.status !== 'COMPLETED') {
                setSessionValid(true)
            }
        } catch (e) {
            console.error(e)
            setSessionValid(false)
        } finally {
            setLoading(false)
        }
    }

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>, side: 'front' | 'back') => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0]
            if (side === 'front') setFrontFile(file)
            else setBackFile(file)
        }
    }

    const removeFile = (side: 'front' | 'back') => {
        if (side === 'front') setFrontFile(null)
        else setBackFile(null)
    }

    const handleSubmit = async () => {
        if (!frontFile && !backFile) return

        setSubmitting(true)
        try {
            const filesToUpload: File[] = []
            const tagsToUpload: string[] = []

            if (frontFile) {
                filesToUpload.push(frontFile)
                tagsToUpload.push("Image - Front")
            }
            if (backFile) {
                filesToUpload.push(backFile)
                tagsToUpload.push("Image - Back")
            }

            await api.uploadMobileFiles(sessionId, filesToUpload, tagsToUpload, notes)
            setSuccess(true)
            setFrontFile(null)
            setBackFile(null)
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
                <h1 className="text-2xl font-bold">Upload Images</h1>
                <p className="text-muted-foreground text-sm">Upload images for this visit.</p>
            </div>

            <div className="grid grid-cols-1 gap-4">
                {/* Image 1 Card */}
                <Card className={frontFile ? "border-green-500/50 bg-green-50/10" : ""}>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-base flex justify-between items-center">
                            <span>Image 1</span>
                            {frontFile && <CheckCircle2 className="h-4 w-4 text-green-600" />}
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        {!frontFile ? (
                            <div>
                                <Label htmlFor="front-upload" className="cursor-pointer block">
                                    <div className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-lg bg-muted/20 hover:bg-muted/40 transition-colors">
                                        <Upload className="h-8 w-8 text-muted-foreground mb-2" />
                                        <span className="text-sm font-medium text-muted-foreground">Tap to Select Image</span>
                                    </div>
                                </Label>
                                <Input
                                    id="front-upload"
                                    type="file"
                                    accept="image/*"
                                    capture="environment"
                                    className="hidden"
                                    onChange={(e) => handleFileSelect(e, 'front')}
                                />
                            </div>
                        ) : (
                            <div className="relative">
                                <div className="flex items-center gap-3 p-3 border rounded-md bg-background">
                                    <div className="w-10 h-10 bg-muted rounded flex items-center justify-center">
                                        <ImageIcon className="h-5 w-5 text-muted-foreground" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium truncate">{frontFile.name}</p>
                                        <p className="text-xs text-muted-foreground">{(frontFile.size / 1024).toFixed(1)} KB</p>
                                    </div>
                                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => removeFile('front')}>
                                        <X className="h-4 w-4" />
                                    </Button>
                                </div>
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* Image 2 Card */}
                <Card className={backFile ? "border-green-500/50 bg-green-50/10" : ""}>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-base flex justify-between items-center">
                            <span>Image 2</span>
                            {backFile && <CheckCircle2 className="h-4 w-4 text-green-600" />}
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        {!backFile ? (
                            <div>
                                <Label htmlFor="back-upload" className="cursor-pointer block">
                                    <div className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-lg bg-muted/20 hover:bg-muted/40 transition-colors">
                                        <Upload className="h-8 w-8 text-muted-foreground mb-2" />
                                        <span className="text-sm font-medium text-muted-foreground">Tap to Select Image</span>
                                    </div>
                                </Label>
                                <Input
                                    id="back-upload"
                                    type="file"
                                    accept="image/*"
                                    capture="environment"
                                    className="hidden"
                                    onChange={(e) => handleFileSelect(e, 'back')}
                                />
                            </div>
                        ) : (
                            <div className="relative">
                                <div className="flex items-center gap-3 p-3 border rounded-md bg-background">
                                    <div className="w-10 h-10 bg-muted rounded flex items-center justify-center">
                                        <ImageIcon className="h-5 w-5 text-muted-foreground" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium truncate">{backFile.name}</p>
                                        <p className="text-xs text-muted-foreground">{(backFile.size / 1024).toFixed(1)} KB</p>
                                    </div>
                                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => removeFile('back')}>
                                        <X className="h-4 w-4" />
                                    </Button>
                                </div>
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>

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
                disabled={(!frontFile && !backFile) || submitting}
            >
                {submitting ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : null}
                Upload {frontFile && backFile ? 'Both Images' : 'Selected Image'}
            </Button>
        </div>
    )
}
