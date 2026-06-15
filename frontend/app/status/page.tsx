"use client"
import React, { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  TrendingUp, TrendingDown, DollarSign, Stethoscope, ShoppingBag, MapPin,
  Package, Calendar, CreditCard, Landmark, Wallet, Plus,
  PieChart, ListOrdered, Activity, Receipt, QrCode, Trash2, Image as ImageIcon,
  ArrowUpRight, ArrowDownRight, Smartphone, Briefcase, BarChart3, Percent,
  CheckCircle2, AlertCircle, FileText, CalendarDays, Clock, Users, Loader2,
  XCircle, AlertOctagon, MinusCircle, AlertTriangle, ShieldAlert
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { api } from "@/lib/api"

import { ResponsiveContainer, PieChart as RePie, Pie, Cell, Tooltip as ReTooltip } from 'recharts'

const fmt = (n: number) => `₹${(n || 0).toLocaleString('en-IN')}`

export default function StatusPage() {
  // Top Level Controls
  const [loc, setLoc] = useState<number | 'all'>('all')
  const [locations, setLocations] = useState<{ id: number; name: string }[]>([])

  const [period, setPeriod] = useState("month")
  const [viewMode, setViewMode] = useState("money") // New: money | inventory
  const [alertTab, setAlertTab] = useState("all") // Current sub-alert filter in inventory

  const handleViewChange = (val: string) => {
    setViewMode(val)
    // Auto fallback if current period is not allowed in inventory mode
    if (val === "inventory" && (period === "day" || period === "week")) {
      setPeriod("month")
    }
  }
  
  // Server Data States
  const [isLoading, setIsLoading] = useState(true)
  const [apiData, setApiData] = useState<any>(null)
  const [ledger, setLedger] = useState<any[]>([])

  // Fetch active locations once on mount
  useEffect(() => {
    api.getLocations()
      .then(locs => setLocations(locs.filter((l: { id: number; name: string; is_active: boolean }) => l.is_active)))
      .catch(() => {})
  }, [])

  // Initial Fetch logic
  const fetchData = async () => {
    setIsLoading(true)
    try {
      const analytics = await api.getInventoryAnalytics(loc)
      const ledgerData = await api.getLedger(loc)
      setApiData(analytics)
      setLedger(ledgerData)
    } catch (error) {
      console.error("Failed fetching realtime metrics:", error)
    } finally {
      setIsLoading(false)
    }
  }

  // Refetch on filter change
  useEffect(() => {
    fetchData()
  }, [loc])

  // Fallback empty state while loading or error
  const defaultSlice = { income: 0, outcome: 0, net: 0, pharmRev: 0, consultRev: 0, visits: 0, pBills: 0, paid: 0, marginPct: 0 }
  
  // Extract specific slice (handling "day" mapping to "today" in backend key)
  const backendKey = period === "day" ? "today" : period
  const sliceData = apiData ? (apiData[backendKey] || defaultSlice) : defaultSlice
  
  // Computed values for logic stability
  const s = {
    ...sliceData,
    // Fallback logic ensuring we don't show NaN
    marginPct: sliceData.income > 0 ? Math.round(((sliceData.income - sliceData.outcome) / sliceData.income) * 100) : 0
  }

  // Dynamic Expense Breakdown from Server Pie data
  // Color cycle for visualization
  const colorMap = ["bg-blue-500", "bg-indigo-500", "bg-violet-500", "bg-amber-500", "bg-slate-400"]
  const serverPie = apiData?.ledger_expense_pie || []
  const totalPieVal = serverPie.reduce((acc:number, c:any)=> acc + (c.value || 0), 0) || 1
  
  // REFACTORED PIE CHART DATA - UNIFIED IN AND OUT FLOWS AS REQUESTED
  // Combine Visit Fees + Products (IN) with individual Ledger Items (OUT)
  const activeLedger = ledger || []
  
  // Extract general product invoice total not in the manual ledger list
  const totalLedgerSum = activeLedger.reduce((a, b) => a + (b.amount || 0), 0)
  const remainingOutcome = Math.max(0, s.outcome - totalLedgerSum)

  const cashFlowData = [
    // Inflows (Emerald / Sky theme)
    { name: "Consult Fees (In)", value: s.consultRev || 0, fill: "#10b981" },
    { name: "Product Sales (In)", value: s.pharmRev || 0, fill: "#0ea5e9" },
    // Outflows (Solid colors & Gradients)
    { name: "Product Invoices (Out)", value: remainingOutcome, fill: "#6366f1" }, // Indigo
    // Explicit Manual Ledger items added by user!
    ...activeLedger.map((it, i) => ({
      name: `${it.title} (Out)`,
      value: it.amount || 0,
      // Spread spectrum colors for visual beauty
      fill: ["#ec4899", "#f43f5e", "#f97316", "#8b5cf6", "#3b82f6"][i % 5]
    }))
  ].filter(x => x.value > 0) // Only show items that have non-zero traffic!


  // Dynamic Payment Splits based on real metrics
  const sittingInv = apiData?.sitting_inventory_value || 0
  const todaySplit = apiData?.today_by_payment || []
  
  // Helper to extract from array
  const findPay = (type: string) => todaySplit.find((x:any) => x.type === type)?.value || 0
  const totalTPay = todaySplit.reduce((a:number,b:any)=> a + b.value, 0) || 1

  const paymentSplits = [
    { method: "Physical Cash", amount: findPay("CASH"), share: Math.round((findPay("CASH")/totalTPay)*100), icon: Wallet, style: "text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 border-emerald-100" },
    { method: "UPI / Digital QR", amount: findPay("UPI"), share: Math.round((findPay("UPI")/totalTPay)*100), icon: Smartphone, style: "text-sky-600 bg-sky-50 dark:bg-sky-900/20 border-sky-100" },
    { method: "Credit/Debit Cards", amount: findPay("CARD"), share: Math.round((findPay("CARD")/totalTPay)*100), icon: CreditCard, style: "text-indigo-600 bg-indigo-50 dark:bg-indigo-900/20 border-indigo-100" },
    { method: "Sitting Inventory", amount: sittingInv, isMetric: true, icon: Package, style: "text-violet-600 bg-violet-50 dark:bg-violet-900/20 border-violet-100", note: "Current Asset Value" },
  ]

  // Derived Inventory Alert Arrays for Unified Control
  const alertsOut = apiData?.out_of_stock || []
  const alertsLow = apiData?.low_stock || []
  const alertsExpired = apiData?.expired || []
  const alertsSoon = apiData?.expiring_soon || []

  // Consolidated Unified List for Rendering with type logic
  const unifiedAlerts = [
    ...alertsExpired.map((x:any) => ({ ...x, kind: 'Expired', clr: 'text-red-600 bg-red-50 dark:bg-red-900/20 border-red-200', ord: 1 })),
    ...alertsOut.map((x:any) => ({ ...x, kind: 'Out of Stock', clr: 'text-rose-600 bg-rose-50 dark:bg-rose-900/20 border-rose-200', ord: 2 })),
    ...alertsLow.map((x:any) => ({ ...x, kind: 'Low Stock', clr: 'text-orange-600 bg-orange-50 dark:bg-orange-900/20 border-orange-200', ord: 3 })),
    ...alertsSoon.map((x:any) => ({ ...x, kind: 'Soon Expiring', clr: 'text-amber-600 bg-amber-50 dark:bg-amber-900/20 border-amber-200', ord: 4 })),
  ].sort((a, b) => a.ord - b.ord)

  // Active filtered subset based on sub-tab selection
  const activeDisplayAlerts = unifiedAlerts.filter(a => {
    if (alertTab === 'all') return true
    if (alertTab === 'expired') return a.kind === 'Expired'
    if (alertTab === 'out') return a.kind === 'Out of Stock'
    if (alertTab === 'low') return a.kind === 'Low Stock'
    if (alertTab === 'soon') return a.kind === 'Soon Expiring'
    return true
  })

  // Dynamic Busy Day Matrix
  const serverDays = apiData?.busy_day_matrix || []
  // Fallback mapping to ensure all days display
  const baseWeek = [
    { d: "Mon", c: 0 }, { d: "Tue", c: 0 }, { d: "Wed", c: 0 }, { d: "Thu", c: 0 }, 
    { d: "Fri", c: 0 }, { d: "Sat", c: 0 }, { d: "Sun", c: 0 }
  ]
  const mergedWeek = baseWeek.map(bw => {
    const found = serverDays.find((sd:any) => sd.d === bw.d)
    return found ? { d: bw.d, c: found.c } : bw
  })
  const maxDayVisits = Math.max(...mergedWeek.map(w=>w.c), 1)

  // LEDGER POPUP CONTROLS
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [form, setForm] = useState({ title: "", amount: "", type: "Generic", freq: "one-time" })

  const handleSaveCustom = async () => {
    if (!form.title || !form.amount) return
    try {
      await api.createLedgerItem({
        title: form.title,
        amount: parseFloat(form.amount),
        category: form.type,
        frequency: form.freq,
        location: 'Main' // kept for backward compat; location_id filtering handled via loc state
      })
      setIsAddOpen(false)
      setForm({ title: "", amount: "", type: "Generic", freq: "one-time" })
      fetchData() // Reload data including pie chart recompute!
    } catch (err) {
      alert("Failed to save record to server.")
    }
  }

  const removeRecord = async (id: number) => {
    try {
      await api.deleteLedgerItem(id)
      fetchData()
    } catch (err) {
      alert("Delete failed.")
    }
  }

  return (
    <div className="space-y-6 p-2 bg-background min-h-screen text-slate-900 dark:text-foreground pb-12">
      
      {/* GLOBAL HEADER */}
      <div className="sticky top-0 z-50 backdrop-blur-xl bg-white/80 dark:bg-card/80 border-b border-slate-200 dark:border-muted -mx-2 px-4 py-3 shadow-sm flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-700 text-white flex items-center justify-center shadow-md">
            {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <BarChart3 className="w-6 h-6" />}
          </div>
          <div>
            <h1 className="text-xl font-black tracking-tight">Clinic Insights</h1>
            <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Live Production Engine</p>
          </div>
        </div>

        {/* Timeline Switcher */}
        <Tabs value={period} onValueChange={setPeriod} className={cn(
          "bg-slate-100 dark:bg-muted/40 p-1 rounded-full transition-all duration-300",
          viewMode === "inventory" && "opacity-40 pointer-events-none select-none grayscale blur-[0.5px]"
        )}>
          <TabsList className="h-8 bg-transparent border-0 space-x-1">
            {["day", "week", "month", "year", "all"].map(p => (
              <TabsTrigger key={p} value={p} className="text-xs font-extrabold rounded-full h-6 px-4 capitalize transition-all data-[state=active]:bg-white dark:data-[state=active]:bg-muted">
                {p === "all" ? "All Time" : p}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {/* View Switcher Toggle: MONEY VS INVENTORY */}
        <div className="bg-slate-100 dark:bg-muted/40 p-1 rounded-lg flex gap-1">
          <Button variant="ghost" size="sm" onClick={()=>handleViewChange("money")} className={cn(
            "h-7 px-3 text-[10px] font-black uppercase tracking-widest transition-all rounded-md",
            viewMode === "money" ? "bg-white dark:bg-muted/80 text-blue-600 shadow-sm" : "text-slate-500"
          )}>
            <DollarSign className="w-3.5 h-3.5 mr-1"/> Money
          </Button>
          <Button variant="ghost" size="sm" onClick={()=>handleViewChange("inventory")} className={cn(
            "h-7 px-3 text-[10px] font-black uppercase tracking-widest transition-all rounded-md",
            viewMode === "inventory" ? "bg-white dark:bg-muted/80 text-indigo-600 shadow-sm" : "text-slate-500"
          )}>
            <Package className="w-3.5 h-3.5 mr-1"/> Inventory
          </Button>
        </div>

        {/* Dimensionality Filters */}
        <div className="flex items-center gap-2">
          <Select
            value={loc === 'all' ? 'all' : loc.toString()}
            onValueChange={val => setLoc(val === 'all' ? 'all' : parseInt(val))}
          >
            <SelectTrigger className="h-9 w-44 border-slate-200 font-bold text-xs rounded-lg">
              <MapPin className="w-3.5 h-3.5 mr-2 text-slate-400" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Branches</SelectItem>
              {locations.map(l => (
                <SelectItem key={l.id} value={l.id.toString()}>{l.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* MASTER DUAL COLUMN LAYOUT */}
      <div className={cn("px-2 transition-all duration-300", isLoading && "opacity-50")}>
        
        {viewMode === 'money' ? (
          /* 💵 MONEY VIEW BLOCK */
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        
        {/* MAIN CONTENT AREA (XL: 9 Columns) */}
        <div className="xl:col-span-9 space-y-6">
          
          {/* HERO KPIS */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card className="border-0 shadow-lg dark:bg-muted/30  relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-emerald-50 to-transparent opacity-50 dark:from-emerald-900/10 pointer-events-none" />
              <CardContent className="p-6 relative z-10">
                <div className="flex items-center gap-1.5 mb-1">
                  <div className="p-1.5 bg-emerald-100 dark:bg-emerald-900/50 rounded-lg text-emerald-600"><TrendingUp className="w-4 h-4" /></div>
                  <p className="text-xs font-black uppercase tracking-wider text-emerald-600">Total Income</p>
                </div>
                <h3 className="text-4xl font-black text-slate-900 dark:text-white">{fmt(s.income)}</h3>
                <div className="mt-4 space-y-1.5 border-t border-slate-50 dark:border-muted pt-3 text-[11px]">
                  <div className="flex justify-between"><span className="text-slate-500 font-bold">Cons. Revenue</span><span className="font-black">{fmt(s.consultRev)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500 font-bold">Pharmacy Income</span><span className="font-black text-blue-600 dark:text-blue-400">{fmt(s.pharmRev)}</span></div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-0 shadow-lg dark:bg-muted/30 dark:shadow-inner ">
              <CardContent className="p-6">
                <div className="flex items-center gap-1.5 mb-1">
                  <div className="p-1.5 bg-rose-100 dark:bg-rose-900/50 rounded-lg text-rose-600"><ShoppingBag className="w-4 h-4" /></div>
                  <p className="text-xs font-black uppercase tracking-wider text-rose-600">Total Outcome</p>
                </div>
                <h3 className="text-4xl font-black text-slate-900 dark:text-white">{fmt(s.outcome)}</h3>
                <div className="mt-6">
                  <div className="flex justify-between items-center text-[10px] font-black mb-1">
                    <span className="text-slate-500 uppercase">Spend Ratio</span>
                    <span className="text-rose-600">{s.income > 0 ? Math.round((s.outcome / s.income) * 100) : 0}%</span>
                  </div>
                  <div className="w-full h-2 bg-slate-100 dark:bg-muted/40 rounded-full overflow-hidden">
                    <div className="h-full bg-rose-500 transition-all duration-1000" style={{ width: `${Math.min((s.income > 0 ? (s.outcome/s.income)*100 : 0), 100)}%` }} />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-0 shadow-xl bg-gradient-to-br from-blue-600 to-indigo-700 text-white">
              <CardContent className="p-6 h-full flex flex-col justify-between">
                <div>
                  <p className="text-xs font-bold uppercase tracking-widest text-blue-100 opacity-80 mb-1">Net Margin</p>
                  <h3 className="text-5xl font-black tracking-tight drop-shadow-md">{fmt(s.net)}</h3>
                </div>
                <div className="mt-6">
                  <span className="px-3 py-1 rounded-full bg-white/20 border border-white/30 text-xs font-black backdrop-blur-md flex items-center w-fit gap-1"><Percent className="w-3 h-3" /> {s.marginPct}% Margin</span>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* UPDATED PAYMENT GRID (NOW INCLUDES SITTING INVENTORY) */}
          <Card className="border-0 shadow-md dark:bg-muted/30 dark:shadow-inner ">
            <CardHeader className="py-4 px-5 border-b border-slate-50 dark:border-muted/50"><CardTitle className="text-xs font-black uppercase tracking-wider text-slate-500 flex items-center gap-2"><CreditCard className="w-4 h-4 text-blue-600" /> Payment & Asset Splits</CardTitle></CardHeader>
            <CardContent className="p-5">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {paymentSplits.map((p) => (
                  <div key={p.method} className={cn("p-4 rounded-2xl border flex flex-col gap-3 transition-all hover:shadow-lg", p.style)}>
                    <div className="flex justify-between items-start">
                      <div className={cn("p-2 rounded-xl bg-white dark:bg-muted/40 shadow-sm", p.style.split(' ')[0])}><p.icon className="w-5 h-5" /></div>
                      {(!p.isMetric && p.amount > 0) && <span className="text-[10px] font-black bg-white dark:bg-muted/40 px-2 py-0.5 rounded-md border text-slate-600">{p.share}%</span>}
                    </div>
                    <div>
                      <p className="text-xs font-bold opacity-75 mb-0.5">{p.method}</p>
                      <p className="text-2xl font-black leading-tight">{fmt(p.amount)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* PIE CHART + LEDGER WIDGETS */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
            {/* EXPANDED INTERACTIVE CASHFLOW PIE */}
            <div className="md:col-span-5">
              <Card className="border-0 shadow-lg dark:bg-muted/30  h-full flex flex-col">
                <CardHeader className="pb-0 pt-5"><CardTitle className="text-sm font-black flex items-center gap-2"><PieChart className="w-4 h-4 text-blue-600" /> Integrated Cash Movement</CardTitle></CardHeader>
                <CardContent className="p-0 flex-1 relative flex flex-col items-center justify-center h-[250px] min-h-[250px]">
                  <div className="w-full h-[200px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <RePie>
                        <Pie 
                          data={cashFlowData} 
                          cx="50%" 
                          cy="50%" 
                          innerRadius={50} 
                          outerRadius={80} 
                          paddingAngle={2} 
                          dataKey="value"
                          animationBegin={0}
                          animationDuration={800}
                        >
                          {cashFlowData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.fill} stroke="none" className="hover:opacity-80 cursor-pointer transition-opacity" />
                          ))}
                        </Pie>
                        <ReTooltip 
                          formatter={(value: any, name: any) => [fmt(value), name]}
                          contentStyle={{ borderRadius: '12px', border: '0', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', fontSize: '12px', fontWeight: 'bold' }}
                        />
                      </RePie>
                    </ResponsiveContainer>
                  </div>
                  
                  {/* Moved perfectly to the bottom footer of the area */}
                  <div className="pb-4 flex flex-col items-center text-center mt-auto">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Integrated Turnover</p>
                    <p className="text-xl font-black text-slate-900 dark:text-white leading-none mt-1">{fmt(s.income + s.outcome)}</p>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Interactive Ledger */}
            <div className="md:col-span-7">
              <Card className="border-0 shadow-lg dark:bg-muted/30  h-full flex flex-col">
                <CardHeader className="flex flex-row items-center justify-between py-4 border-b border-slate-50 dark:border-muted">
                  <CardTitle className="text-sm font-black flex items-center gap-2"><ListOrdered className="w-4 h-4 text-indigo-600" /> Ledger</CardTitle>
                  <Button size="sm" className="h-7 rounded-full font-black text-[10px] bg-indigo-600 hover:bg-indigo-700 text-white gap-1" onClick={() => setIsAddOpen(true)}><Plus className="w-3 h-3" /> Record</Button>
                </CardHeader>
                <CardContent className="p-0 flex-1 max-h-[220px] overflow-auto">
                  {ledger.length === 0 ? (
                     <div className="h-32 flex items-center justify-center text-slate-400 text-xs font-bold">No manual ledger entries recorded.</div>
                  ) : (
                    <div className="divide-y divide-slate-50 dark:divide-muted">
                      {ledger.map((item) => (
                        <div key={item.id} className="p-3 flex items-center justify-between group hover:bg-slate-50 dark:hover:bg-slate-800/50">
                          <div className="flex items-center gap-3">
                            <div className="p-2 bg-indigo-50 dark:bg-indigo-950/50 rounded-lg text-indigo-600"><Receipt className="w-4 h-4" /></div>
                            <div>
                              <p className="font-black text-xs">{item.title}</p>
                              <p className="text-[9px] text-slate-400 font-bold capitalize">{item.frequency} • {item.date ? new Date(item.date).toLocaleDateString('en-US', {month:'short', day:'numeric'}) : 'N/A'}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <p className="font-black text-xs">{fmt(item.amount)}</p>
                            <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100 text-rose-500" onClick={() => removeRecord(item.id)}><Trash2 className="w-3.5 h-3.5" /></Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>

        </div> {/* END OF MAIN CONTENT AREA */}

        {/* RIGHT RAIL */}
        <div className="xl:col-span-3 space-y-6">
          
          {/* SEQUENCE CARD 1: Simple KPI Stack */}
          <Card className="border-0 shadow-md dark:bg-muted/30  overflow-hidden">
            <CardContent className="p-0">
              <div className="grid grid-cols-1 divide-y divide-slate-100 dark:divide-muted">
                <div className="p-5 flex items-center gap-4 group hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                  <div className="h-12 w-12 rounded-2xl bg-blue-50 dark:bg-blue-950 flex items-center justify-center text-blue-600"><Users className="w-6 h-6" /></div>
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Total Visit Count</p>
                    <p className="text-3xl font-black tracking-tight text-slate-900 dark:text-white">{s.visits || 0}</p>
                  </div>
                </div>
                <div className="p-5 flex items-center gap-4 group hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                  <div className="h-12 w-12 rounded-2xl bg-amber-50 dark:bg-amber-950 flex items-center justify-center text-amber-600"><FileText className="w-6 h-6" /></div>
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Visit Fees Pending</p>
                    <p className="text-3xl font-black tracking-tight text-slate-900 dark:text-white">{fmt(apiData?.visit_fees_pending || 0).replace('₹','')}</p>
                  </div>
                </div>
                <div className="p-5 flex items-center gap-4 group hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                  <div className="h-12 w-12 rounded-2xl bg-emerald-50 dark:bg-emerald-950 flex items-center justify-center text-emerald-600"><CheckCircle2 className="w-6 h-6" /></div>
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Total Sales Count</p>
                    <p className="text-3xl font-black tracking-tight text-slate-900 dark:text-white">{apiData?.medicine_revenue ? "Active" : "No Sales"}</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* SEQUENCE CARD 2: In and Out Flows */}
          <Card className="border-0 shadow-md dark:bg-muted/30 dark:shadow-inner ">
            <CardHeader className="pb-3 pt-5 px-5 border-b border-slate-50 dark:border-muted/50">
              <CardTitle className="text-xs font-black uppercase tracking-wider text-slate-500 flex items-center gap-2">
                <ArrowDownRight className="w-4 h-4 text-rose-600" /> <ArrowUpRight className="w-4 h-4 text-emerald-600" /> In and Out Flows
              </CardTitle>
            </CardHeader>
            <CardContent className="p-5 space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold text-slate-600 dark:text-muted-foreground flex items-center gap-2"><Stethoscope className="w-3.5 h-3.5 text-indigo-500"/> Visit Fees</span>
                <span className="font-black text-sm text-slate-900 dark:text-foreground">{fmt(s.consultRev)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold text-slate-600 dark:text-muted-foreground flex items-center gap-2"><Package className="w-3.5 h-3.5 text-sky-500"/> Product Sales</span>
                <span className="font-black text-sm text-slate-900 dark:text-foreground">{fmt(s.pharmRev)}</span>
              </div>
              <div className="flex justify-between items-center pt-3 border-t border-dashed border-slate-200 dark:border-muted">
                <span className="text-xs font-bold text-rose-600 flex items-center gap-2"><Receipt className="w-3.5 h-3.5"/> Total Outcome</span>
                <span className="font-black text-sm text-rose-600">{fmt(s.outcome)}</span>
              </div>
            </CardContent>
          </Card>

          {/* SEQUENCE CARD 3: Busy Day Matrix */}
          <Card className="border-0 shadow-md dark:bg-muted/30  relative overflow-hidden">
            <div className="absolute -right-4 -top-4 text-indigo-50 dark:text-indigo-900/20"><CalendarDays className="w-24 h-24" /></div>
            <CardHeader className="pb-2 pt-5 px-5 relative z-10">
              <CardTitle className="text-xs font-black uppercase tracking-wider text-slate-500 flex items-center gap-2"><Clock className="w-4 h-4 text-indigo-600" /> Traffic Density</CardTitle>
            </CardHeader>
            <CardContent className="px-5 pb-5 relative z-10">
              <div className="space-y-2 mt-2">
                {mergedWeek.map((day) => (
                  <div key={day.d} className="flex items-center gap-3">
                    <span className="text-[10px] font-black text-slate-500 w-8">{day.d}</span>
                    <div className="flex-1 h-1.5 bg-slate-100 dark:bg-muted/40 rounded-full overflow-hidden">
                      <div className={cn("h-full rounded-full transition-all duration-1000", day.c > 0 ? "bg-indigo-600" : "bg-slate-200 dark:bg-muted/80")} style={{ width: `${(day.c / Math.max(1, maxDayVisits)) * 100}%` }} />
                    </div>
                    <span className="text-[10px] font-bold text-slate-700 dark:text-muted-foreground w-6 text-right">
                      {(period === "day" || period === "week") 
                        ? day.c 
                        : `${Math.round((day.c / Math.max(1, maxDayVisits)) * 100)}%`
                      }
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

        </div>
      </div>
      ) : (
          /* 📦 INVENTORY VIEW BLOCK */
          <div className="space-y-6">
            {/* EXPANDED INVENTORY COMPREHENSIVE ALERT HEADER */}
            <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-5 gap-4">
              
              {/* Value Card */}
              <Card className="border-0 shadow-md dark:bg-muted/30  relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-indigo-50 to-transparent opacity-40 dark:from-indigo-900/5 pointer-events-none" />
                <CardContent className="p-5 relative z-10">
                  <div className="flex items-center gap-1.5 mb-1 opacity-70">
                    <Package className="w-3.5 h-3.5 text-indigo-600" />
                    <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">Total Value</p>
                  </div>
                  <h3 className="text-2xl font-black text-slate-900 dark:text-white">{fmt(sittingInv)}</h3>
                  <p className="text-[9px] font-bold text-slate-400 mt-0.5">Current Net Asset Value</p>
                </CardContent>
              </Card>

              {/* 🚨 EXPIRED Count */}
              <Card className={cn("border-0 shadow-md transition-all", alertsExpired.length > 0 ? "bg-red-600 text-white" : "")}>
                <CardContent className="p-5 flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <XCircle className={cn("w-3.5 h-3.5", alertsExpired.length > 0 ? "text-red-100" : "text-red-600")} />
                      <p className={cn("text-[10px] font-black uppercase tracking-wider", alertsExpired.length > 0 ? "text-red-100" : "text-slate-500")}>Expired Items</p>
                    </div>
                    <h3 className={cn("text-3xl font-black", alertsExpired.length > 0 ? "drop-shadow-sm" : "text-red-600")}>{alertsExpired.length}</h3>
                  </div>
                  <div className={cn("p-2.5 rounded-xl", alertsExpired.length > 0 ? "bg-white/10" : "bg-red-50 dark:bg-red-900/20")}>
                    <AlertOctagon className={cn("w-5 h-5", alertsExpired.length > 0 ? "text-white" : "text-red-600")} />
                  </div>
                </CardContent>
              </Card>

              {/* 🛑 OUT OF STOCK Count */}
              <Card className="border-0 shadow-md dark:bg-muted/30 dark:shadow-inner ">
                <CardContent className="p-5 flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <MinusCircle className="w-3.5 h-3.5 text-rose-600" />
                      <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">Out of Stock</p>
                    </div>
                    <h3 className="text-3xl font-black text-rose-600">{alertsOut.length}</h3>
                  </div>
                  <div className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-900/20">
                    <AlertTriangle className="w-5 h-5 text-rose-600" />
                  </div>
                </CardContent>
              </Card>

              {/* ⚠️ LOW STOCK Count */}
              <Card className="border-0 shadow-md dark:bg-muted/30 dark:shadow-inner ">
                <CardContent className="p-5 flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <TrendingDown className="w-3.5 h-3.5 text-orange-500" />
                      <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">Low Stock</p>
                    </div>
                    <h3 className="text-3xl font-black text-orange-500">{alertsLow.length}</h3>
                  </div>
                  <div className="p-2.5 rounded-xl bg-orange-50 dark:bg-orange-900/20">
                    <AlertCircle className="w-5 h-5 text-orange-500" />
                  </div>
                </CardContent>
              </Card>

              {/* ⏳ SOON EXPIRE Count */}
              <Card className="border-0 shadow-md dark:bg-muted/30 dark:shadow-inner ">
                <CardContent className="p-5 flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <Clock className="w-3.5 h-3.5 text-amber-500" />
                      <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">Expiring Soon</p>
                    </div>
                    <h3 className="text-3xl font-black text-amber-500">{alertsSoon.length}</h3>
                  </div>
                  <div className="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-900/20">
                    <Calendar className="w-5 h-5 text-amber-500" />
                  </div>
                </CardContent>
              </Card>

            </div>

            {/* TWO COLUMN CORE GRID */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Top Selling Card */}
              <Card className="border-0 shadow-md dark:bg-muted/30  overflow-hidden flex flex-col h-[500px]">
                <CardHeader className="border-b border-slate-50 dark:border-muted py-4 px-5 bg-slate-50/30">
                  <CardTitle className="text-xs font-black uppercase tracking-wider text-slate-500 flex items-center gap-2"><TrendingUp className="w-4 h-4 text-emerald-600" /> Top Selling Medicines</CardTitle>
                </CardHeader>
                <CardContent className="p-0 flex-1 overflow-auto relative">
                  <div className="divide-y divide-slate-50 dark:divide-muted">
                    {(apiData?.top_items || []).length === 0 ? (
                      <div className="p-8 text-center text-xs font-bold text-slate-400">No sales tracking data available.</div>
                    ) : (
                      (apiData?.top_items || []).map((item:any, i:number) => (
                        <div key={i} className="flex items-center justify-between p-4 group hover:bg-slate-50 transition-colors">
                          <div className="flex items-center gap-3">
                            <div className="w-7 h-7 rounded-full bg-slate-100 dark:bg-muted/40 flex items-center justify-center text-[10px] font-black text-slate-500">#{i+1}</div>
                            <div>
                              <p className="text-sm font-black text-slate-800 dark:text-white">{item.name}</p>
                              <p className="text-[10px] font-bold text-slate-400">{item.qty_sold} units sold</p>
                            </div>
                          </div>
                          <p className="font-black text-sm text-emerald-600 dark:text-emerald-400">{fmt(item.revenue)}</p>
                        </div>
                      ))
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* 🔥 UNIFIED COMPREHENSIVE ALERTS CONTROL PANEL */}
              <Card className="border-0 shadow-lg dark:bg-muted/30  overflow-hidden flex flex-col h-[500px]">
                <CardHeader className="py-3 px-4 border-b border-slate-50 dark:border-muted flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                  <CardTitle className="text-sm font-black flex items-center gap-2 shrink-0"><AlertOctagon className="w-5 h-5 text-red-600"/> Risk Matrix</CardTitle>
                  
                  {/* DESKTOP TABS: Expanded for High Visibility */}
                  <div className="hidden lg:flex flex-1 items-center justify-end">
                    <div className="bg-slate-100 dark:bg-muted/40 p-1 rounded-xl flex gap-1.5">
                      {[
                        {id:'all', lbl:'All', count: unifiedAlerts.length},
                        {id:'expired', lbl:'Expired', count: alertsExpired.length},
                        {id:'out', lbl:'Out', count: alertsOut.length},
                        {id:'low', lbl:'Low', count: alertsLow.length},
                        {id:'soon', lbl:'Soon', count: alertsSoon.length}
                      ].map(tab => (
                        <button 
                          key={tab.id}
                          onClick={() => setAlertTab(tab.id)}
                          className={cn(
                            "px-4 py-2 rounded-lg text-[11px] font-black uppercase transition-all flex items-center gap-2 whitespace-nowrap",
                            alertTab === tab.id ? "bg-white dark:bg-muted/80 shadow-md text-indigo-600 dark:text-white scale-105" : "text-slate-500 hover:bg-slate-200/50 dark:hover:bg-slate-700/50"
                          )}
                        >
                          {tab.lbl} 
                          <span className={cn(
                            "px-1.5 py-0.5 rounded text-[9px] font-black min-w-[16px]", 
                            alertTab === tab.id ? "bg-indigo-600 text-white" : "bg-slate-200 dark:bg-card text-slate-600 dark:text-muted-foreground"
                          )}>
                            {tab.count}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* MOBILE / SMALL VIEWPORT FALLBACK: Dropdown Selector */}
                  <div className="block lg:hidden w-full">
                    <Select value={alertTab} onValueChange={setAlertTab}>
                      <SelectTrigger className="h-10 bg-slate-100 dark:bg-muted/40 border-0 font-black text-xs uppercase tracking-wider rounded-xl">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all" className="font-bold text-xs">ALL ALERTS ({unifiedAlerts.length})</SelectItem>
                        <SelectItem value="expired" className="font-bold text-xs text-red-600">EXPIRED ({alertsExpired.length})</SelectItem>
                        <SelectItem value="out" className="font-bold text-xs text-rose-600">OUT OF STOCK ({alertsOut.length})</SelectItem>
                        <SelectItem value="low" className="font-bold text-xs text-orange-600">LOW STOCK ({alertsLow.length})</SelectItem>
                        <SelectItem value="soon" className="font-bold text-xs text-amber-600">SOON EXPIRING ({alertsSoon.length})</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </CardHeader>
                
                <CardContent className="p-0 flex-1 overflow-auto relative bg-slate-50/30 dark:bg-muted/20">
                  {activeDisplayAlerts.length === 0 ? (
                    <div className="p-12 text-center flex flex-col items-center gap-3 justify-center h-full">
                      <CheckCircle2 className="w-12 h-12 text-emerald-200 dark:text-emerald-900" />
                      <p className="text-xs font-black text-slate-400">No active triggers found in this channel.</p>
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100 dark:divide-muted">
                      {activeDisplayAlerts.map((item:any, i:number) => (
                        <div key={i} className="p-4 hover:bg-white dark:hover:bg-slate-800/50 transition-colors flex items-center justify-between group">
                          <div className="flex items-start gap-3">
                            <div className={cn("px-2 py-0.5 text-[8px] font-black uppercase rounded-md tracking-wider border whitespace-nowrap mt-0.5", item.clr)}>
                              {item.kind}
                            </div>
                            <div>
                              <p className="text-sm font-black text-slate-800 dark:text-foreground group-hover:text-indigo-600 transition-colors">{item.name}</p>
                              <div className="flex gap-2 mt-0.5">
                                {item.expiry && <p className="text-[10px] font-bold text-slate-400 flex items-center gap-1"><Calendar className="w-3 h-3"/> {item.expiry}</p>}
                                {item.threshold && <p className="text-[10px] font-bold text-slate-400 flex items-center gap-1"><ShieldAlert className="w-3 h-3"/> Threshold: {item.threshold}</p>}
                              </div>
                            </div>
                          </div>
                          
                          <div className="text-right">
                            <div className={cn(
                              "text-sm font-black",
                              item.kind === 'Expired' || item.kind === 'Out of Stock' ? "text-red-600" : "text-orange-600"
                            )}>
                              {item.qty <= 0 ? "Zero" : `${item.qty} Units`}
                            </div>
                            <p className="text-[9px] font-bold text-slate-400">Current Vol</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* FULL WIDTH INVOICE HISTORY LIST */}
            <Card className="border-0 shadow-lg dark:bg-muted/30  overflow-hidden">
              <CardHeader className="py-4 px-6 border-b border-slate-50 dark:border-muted"><CardTitle className="text-sm font-black flex items-center gap-2"><FileText className="w-5 h-5 text-indigo-600"/> Primary Procurement Log (Invoice History)</CardTitle></CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50 dark:bg-muted/40/50 border-b border-slate-100 dark:border-muted">
                        <th className="px-6 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400">Invoice ID</th>
                        <th className="px-6 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400">Date Logged</th>
                        <th className="px-6 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400">Vendor Name</th>
                        <th className="px-6 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400 text-right">Total Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50 dark:divide-muted">
                      {(apiData?.invoice_history || []).map((inv:any, i:number)=>(
                        <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                          <td className="px-6 py-4 text-xs font-black text-indigo-600 dark:text-indigo-400">{inv.id}</td>
                          <td className="px-6 py-4 text-xs font-bold text-slate-500">{inv.date}</td>
                          <td className="px-6 py-4 text-xs font-black text-slate-800 dark:text-foreground">{inv.vendor}</td>
                          <td className="px-6 py-4 text-sm font-black text-slate-900 dark:text-white text-right">{fmt(inv.amount)}</td>
                        </tr>
                      ))}
                      {(apiData?.invoice_history || []).length === 0 && (
                        <tr><td colSpan={4} className="px-6 py-8 text-center text-slate-400 text-xs font-bold">No recent purchase invoices recorded.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div> 

      {/* RECORD EXPENSE DIALOG */}
      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent className="sm:max-w-[450px] p-0 bg-white dark:bg-background border-0 shadow-2xl rounded-3xl overflow-hidden">
          <div className="bg-slate-900 p-6 text-white relative border-b-4 border-indigo-500">
            <div className="absolute top-0 right-0 p-6 opacity-10 rotate-12"><Receipt className="w-16 h-16"/></div>
            <DialogHeader className="relative z-10">
              <DialogTitle className="text-xl font-black text-white">New Expense Record</DialogTitle>
              <p className="text-slate-400 text-xs font-bold">Write directly to ClinicOS Database.</p>
            </DialogHeader>
          </div>

          <div className="p-6 space-y-5">
            <div className="space-y-1">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Expense Name</label>
              <Input value={form.title} onChange={(e)=>setForm({...form, title:e.target.value})} placeholder="Enter detail..." className="h-11 font-bold bg-slate-50 border-slate-200 focus-visible:ring-indigo-500 dark:bg-card dark:border-muted" />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Value (₹)</label>
                <Input type="number" value={form.amount} onChange={(e)=>setForm({...form, amount:e.target.value})} placeholder="0.00" className="h-11 font-black text-indigo-600 bg-slate-50 border-slate-200 dark:bg-card dark:border-muted" />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Frequency</label>
                <Select value={form.freq} onValueChange={(v)=>setForm({...form, freq:v})}>
                  <SelectTrigger className="h-11 font-bold bg-slate-50 border-slate-200 dark:bg-card dark:border-muted"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="one-time" className="font-bold">One-Time</SelectItem>
                    <SelectItem value="daily" className="font-bold">Daily</SelectItem>
                    <SelectItem value="weekly" className="font-bold">Weekly</SelectItem>
                    <SelectItem value="monthly" className="font-bold">Monthly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            
             <div className="space-y-1">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Category / Group</label>
              <Select value={form.type} onValueChange={(v)=>setForm({...form, type:v})}>
                <SelectTrigger className="h-11 font-bold bg-slate-50 border-slate-200 dark:bg-card dark:border-muted"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Generic" className="font-bold">Generic Cost</SelectItem>
                  <SelectItem value="Utility" className="font-bold">Utility & Rent</SelectItem>
                  <SelectItem value="Salary" className="font-bold">Payroll</SelectItem>
                  <SelectItem value="Pharmacy" className="font-bold">Pharmacy Restock</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* IMAGE / QR FUNCTIONALITY AREA */}
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Receipt Attachment</label>
              <div className="border-2 border-dashed border-slate-200 dark:border-muted rounded-2xl p-5 flex flex-col items-center justify-center gap-3 text-center bg-slate-50 dark:bg-muted/20 group">
                <div className="h-10 w-10 rounded-full bg-white dark:bg-muted/40 flex items-center justify-center text-slate-400 group-hover:text-indigo-600 transition-colors shadow-sm"><ImageIcon className="w-5 h-5" /></div>
                <div className="flex gap-2 w-full mt-2">
                  <Button variant="outline" size="sm" className="flex-1 font-extrabold text-xs gap-2  shadow-sm h-9" onClick={()=>alert("Digital scan engine initializing...")}><QrCode className="w-3.5 h-3.5 text-indigo-600"/> Mobile Scan</Button>
                  <Button variant="outline" size="sm" className="h-9 w-9 p-0 text-rose-500  shadow-sm hover:bg-rose-50 border-rose-100 dark:border-muted"><Trash2 className="w-3.5 h-3.5"/></Button>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter className="bg-slate-50 dark:bg-card/50 p-4 flex justify-end gap-2 border-t border-slate-200 dark:border-muted">
            <Button variant="ghost" size="sm" className="font-bold" onClick={() => setIsAddOpen(false)}>Cancel</Button>
            <Button size="sm" className="px-8 font-black bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg shadow-indigo-500/30" onClick={handleSaveCustom} disabled={!form.title || !form.amount}>Submit to DB</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  )
}
