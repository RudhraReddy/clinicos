"use client"

import { useState, useEffect } from "react"
import { api } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useRouter } from "next/navigation"
import { FileText, Eye, Trash2 } from "lucide-react"
import { cn } from "@/lib/utils"

export default function InvoiceHistoryPage() {
    const router = useRouter()
    const [invoices, setInvoices] = useState<any[]>([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        loadInvoices()
    }, [])

    const loadInvoices = async () => {
        try {
            const data = await api.getInvoices()
            setInvoices(data)
        } catch (error) {
            console.error("Failed to load invoices", error)
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="container mx-auto py-6">
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Invoice History</h1>
                    <p className="text-muted-foreground mt-2">
                        View past uploads and their extraction logs.
                    </p>
                </div>
                <Button variant="outline" onClick={() => router.push('/inventory')}>
                    Back to Inventory
                </Button>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Uploaded Invoices</CardTitle>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Date Uploaded</TableHead>
                                <TableHead>Invoice #</TableHead>
                                <TableHead>Vendor</TableHead>
                                <TableHead>Source</TableHead>
                                <TableHead>Total Amount</TableHead>
                                <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {loading ? (
                                <TableRow>
                                    <TableCell colSpan={5} className="text-center py-4">Loading...</TableCell>
                                </TableRow>
                            ) : invoices.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={5} className="text-center py-4 text-muted-foreground">
                                        No invoices found.
                                    </TableCell>
                                </TableRow>
                            ) : (
                                invoices.map((inv) => (
                                    <TableRow key={inv.invoice_number}>
                                        <TableCell>{new Date(inv.upload_date).toLocaleDateString()}</TableCell>
                                        <TableCell className="font-medium">
                                            <div className="flex items-center gap-2">
                                                <FileText className="h-4 w-4 text-blue-500" />
                                                {inv.invoice_number}
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex flex-col">
                                                <span>{inv.vendor_name || 'N/A'}</span>
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <span className={cn(
                                                "inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ring-1 ring-inset",
                                                inv.source === 'OCR' ? "bg-blue-50 text-blue-700 ring-blue-600/20" :
                                                    inv.source === 'MANUAL' ? "bg-yellow-50 text-yellow-700 ring-yellow-600/20" :
                                                        "bg-purple-50 text-purple-700 ring-purple-600/20"
                                            )}>
                                                {inv.source || 'UNKNOWN'}
                                            </span>
                                        </TableCell>
                                        <TableCell>₹{inv.total_amount.toFixed(2)}</TableCell>
                                        <TableCell className="text-right">
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => router.push(`/inventory/history/${inv.invoice_number}`)}
                                            >
                                                <Eye className="h-4 w-4 mr-2" />
                                                View
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </div>
    )
}
