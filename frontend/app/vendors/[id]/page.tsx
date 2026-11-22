"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { toast } from "sonner"
import { ArrowLeft, Loader2, Menu, Pencil, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useMenu } from "@/components/layout/AppShell"
import { VendorFormDialog, apiErrorMessage } from "@/components/VendorFormDialog"
import { useAuth } from "@/lib/auth_context"
import { api, type VendorDetail } from "@/lib/api"
import { formatINR } from "@/lib/utils"

// "YYYY-MM-DD" → "22 Nov 2026" without the UTC-midnight off-by-one shift.
function formatDate(d?: string | null) {
    if (!d) return "—"
    const date = new Date(d.includes("T") ? d : `${d}T00:00:00`)
    return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
}

function formatQty(n: number) {
    return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")
}

function Detail({ label, value }: { label: string; value?: string | null }) {
    return (
        <div className="min-w-0">
            <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">{label}</p>
            <p className="text-sm break-words whitespace-pre-wrap">{value || <span className="text-muted-foreground">—</span>}</p>
        </div>
    )
}

export default function VendorDetailPage() {
    const router = useRouter()
    const params = useParams()
    const vendorId = params.id as string
    const { openMenu } = useMenu()
    const { role } = useAuth()

    const [data, setData] = useState<VendorDetail | null>(null)
    const [loading, setLoading] = useState(true)
    const [editing, setEditing] = useState(false)
    const [confirmDelete, setConfirmDelete] = useState(false)
    const [deleting, setDeleting] = useState(false)

    const load = async () => {
        try {
            setData(await api.getVendor(vendorId))
        } catch (err) {
            toast.error(apiErrorMessage(err, "Could not load vendor"))
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => { load() }, [vendorId]) // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (!confirmDelete) return
        const t = setTimeout(() => setConfirmDelete(false), 4000)
        return () => clearTimeout(t)
    }, [confirmDelete])

    const handleDelete = async () => {
        if (!data) return
        if (!confirmDelete) { setConfirmDelete(true); return }
        setDeleting(true)
        try {
            const res = await api.deleteVendor(data.vendor.id)
            toast.success(res.message)
            router.push("/vendors")
        } catch (err) {
            toast.error(apiErrorMessage(err, "Could not delete vendor"))
            setDeleting(false)
            setConfirmDelete(false)
        }
    }

    const header = (title: string) => (
        <div className="flex items-center gap-3 flex-wrap">
            <button
                type="button"
                onClick={openMenu}
                className="shrink-0 rounded-md p-1 text-foreground hover:bg-accent transition-colors"
            >
                <Menu className="h-6 w-6" />
                <span className="sr-only">Toggle Menu</span>
            </button>
            <Button variant="ghost" onClick={() => router.push("/vendors")}>
                <ArrowLeft className="h-4 w-4 mr-2" /> Vendors
            </Button>
            <h1 className="text-2xl font-bold tracking-tight min-w-0 break-words">{title}</h1>
            {data && (
                <div className="ml-auto flex items-center gap-2">
                    {role === "admin" && data.summary.invoice_count === 0 && (
                        <Button variant={confirmDelete ? "destructive" : "outline"} size="sm" onClick={handleDelete} disabled={deleting}>
                            {deleting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Trash2 className="mr-1.5 h-3.5 w-3.5" />}
                            {confirmDelete ? "Click again to delete" : "Delete"}
                        </Button>
                    )}
                    <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                        <Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit
                    </Button>
                </div>
            )}
        </div>
    )

    if (loading) {
        return <div className="space-y-6">{header("Vendor")}<div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div></div>
    }
    if (!data) {
        return <div className="space-y-6">{header("Vendor")}<p className="text-center text-muted-foreground py-16">Vendor not found.</p></div>
    }

    const { vendor, summary, invoices, items } = data

    return (
        <div className="space-y-6">
            {header(vendor.name)}

            <Card>
                <CardContent className="pt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <Detail label="DL number" value={vendor.dl_number} />
                    <Detail label="GST number" value={vendor.gst_number} />
                    <Detail label="Contact" value={vendor.contact} />
                    <Detail label="Notes" value={vendor.notes} />
                    {vendor.aliases?.length > 0 && (
                        <div className="sm:col-span-2 lg:col-span-4">
                            <Detail label="Also invoiced as" value={vendor.aliases.join(", ")} />
                        </div>
                    )}
                </CardContent>
            </Card>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Total purchases</CardTitle></CardHeader>
                    <CardContent>
                        <p className="text-2xl font-bold tabular-nums">{formatINR(summary.total_amount)}</p>
                        <p className="text-xs text-muted-foreground">{summary.invoice_count} invoice{summary.invoice_count !== 1 ? "s" : ""}</p>
                    </CardContent>
                </Card>
                <Card className={summary.unpaid_amount > 0 ? "border-red-300 dark:border-red-900" : undefined}>
                    <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Unpaid</CardTitle></CardHeader>
                    <CardContent>
                        <p className={`text-2xl font-bold tabular-nums ${summary.unpaid_amount > 0 ? "text-red-600 dark:text-red-400" : ""}`}>
                            {formatINR(summary.unpaid_amount)}
                        </p>
                        <p className="text-xs text-muted-foreground">{summary.unpaid_count} unpaid invoice{summary.unpaid_count !== 1 ? "s" : ""}</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Paid</CardTitle></CardHeader>
                    <CardContent>
                        <p className="text-2xl font-bold tabular-nums">{formatINR(summary.paid_amount)}</p>
                        <p className="text-xs text-muted-foreground">{summary.invoice_count - summary.unpaid_count} paid invoice{summary.invoice_count - summary.unpaid_count !== 1 ? "s" : ""}</p>
                    </CardContent>
                </Card>
            </div>

            <Tabs defaultValue="invoices">
                <TabsList>
                    <TabsTrigger value="invoices">Invoices ({invoices.length})</TabsTrigger>
                    <TabsTrigger value="items">Items ({items.length})</TabsTrigger>
                </TabsList>

                <TabsContent value="invoices">
                    <Card>
                        <CardContent className="p-0">
                            {invoices.length === 0 ? (
                                <p className="text-center text-muted-foreground py-12">No invoices from this vendor yet.</p>
                            ) : (
                                <div className="overflow-x-auto">
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Invoice no</TableHead>
                                                <TableHead>Invoice date</TableHead>
                                                <TableHead>Clinic</TableHead>
                                                <TableHead className="text-right">Amount</TableHead>
                                                <TableHead>Payment</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {invoices.map(inv => (
                                                <TableRow
                                                    key={inv.invoice_number}
                                                    className="cursor-pointer"
                                                    onClick={() => router.push(`/inventory/history/${encodeURIComponent(inv.invoice_number)}`)}
                                                >
                                                    <TableCell className="font-medium">{inv.invoice_number}</TableCell>
                                                    <TableCell>{formatDate(inv.invoice_date || inv.upload_date)}</TableCell>
                                                    <TableCell className="text-muted-foreground">{inv.location_name || "—"}</TableCell>
                                                    <TableCell className="text-right tabular-nums">{formatINR(inv.total_amount)}</TableCell>
                                                    <TableCell>
                                                        {inv.paid_date ? (
                                                            <span className="text-sm">
                                                                <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 hover:bg-green-100 mr-2">Paid</Badge>
                                                                <span className="text-muted-foreground">
                                                                    {formatDate(inv.paid_date)}{inv.payment_mode ? ` · ${inv.payment_mode.toUpperCase()}` : ""}
                                                                </span>
                                                            </span>
                                                        ) : (
                                                            <Badge className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 hover:bg-red-100">Unpaid</Badge>
                                                        )}
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                    {invoices.length > 0 && (
                        <p className="text-xs text-muted-foreground mt-2">Open an invoice to mark it paid.</p>
                    )}
                </TabsContent>

                <TabsContent value="items">
                    <Card>
                        <CardContent className="p-0">
                            {items.length === 0 ? (
                                <p className="text-center text-muted-foreground py-12">No items bought from this vendor yet.</p>
                            ) : (
                                <div className="overflow-x-auto">
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Item</TableHead>
                                                <TableHead>Manufacturer</TableHead>
                                                <TableHead className="text-right">Qty bought</TableHead>
                                                <TableHead className="text-right">Invoices</TableHead>
                                                <TableHead>Last bought</TableHead>
                                                <TableHead className="text-right">Last rate</TableHead>
                                                <TableHead className="text-right">MRP</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {items.map(it => (
                                                <TableRow key={it.product_id}>
                                                    <TableCell className="font-medium">
                                                        {it.item_name}
                                                        {it.pack_size && <span className="text-muted-foreground font-normal"> · {it.pack_size}</span>}
                                                    </TableCell>
                                                    <TableCell className="text-muted-foreground">{it.manufacturer || "—"}</TableCell>
                                                    <TableCell className="text-right tabular-nums">
                                                        {formatQty(it.quantity)}
                                                        {it.free_quantity > 0 && <span className="text-xs text-muted-foreground"> (incl. {formatQty(it.free_quantity)} free)</span>}
                                                    </TableCell>
                                                    <TableCell className="text-right tabular-nums">{it.invoice_count}</TableCell>
                                                    <TableCell>{formatDate(it.last_date)}</TableCell>
                                                    <TableCell className="text-right tabular-nums">{it.last_rate != null ? formatINR(it.last_rate) : "—"}</TableCell>
                                                    <TableCell className="text-right tabular-nums">{it.last_mrp != null ? formatINR(it.last_mrp) : "—"}</TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                    {items.length > 0 && (
                        <p className="text-xs text-muted-foreground mt-2">Quantities are in packs, as entered on the invoices.</p>
                    )}
                </TabsContent>
            </Tabs>

            <VendorFormDialog
                open={editing}
                onOpenChange={setEditing}
                vendor={vendor}
                onSaved={() => load()}
            />
        </div>
    )
}
