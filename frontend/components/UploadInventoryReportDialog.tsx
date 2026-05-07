"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import { Loader2, Upload, CheckCircle2, AlertCircle, QrCode } from "lucide-react"
import { api } from "@/lib/api"
import { QRCodeUpload } from "./QRCodeUpload"


interface UploadInventoryReportDialogProps {
    trigger?: React.ReactNode
}

export function UploadInventoryReportDialog({ trigger }: UploadInventoryReportDialogProps) {
    const [open, setOpen] = useState(false)
    const [qrOpen, setQrOpen] = useState(false)
    const [submitting, setSubmitting] = useState(false)
    const [file, setFile] = useState<File | null>(null)
    const [submitResult, setSubmitResult] = useState<{ success: boolean; message: string; data?: unknown } | null>(null)

    const processOCRResponse = (response: any) => {
        // Check for OCR functional error (processed but returned error state)
        const ocrData = response.ocr_data as any
        if (ocrData?.error === "BLURRED") {
            setSubmitResult({
                success: false,
                message: ocrData.message || "Image is too blurry. Please try again."
            })
            return
        }

        // Check for Empty Data (Failed Extraction)
        const products = ocrData.product_details || []
        if (products.length === 0) {
            setSubmitResult({
                success: false,
                message: "Could not handle this image properly. Please reupload a clearer image."
            })
            return
        }

        // Success Redirect
        const sessionData = {
            ...(ocrData || {}),
            image_path: response.path
        }
        sessionStorage.setItem("currentInvoice", JSON.stringify(sessionData))
        window.location.href = "/inventory/invoice_edit"
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!file) return

        setSubmitting(true)
        setSubmitResult(null)
        try {
            const response = await api.uploadInventoryReport(file)
            processOCRResponse(response)

        } catch (err) {
            console.error("Upload failed", err)
            setSubmitResult({
                success: false,
                message: `Failed to upload report: ${err instanceof Error ? err.message : "Unknown error"}`
            })
        } finally {
            setSubmitting(false)
        }
    }

    const resetDialog = () => {
        setSubmitResult(null)
        setFile(null)
        setSubmitting(false)
    }

    return (
        <Dialog open={open} onOpenChange={(val) => {
            setOpen(val)
            if (!val) setTimeout(resetDialog, 300) // Reset after close animation
        }}>
            {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
            <DialogContent className="sm:max-w-[425px]">
                {submitResult?.success ? (
                    <div className="flex flex-col items-center justify-center py-6 text-center space-y-4">
                        <div className="rounded-full bg-green-100 p-3 dark:bg-green-900/20">
                            <CheckCircle2 className="h-6 w-6 text-green-600 dark:text-green-500" />
                        </div>
                        <div className="space-y-2">
                            <DialogTitle>Success</DialogTitle>
                            <DialogDescription>
                                {submitResult.message}
                            </DialogDescription>
                        </div>

                        {!!submitResult.data && (
                            <div className="w-full text-left bg-muted/50 p-4 rounded-md text-sm font-mono overflow-auto max-h-[200px] border">
                                <p className="font-semibold mb-2 text-foreground">Extracted Data:</p>
                                <pre className="whitespace-pre-wrap text-xs">
                                    {typeof submitResult.data === 'string'
                                        ? submitResult.data
                                        : JSON.stringify(submitResult.data, null, 2)}
                                </pre>
                            </div>
                        )}
                        <div className="flex gap-2 mt-4">
                            <Button variant="outline" onClick={resetDialog}>
                                Upload Another
                            </Button>
                            <Button onClick={() => setOpen(false)}>
                                Close
                            </Button>
                        </div>
                    </div>
                ) : (
                    <form onSubmit={handleSubmit}>
                        <DialogHeader>
                            <DialogTitle>Upload Inventory Report</DialogTitle>
                            <DialogDescription>
                                Upload an image of your inventory report to update stocks.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="grid gap-4 py-4">
                            {submitResult && !submitResult.success && (
                                <div className="rounded-md bg-destructive/15 p-3 text-sm text-destructive flex items-center gap-2">
                                    <AlertCircle className="h-4 w-4" />
                                    {submitResult.message}
                                </div>
                            )}
                            <div className="space-y-2">
                                <label htmlFor="report-file" className="text-sm font-medium">
                                    Report Image *
                                </label>
                                <Input
                                    id="report-file"
                                    type="file"
                                    accept="image/*"
                                    onChange={(e) => {
                                        const files = e.target.files
                                        if (files && files.length > 0) {
                                            setFile(files[0])
                                            setSubmitResult(null) // Clear error on new file selection
                                        }
                                    }}
                                    required
                                />
                                <p className="text-xs text-muted-foreground">
                                    Supports JPG, PNG, WEBP.
                                </p>
                            </div>
                        </div>
                        <DialogFooter className="flex-col sm:flex-col gap-2">
                            <Button type="submit" disabled={submitting || !file} className="w-full">
                                {submitting ? (
                                    <>
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        Uploading...
                                    </>
                                ) : (
                                    <>
                                        <Upload className="mr-2 h-4 w-4" />
                                        Upload Report
                                    </>
                                )}
                            </Button>
                            
                            <div className="relative flex justify-center text-xs uppercase my-2">
                                <span className="bg-background px-2 text-muted-foreground">Or</span>
                            </div>

                            <Button 
                                type="button" 
                                variant="outline" 
                                className="w-full"
                                onClick={() => setQrOpen(true)}
                            >
                                <QrCode className="mr-2 h-4 w-4" />
                                Upload via Mobile
                            </Button>
                        </DialogFooter>
                    </form>
                )}
            </DialogContent>

            <QRCodeUpload
                open={qrOpen}
                onOpenChange={setQrOpen}
                contextType="inventory"
                contextId="inventory_upload"
                onSuccess={(res) => {
                    setQrOpen(false)
                    if (res) processOCRResponse(res)
                }}
            />
        </Dialog>
    )
}
