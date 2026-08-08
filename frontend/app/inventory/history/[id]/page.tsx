"use client"

import { useState, useEffect } from "react"
import { api, API_BASE_URL } from "@/lib/api" // Assuming api lib updated
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useRouter, useParams } from "next/navigation"
import { ArrowLeft, Calendar, FileText, IndianRupee, User, Download, Menu, Save, Loader2, Upload } from "lucide-react"
import { ImagePreviewDialog } from "@/components/ImagePreviewDialog"
import { useMenu } from "@/components/layout/AppShell"
import { useAuth } from "@/lib/auth_context"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

// Date-only strings ("YYYY-MM-DD") parse as UTC midnight — appending a local
// time avoids the off-by-one-day shift that causes in negative-UTC timezones.
const parseDateOnly = (dateStr?: string | null) => {
    if (!dateStr) return null
    return new Date(dateStr.includes('T') ? dateStr : `${dateStr}T00:00:00`)
}

// const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api'
// We can use API_BASE_URL directly

export default function InvoiceDetailPage() {
    const router = useRouter()
    const params = useParams()
    const invoiceId = params.id as string
    const { openMenu } = useMenu()
    const { role } = useAuth()

    const [invoice, setInvoice] = useState<any>(null)
    const [items, setItems] = useState<any[]>([])
    const [loading, setLoading] = useState(true)
    const [viewImage, setViewImage] = useState(false)

    const [paidDate, setPaidDate] = useState("")
    const [paymentMode, setPaymentMode] = useState<'cash' | 'upi' | ''>('')
    const [savingPayment, setSavingPayment] = useState(false)

    const [changingImage, setChangingImage] = useState(false)
    const [imageVersion, setImageVersion] = useState(0)

    useEffect(() => {
        if (invoiceId) {
            api.getInvoiceDetail(invoiceId).then(data => {
                setInvoice(data.invoice)
                setItems(data.items)
                setPaidDate(data.invoice.paid_date || "")
                setPaymentMode(data.invoice.payment_mode || '')
                setLoading(false)
            }).catch(err => {
                console.error(err)
                setLoading(false)
            })
        }
    }, [invoiceId])

    const handleSavePayment = async () => {
        setSavingPayment(true)
        try {
            await api.updateInvoice(invoiceId, {
                paid_date: paidDate || null,
                payment_mode: paymentMode || null,
            })
            setInvoice((prev: any) => ({ ...prev, paid_date: paidDate || null, payment_mode: paymentMode || null }))
            toast.success("Payment details saved")
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Failed to save payment details")
        } finally {
            setSavingPayment(false)
        }
    }

    const handleChangeImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return
        setChangingImage(true)
        try {
            const res = await api.uploadInventoryReport(file)
            await api.updateInvoice(invoiceId, { image_path: res.path })
            setInvoice((prev: any) => ({ ...prev, has_image: true }))
            setImageVersion(v => v + 1)
            toast.success("Invoice image updated")
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Failed to update image")
        } finally {
            setChangingImage(false)
            e.target.value = ''
        }
    }

    if (loading) return <div className="p-8">Loading details...</div>
    if (!invoice) return <div className="p-8">Invoice not found</div>

    const imageUrl = `${API_BASE_URL}/api/inventory/invoices/${invoiceId}/image`

    return (
        <div className="container mx-auto py-6 space-y-6">
            <div className="flex items-center gap-4">
                <button
                    type="button"
                    onClick={openMenu}
                    className="shrink-0 rounded-md p-1 text-foreground hover:bg-accent transition-colors"
                >
                    <Menu className="h-6 w-6" />
                    <span className="sr-only">Toggle Menu</span>
                </button>
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
                                        srcGenerator={() => `${API_BASE_URL}/api/inventory/invoices/${invoiceId}/image?v=${imageVersion}`}
                                    />
                                </>
                            ) : (
                                <div className="p-4 bg-muted/20 border rounded text-center text-sm text-muted-foreground">
                                    No Image Available
                                </div>
                            )}

                            {role === 'admin' && (
                                <>
                                    <input
                                        id="change-invoice-image"
                                        type="file"
                                        accept="image/*"
                                        className="hidden"
                                        onChange={handleChangeImage}
                                    />
                                    <Button
                                        variant="outline"
                                        className="w-full"
                                        disabled={changingImage}
                                        onClick={() => document.getElementById('change-invoice-image')?.click()}
                                    >
                                        {changingImage ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                                        {invoice.has_image ? "Replace Image" : "Add Image"}
                                    </Button>
                                </>
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
                        <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-4">
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
                            <div>
                                <p className="text-sm font-medium text-muted-foreground">Invoice Date</p>
                                <p className="text-lg">{parseDateOnly(invoice.invoice_date)?.toLocaleDateString() ?? "N/A"}</p>
                            </div>
                            <div>
                                <p className="text-sm font-medium text-muted-foreground mb-1">Paid Date</p>
                                <Input
                                    type="date"
                                    value={paidDate}
                                    onChange={e => setPaidDate(e.target.value)}
                                    className="h-9"
                                />
                            </div>
                            <div>
                                <p className="text-sm font-medium text-muted-foreground mb-1">Pay Type</p>
                                <div className="inline-flex items-center rounded-md border bg-muted p-0.5 h-9 w-full">
                                    {(['cash', 'upi'] as const).map(mode => (
                                        <button
                                            key={mode}
                                            type="button"
                                            onClick={() => setPaymentMode(mode)}
                                            className={cn(
                                                "flex-1 h-full rounded-sm text-xs font-medium transition-colors capitalize",
                                                paymentMode === mode
                                                    ? "bg-background text-foreground shadow-sm"
                                                    : "text-muted-foreground hover:text-foreground"
                                            )}
                                        >
                                            {mode}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div className="col-span-2 md:col-span-3 flex justify-end">
                                <Button size="sm" onClick={handleSavePayment} disabled={savingPayment}>
                                    {savingPayment ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-2 h-3.5 w-3.5" />}
                                    Save Payment Details
                                </Button>
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
