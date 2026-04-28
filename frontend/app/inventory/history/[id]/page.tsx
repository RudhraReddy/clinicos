"use client"

import { useState, useEffect } from "react"
import { api, API_BASE_URL } from "@/lib/api" // Assuming api lib updated
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useRouter, useParams } from "next/navigation"
import { ArrowLeft, Calendar, FileText, IndianRupee, User, Download } from "lucide-react"
import { ImagePreviewDialog } from "@/components/ImagePreviewDialog"

// const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api'
// We can use API_BASE_URL directly

export default function InvoiceDetailPage() {
    const router = useRouter()
    const params = useParams()
    const invoiceId = params.id as string

    const [invoice, setInvoice] = useState<any>(null)
    const [items, setItems] = useState<any[]>([])
    const [loading, setLoading] = useState(true)
    const [viewImage, setViewImage] = useState(false)

    useEffect(() => {
        if (invoiceId) {
            // We need a new endpoint for details? OR just reuse list?
            // Actually, let's assume we implement getInvoiceDetail(id)
            // For now, I'll mock or the backend needs to support it. 
            // Based on plan: GET /inventory/invoices/<id>
            api.getInvoiceDetail(invoiceId).then(data => {
                setInvoice(data.invoice)
                setItems(data.items)
                setLoading(false)
            }).catch(err => {
                console.error(err)
                setLoading(false)
            })
        }
    }, [invoiceId])

    if (loading) return <div className="p-8">Loading details...</div>
    if (!invoice) return <div className="p-8">Invoice not found</div>

    const imageUrl = `${API_BASE_URL}/api/inventory/invoices/${invoiceId}/image`

    return (
        <div className="container mx-auto py-6 space-y-6">
            <div className="flex items-center gap-4">
                <Button variant="ghost" onClick={() => router.back()}>
                    <ArrowLeft className="h-4 w-4 mr-2" />
                    Back
                </Button>
                <h1 className="text-2xl font-bold">Invoice #{invoice.invoice_number}</h1>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Helper: Actions */}
                <div className="md:col-span-1 space-y-4">
                    <Card>
                        <CardHeader>
                            <CardTitle>Actions</CardTitle>
                        </CardHeader>
                        <CardContent className="flex flex-col gap-3">
                            {invoice.has_image ? (
                                <>
                                    <Button className="w-full" onClick={() => setViewImage(true)}>
                                        <FileText className="mr-2 h-4 w-4" />
                                        View Original Invoice
                                    </Button>
                                    <ImagePreviewDialog
                                        image={{
                                            invoice_number: invoice.invoice_number,
                                            // The backend logic for history might strictly rely on invoice_number and default path
                                            // existing code used: ${API_BASE_URL}/api/inventory/invoices/${invoiceId}/image
                                            // ImagePreviewDialog handles this if invoice_number is present
                                        }}
                                        isOpen={viewImage}
                                        onClose={() => setViewImage(false)}
                                        title={`Invoice #${invoice.invoice_number}`}
                                        subtitle={invoice.vendor_name}
                                        srcGenerator={() => `${API_BASE_URL}/api/inventory/invoices/${invoiceId}/image`}
                                    />
                                </>
                            ) : (
                                <div className="p-4 bg-muted/20 border rounded text-center text-sm text-muted-foreground">
                                    No Image Available
                                </div>
                            )}

                            <Button variant="outline" className="w-full" onClick={() => window.location.href = `${API_BASE_URL}/api/inventory/invoices/${invoiceId}/export`}>
                                <Download className="mr-2 h-4 w-4" />
                                Export to Excel
                            </Button>
                        </CardContent>
                    </Card>
                </div>

                {/* Metadata & Items */}
                <div className="md:col-span-2 space-y-6">
                    <Card>
                        <CardHeader>
                            <CardTitle>Summary</CardTitle>
                            <CardDescription>Upload Date: {new Date(invoice.upload_date).toLocaleString()}</CardDescription>
                        </CardHeader>
                        <CardContent className="grid grid-cols-2 gap-4">
                            <div>
                                <p className="text-sm font-medium text-muted-foreground">Vendor</p>
                                <p className="text-lg">{invoice.vendor_name || "Unknown"}</p>
                            </div>
                            <div>
                                <p className="text-sm font-medium text-muted-foreground">GST Number</p>
                                <p className="text-lg">{invoice.gst_number || "N/A"}</p>
                            </div>
                            <div>
                                <p className="text-sm font-medium text-muted-foreground">Total Amount</p>
                                <p className="text-lg font-bold text-green-600">₹{invoice.total_amount?.toFixed(2)}</p>
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle>Extracted Items Log</CardTitle>
                            <CardDescription>Items added to inventory from this invoice.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Product Name</TableHead>
                                        <TableHead>Pack</TableHead>
                                        <TableHead>Batch</TableHead>
                                        <TableHead>Exp</TableHead>
                                        <TableHead>HSN</TableHead>
                                        <TableHead className="text-right">Qty</TableHead>
                                        <TableHead className="text-right">Free</TableHead>
                                        <TableHead className="text-right">Rate</TableHead>
                                        <TableHead className="text-right">MRP</TableHead>
                                        <TableHead className="text-right">GST%</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {items.map((item, i) => (
                                        <TableRow key={i}>
                                            <TableCell className="font-medium">
                                                {item.product_name}
                                                <div className="text-xs text-muted-foreground">{item.manufacturer}</div>
                                            </TableCell>
                                            <TableCell>{item.pack_size || '-'}</TableCell>
                                            <TableCell>{item.batch_number || '-'}</TableCell>
                                            <TableCell>{item.expiry_date || '-'}</TableCell>
                                            <TableCell>{item.hsn_code || '-'}</TableCell>
                                            <TableCell className="text-right font-medium">{item.quantity}</TableCell>
                                            <TableCell className="text-right text-muted-foreground">{item.free_quantity > 0 ? item.free_quantity : '-'}</TableCell>
                                            <TableCell className="text-right">₹{item.purchase_rate}</TableCell>
                                            <TableCell className="text-right">₹{item.mrp}</TableCell>
                                            <TableCell className="text-right">{item.gst_rate}%</TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    )
}
