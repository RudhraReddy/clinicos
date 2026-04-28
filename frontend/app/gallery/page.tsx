"use client"

import { useState, useEffect } from "react"
import { api, API_BASE_URL } from "@/lib/api"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Search, Image as ImageIcon, Calendar, User, FileText } from "lucide-react"
import { ImagePreviewDialog } from "@/components/ImagePreviewDialog"

export default function GalleryPage() {
    const [images, setImages] = useState<any[]>([])
    const [filteredImages, setFilteredImages] = useState<any[]>([])
    const [loading, setLoading] = useState(true)
    const [searchQuery, setSearchQuery] = useState("")
    const [viewImage, setViewImage] = useState<any | null>(null)

    useEffect(() => {
        loadImages()
    }, [])

    useEffect(() => {
        if (!searchQuery) {
            // Exclude prescriptions from the main "Patient Images" tab
            setFilteredImages(images.filter(img => !img.tag || !img.tag.startsWith('Prescription')))
        } else {
            const lower = searchQuery.toLowerCase()
            setFilteredImages(images.filter(img =>
                (!img.tag || !img.tag.startsWith('Prescription')) && (
                    img.patient_name?.toLowerCase().includes(lower) ||
                    img.patient_id?.toLowerCase().includes(lower) ||
                    img.notes?.toLowerCase().includes(lower)
                )
            ))
        }
    }, [searchQuery, images])

    const [invoiceImages, setInvoiceImages] = useState<any[]>([])
    const [filteredInvoiceImages, setFilteredInvoiceImages] = useState<any[]>([])
    const [invoiceQuery, setInvoiceQuery] = useState("")

    useEffect(() => {
        loadImages()
        loadInvoiceImages()
    }, [])

    useEffect(() => {
        if (!invoiceQuery) {
            setFilteredInvoiceImages(invoiceImages)
        } else {
            const lower = invoiceQuery.toLowerCase()
            setFilteredInvoiceImages(invoiceImages.filter(img =>
                img.invoice_number?.toLowerCase().includes(lower) ||
                img.vendor_name?.toLowerCase().includes(lower)
            ))
        }
    }, [invoiceQuery, invoiceImages])

    const [filteredPrescriptions, setFilteredPrescriptions] = useState<any[]>([])
    const [prescriptionQuery, setPrescriptionQuery] = useState("")

    useEffect(() => {
        // Prescriptions Logic (already correct)
        if (!prescriptionQuery) {
            setFilteredPrescriptions(images.filter(img => img.tag && img.tag.startsWith('Prescription')))
        } else {
            const lower = prescriptionQuery.toLowerCase()
            setFilteredPrescriptions(images.filter(img =>
                img.tag && img.tag.startsWith('Prescription') && (
                    img.patient_name?.toLowerCase().includes(lower) ||
                    img.patient_id?.toLowerCase().includes(lower) ||
                    img.notes?.toLowerCase().includes(lower)
                )
            ))
        }
    }, [prescriptionQuery, images])

    const loadImages = async () => {
        try {
            const data = await api.getAllPatientImages()
            setImages(data)
            // Initial split
            setFilteredImages(data.filter((img: any) => !img.tag || !img.tag.startsWith('Prescription')))
            setFilteredPrescriptions(data.filter((img: any) => img.tag && img.tag.startsWith('Prescription')))
        } catch (error) {
            console.error(error)
        } finally {
            setLoading(false)
        }
    }

    const loadInvoiceImages = async () => {
        try {
            const data = await api.getInvoices()
            const withImages = data.filter((inv: any) => inv.has_image)
            setInvoiceImages(withImages)
            setFilteredInvoiceImages(withImages)
        } catch (e) {
            console.error(e)
        }
    }

    // Reuse viewImage state for both types? 
    // PatientImage has: id, patient_name, notes, timestamp.
    // InvoiceImage has: invoice_number, vendor_name, upload_date.
    // Let's make viewImage generic or check type.
    const [viewInvoice, setViewInvoice] = useState<any | null>(null)

    return (
        <div className="container mx-auto py-6 space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Patient Image Gallery</h1>
                    <p className="text-muted-foreground">View all uploaded patient photos and reports.</p>
                </div>
            </div>

            <Tabs defaultValue="prescriptions" className="space-y-4">
                <TabsList>
                    <TabsTrigger value="patients">Patient Images</TabsTrigger>
                    <TabsTrigger value="prescriptions">Prescriptions</TabsTrigger>
                    <TabsTrigger value="invoices">Invoice Images</TabsTrigger>
                </TabsList>


                <TabsContent value="prescriptions">
                    <Card>
                        <CardHeader>
                            <div className="flex items-center gap-4">
                                <div className="relative flex-1 max-w-sm">
                                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                                    <Input
                                        placeholder="Search prescriptions..."
                                        className="pl-9"
                                        value={prescriptionQuery}
                                        onChange={(e) => setPrescriptionQuery(e.target.value)}
                                    />
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent>
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead className="w-[100px]">Image</TableHead>
                                        <TableHead>Date</TableHead>
                                        <TableHead>Patient</TableHead>
                                        <TableHead>Side</TableHead>
                                        <TableHead>Notes</TableHead>
                                        <TableHead className="text-right">Visit ID</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {loading ? (
                                        <TableRow>
                                            <TableCell colSpan={5} className="text-center py-8">Loading...</TableCell>
                                        </TableRow>
                                    ) : filteredPrescriptions.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                                                No prescriptions found.
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        filteredPrescriptions.map((img) => (
                                            <TableRow key={img.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setViewImage(img)}>
                                                <TableCell>
                                                    <div className="h-12 w-12 rounded overflow-hidden bg-muted border">
                                                        <img
                                                            src={`${API_BASE_URL}/api/patients/images/${img.id}/file`}
                                                            alt="Thumbnail"
                                                            className="h-full w-full object-cover"
                                                        />
                                                    </div>
                                                </TableCell>
                                                <TableCell className="font-medium whitespace-nowrap">
                                                    {new Date(img.timestamp).toLocaleDateString()}
                                                    <div className="text-xs text-muted-foreground">{new Date(img.timestamp).toLocaleTimeString()}</div>
                                                </TableCell>
                                                <TableCell>
                                                    <div className="font-medium">{img.patient_name}</div>
                                                    <div className="text-xs text-muted-foreground">ID: {img.patient_id}</div>
                                                </TableCell>
                                                <TableCell>
                                                    <div className="font-medium">
                                                        {img.tag?.includes('Front') ? 'Front' : img.tag?.includes('Back') ? 'Back' : 'Standard'}
                                                    </div>
                                                </TableCell>
                                                <TableCell className="max-w-xs truncate text-muted-foreground">
                                                    {img.notes || "-"}
                                                </TableCell>
                                                <TableCell className="text-right font-mono text-xs text-muted-foreground">
                                                    {img.visit_id || "-"}
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="patients">
                    <Card>
                        <CardHeader>
                            <div className="flex items-center gap-4">
                                <div className="relative flex-1 max-w-sm">
                                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                                    <Input
                                        placeholder="Search by patient name, ID, or notes..."
                                        className="pl-9"
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                    />
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent>
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead className="w-[100px]">Preview</TableHead>
                                        <TableHead>Date</TableHead>
                                        <TableHead>Patient</TableHead>
                                        <TableHead>Notes</TableHead>
                                        <TableHead className="text-right">Visit ID</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {loading ? (
                                        <TableRow>
                                            <TableCell colSpan={5} className="text-center py-8">Loading...</TableCell>
                                        </TableRow>
                                    ) : filteredImages.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                                                No images found.
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        filteredImages.map((img) => (
                                            <TableRow key={img.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setViewImage(img)}>
                                                <TableCell>
                                                    <div className="h-12 w-12 rounded overflow-hidden bg-muted border">
                                                        <img
                                                            src={`${API_BASE_URL}/api/patients/images/${img.id}/file`}
                                                            alt="Thumbnail"
                                                            className="h-full w-full object-cover"
                                                        />
                                                    </div>
                                                </TableCell>
                                                <TableCell className="font-medium whitespace-nowrap">
                                                    {new Date(img.timestamp).toLocaleDateString()}
                                                    <div className="text-xs text-muted-foreground">{new Date(img.timestamp).toLocaleTimeString()}</div>
                                                </TableCell>
                                                <TableCell>
                                                    <div className="font-medium">{img.patient_name}</div>
                                                    <div className="text-xs text-muted-foreground">ID: {img.patient_id}</div>
                                                </TableCell>
                                                <TableCell className="max-w-xs truncate text-muted-foreground">
                                                    {img.notes || "-"}
                                                </TableCell>
                                                <TableCell className="text-right font-mono text-xs text-muted-foreground">
                                                    {img.visit_id || "-"}
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="invoices">
                    <Card>
                        <CardHeader>
                            <div className="flex items-center gap-4">
                                <div className="relative flex-1 max-w-sm">
                                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                                    <Input
                                        placeholder="Search by invoice # or vendor..."
                                        className="pl-9"
                                        value={invoiceQuery}
                                        onChange={(e) => setInvoiceQuery(e.target.value)}
                                    />
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent>
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead className="w-[100px]">Preview</TableHead>
                                        <TableHead>Date Uploaded</TableHead>
                                        <TableHead>Invoice #</TableHead>
                                        <TableHead>Vendor</TableHead>
                                        <TableHead className="text-right">Amount</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {filteredInvoiceImages.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                                                No invoice images found.
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        filteredInvoiceImages.map((inv) => (
                                            <TableRow key={inv.invoice_number} className="cursor-pointer hover:bg-muted/50" onClick={() => setViewInvoice(inv)}>
                                                <TableCell>
                                                    <div className="h-12 w-12 rounded overflow-hidden bg-muted border flex items-center justify-center relative">
                                                        <FileText className="h-6 w-6 text-muted-foreground" />
                                                        {/* We can't easily show thumbnail for generic files unless we fetch it. 
                                                            But user wanted "gallery". Let's try to show image if possible.
                                                            The API is /inventory/invoices/<id>/image.
                                                        */}
                                                        <img
                                                            src={`${API_BASE_URL}/api/inventory/invoices/${inv.invoice_number}/image`}
                                                            className="h-full w-full object-cover absolute opacity-0"
                                                            onLoad={(e) => (e.target as HTMLImageElement).style.opacity = '1'}
                                                        />
                                                    </div>
                                                </TableCell>
                                                <TableCell className="font-medium whitespace-nowrap">
                                                    {new Date(inv.upload_date).toLocaleDateString()}
                                                </TableCell>
                                                <TableCell>
                                                    <div className="font-medium">{inv.invoice_number}</div>
                                                </TableCell>
                                                <TableCell>
                                                    {inv.vendor_name}
                                                </TableCell>
                                                <TableCell className="text-right font-medium">
                                                    ₹{inv.total_amount?.toFixed(2)}
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>



            {/* View Image Dialog (Reused Logic) */}
            <ImagePreviewDialog
                image={viewImage}
                isOpen={!!viewImage}
                onClose={() => setViewImage(null)}
                // We could pass filteredImages as allImages for navigation, but need to be careful with types
                allImages={filteredImages}
                onNavigate={(dir) => {
                    if (!viewImage || filteredImages.length <= 1) return
                    const idx = filteredImages.findIndex(img => img.id === viewImage.id)
                    if (idx < 0) return
                    if (dir === 'next') setViewImage(filteredImages[(idx + 1) % filteredImages.length])
                    else setViewImage(filteredImages[(idx - 1 + filteredImages.length) % filteredImages.length])
                }}
                onSave={async (img, notes, tag) => {
                    // This is for Patient Images
                    await api.updatePatientImage(img.id, { notes, tag })
                    // Refresh local state? logic was: loadImages() in doctor
                    // Here we might need to update state manually or reload
                    const newImages = images.map(i => i.id === img.id ? { ...i, notes, tag } : i)
                    setImages(newImages)
                    // Re-filter handled by useEffect but depends on query, simpler to just reload or update local
                    setViewImage({ ...img, notes, tag })
                }}
                title={viewImage?.patient_name}
            />

            {/* Invoice Image Dialog */}
            <ImagePreviewDialog
                image={viewInvoice}
                isOpen={!!viewInvoice}
                onClose={() => setViewInvoice(null)}
                // Invoice navigation
                allImages={filteredInvoiceImages}
                onNavigate={(dir) => {
                    if (!viewInvoice || filteredInvoiceImages.length <= 1) return
                    const idx = filteredInvoiceImages.findIndex(inv => inv.invoice_number === viewInvoice.invoice_number)
                    if (idx < 0) return
                    if (dir === 'next') setViewInvoice(filteredInvoiceImages[(idx + 1) % filteredInvoiceImages.length])
                    else setViewInvoice(filteredInvoiceImages[(idx - 1 + filteredInvoiceImages.length) % filteredInvoiceImages.length])
                }}
                // No save for invoices yet as per plan, but we can enable read-only view
                title={viewInvoice?.vendor_name}
                subtitle={viewInvoice ? `Invoice #${viewInvoice.invoice_number} - ${new Date(viewInvoice.upload_date).toLocaleDateString()}` : undefined}
            />
        </div >
    )
}
