"use client"

import { useState, useEffect } from "react"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
    ZoomIn,
    ZoomOut,
    X,
    ChevronLeft,
    ChevronRight,
    Edit2,
    Loader2,
    Clock,
    User,
    FileText
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { API_BASE_URL } from "@/lib/api"

export interface ImagePreviewProps {
    // The image object to display
    image: any
    // Whether the dialog is open
    isOpen: boolean
    // Function to close the dialog
    onClose: () => void
    // Optional: Array of all images for navigation
    allImages?: any[]
    // Optional: Function to handle navigation
    onNavigate?: (direction: 'next' | 'prev') => void
    // Optional: Function to handle saving changes (notes, tags)
    // If not provided, editing is disabled
    onSave?: (image: any, notes: string, tag: string) => Promise<void>
    // Optional: Custom source URL generator (if default API logic doesn't fit)
    srcGenerator?: (image: any) => string
    // Optional: Title to display (defaults to patient name or vendor name)
    title?: string
    // Optional: Subtitle (date, etc.)
    subtitle?: string
    // Optional: Full screen mode
    fullScreen?: boolean
}

export function ImagePreviewDialog({
    image,
    isOpen,
    onClose,
    allImages,
    onNavigate,
    onSave,
    srcGenerator,
    title,
    subtitle,
    fullScreen = false
}: ImagePreviewProps) {
    const [scale, setScale] = useState(1)
    const [position, setPosition] = useState({ x: 0, y: 0 })
    const [isDragging, setIsDragging] = useState(false)
    const [dragStart, setDragStart] = useState({ x: 0, y: 0 })

    const [isEditing, setIsEditing] = useState(false)
    const [notes, setNotes] = useState("")
    const [tag, setTag] = useState("")
    const [saving, setSaving] = useState(false)

    // Reset state when image changes
    useEffect(() => {
        if (image) {
            setNotes(image.notes || "")
            setTag(image.tag || "")
            setScale(1)
            setPosition({ x: 0, y: 0 })
            setIsEditing(false)
        }
    }, [image])

    // Keyboard Navigation
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (!isOpen || !image) return

            if (e.key === 'ArrowRight' && onNavigate) {
                onNavigate('next')
            } else if (e.key === 'ArrowLeft' && onNavigate) {
                onNavigate('prev')
            } else if (e.key === 'Escape') {
                // Dialog usually handles escape, but we can ensure cleanup if needed
            }
        }

        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [isOpen, image, onNavigate])

    const handleSaveClick = async () => {
        if (!onSave) return
        setSaving(true)
        try {
            await onSave(image, notes, tag)
            setIsEditing(false)
        } catch (e) {
            console.error(e)
            // Error handling should ideally be done by the parent or toast here if we add toaster
        } finally {
            setSaving(false)
        }
    }

    const handleMouseDown = (e: React.MouseEvent) => {
        if (scale > 1) {
            setIsDragging(true)
            setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y })
        }
    }

    const handleMouseMove = (e: React.MouseEvent) => {
        if (isDragging && scale > 1) {
            setPosition({
                x: e.clientX - dragStart.x,
                y: e.clientY - dragStart.y
            })
        }
    }

    const handleMouseUp = () => {
        setIsDragging(false)
    }

    if (!image) return null

    // Determine Image Source
    let imgSrc = ""
    if (srcGenerator) {
        imgSrc = srcGenerator(image)
    } else {
        // Default logic based on known types (Patient vs Invoice)
        if (image.invoice_number) {
            // Invoice Image
            // We need extra param 'path' if it's an invoice, but usually invoice object has it?
            // checking usage in inventory/invoice_edit:
            // src={`${API_BASE_URL}/inventory/invoices/${invoiceNo}/image?path=${encodeURIComponent(imagePath)}`}
            if (image.image_path) {
                imgSrc = `${API_BASE_URL}/api/inventory/invoices/${image.invoice_number}/image?path=${encodeURIComponent(image.image_path)}`
            } else {
                // Fallback or main image endpoint
                imgSrc = `${API_BASE_URL}/api/inventory/invoices/${image.invoice_number}/image`
            }
        } else {
            // Patient Image
            imgSrc = `${API_BASE_URL}/api/patients/images/${image.id}/file`
        }
    }

    // Determine Navigation State
    const currentIndex = allImages ? allImages.findIndex(img =>
        (img.id && img.id === image.id) ||
        (img.invoice_number && img.invoice_number === image.invoice_number)
    ) : -1

    const hasNext = allImages && currentIndex !== -1 && currentIndex < allImages.length - 1
    const hasPrev = allImages && currentIndex !== -1 && currentIndex > 0

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className={fullScreen
                ? "max-w-[100vw] w-screen h-screen max-h-screen p-0 flex flex-col md:flex-row overflow-hidden border-none rounded-none data-[state=open]:slide-in-from-top-1/2 data-[state=open]:slide-in-from-left-1/2"
                : "max-w-6xl max-h-[90vh] flex flex-col md:flex-row p-0 overflow-hidden h-[80vh] data-[state=open]:slide-in-from-top-1/2 data-[state=open]:slide-in-from-left-1/2"
            }>

                {/* Left: Image Area (70%) */}
                <div className="relative flex-1 bg-black/5 overflow-hidden flex items-center justify-center">
                    <div
                        className="flex items-center justify-center w-full h-full p-4 overflow-hidden cursor-grab active:cursor-grabbing"
                        onMouseDown={handleMouseDown}
                        onMouseMove={handleMouseMove}
                        onMouseUp={handleMouseUp}
                        onMouseLeave={handleMouseUp}
                        style={{ cursor: scale > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default' }}
                    >
                        <div
                            className="transition-transform duration-75 ease-linear origin-center w-full h-full flex items-center justify-center"
                            style={{ transform: `translate(${position.x}px, ${position.y}px) scale(${scale})` }}
                        >
                            <img
                                src={imgSrc}
                                alt="Preview"
                                className="max-w-full max-h-full object-contain shadow-sm rounded-sm"
                                draggable={false}
                                onError={(e) => {
                                    (e.target as HTMLImageElement).style.display = 'none';
                                    console.error("Failed to load image", imgSrc);
                                }}
                            />
                        </div>
                    </div>

                    {/* Zoom Controls */}
                    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2 bg-background/80 backdrop-blur-sm p-1.5 rounded-full shadow border z-10 text-foreground">
                        <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" onClick={() => {
                            setScale(s => Math.max(0.5, s - 0.25))
                            if (scale <= 1.25) setPosition({ x: 0, y: 0 })
                        }}>
                            <ZoomOut className="h-4 w-4" />
                        </Button>
                        <span className="text-xs font-medium w-12 flex items-center justify-center tabular-nums">
                            {scale === 1 ? 'Fit' : `${Math.round(scale * 100)}%`}
                        </span>
                        <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" onClick={() => setScale(s => Math.min(3, s + 0.25))}>
                            <ZoomIn className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" onClick={() => {
                            setScale(1)
                            setPosition({ x: 0, y: 0 })
                        }}>
                            <X className="h-4 w-4" />
                        </Button>
                    </div>
                </div>

                {/* Right: Info Area (30%) */}
                <div className="w-full md:w-[350px] bg-background flex flex-col min-w-[300px] border-l">



                    <div className="p-6 border-b">
                        <div className="flex justify-between items-start mb-4">
                            <div>
                                <DialogTitle className="text-xl font-semibold truncate max-w-[200px]" title={title || image.patient_name || image.vendor_name}>
                                    {title || image.patient_name || image.vendor_name || "Image Preview"}
                                </DialogTitle>
                                <p className="text-sm text-muted-foreground mt-1">
                                    {subtitle || (image.timestamp ? new Date(image.timestamp).toLocaleDateString() :
                                        image.upload_date ? new Date(image.upload_date).toLocaleDateString() : "")}
                                </p>
                            </div>
                        </div>

                        <div className="space-y-4">
                            <div>
                                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Context</label>
                                <div className="mt-1 flex items-center gap-2 flex-wrap">
                                    {image.visit_id && (
                                        <Badge variant="secondary"><Clock className="h-3 w-3 mr-1" /> Visit #{image.visit_id}</Badge>
                                    )}
                                    {image.patient_id && (
                                        <Badge variant="outline"><User className="h-3 w-3 mr-1" /> {image.patient_id}</Badge>
                                    )}
                                    {image.invoice_number && (
                                        <Badge variant="outline"><FileText className="h-3 w-3 mr-1" /> #{image.invoice_number}</Badge>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="flex-1 p-6 overflow-y-auto space-y-6">
                        {isEditing ? (
                            <div className="space-y-4">
                                <div className="space-y-2">
                                    <label className="text-sm font-medium">Tag / Category</label>
                                    <Input
                                        value={tag}
                                        onChange={(e) => setTag(e.target.value)}
                                        placeholder="e.g. Prescription, Lab Report..."
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-sm font-medium">Notes</label>
                                    <Textarea
                                        value={notes}
                                        onChange={(e) => setNotes(e.target.value)}
                                        placeholder="Add notes..."
                                        className="min-h-[150px]"
                                    />
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-6">
                                <div>
                                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Category</label>
                                    <div className="mt-1 font-medium">{image.tag || "Uncategorized"}</div>
                                </div>
                                <div>
                                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Notes</label>
                                    <div className="mt-2 text-sm leading-relaxed whitespace-pre-wrap">
                                        {image.notes || <span className="text-muted-foreground italic">No notes added.</span>}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="p-6 border-t bg-muted/5 flex flex-col gap-4">
                        {/* Navigation Controls */}
                        {onNavigate && (
                            <div className="flex items-center justify-between">
                                <Button variant="outline" size="sm" onClick={() => onNavigate('prev')} disabled={!hasPrev} title="Previous">
                                    <ChevronLeft className="h-4 w-4 mr-1" /> Prev
                                </Button>
                                <span className="text-xs font-medium text-muted-foreground">
                                    {allImages && currentIndex !== -1 ? `${currentIndex + 1} / ${allImages.length}` : ''}
                                </span>
                                <Button variant="outline" size="sm" onClick={() => onNavigate('next')} disabled={!hasNext} title="Next">
                                    Next <ChevronRight className="h-4 w-4 ml-1" />
                                </Button>
                            </div>
                        )}

                        {onSave && (
                            <div>
                                {isEditing ? (
                                    <div className="flex gap-3">
                                        <Button variant="outline" className="flex-1" onClick={() => setIsEditing(false)}>Cancel</Button>
                                        <Button className="flex-1" onClick={handleSaveClick} disabled={saving}>
                                            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                            Save Changes
                                        </Button>
                                    </div>
                                ) : (
                                    <Button className="w-full" onClick={() => setIsEditing(true)}>
                                        <Edit2 className="mr-2 h-4 w-4" /> Edit Details
                                    </Button>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    )
}
