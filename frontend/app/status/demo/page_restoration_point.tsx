"use client"
import React, { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { 
  TrendingUp, TrendingDown, DollarSign, Stethoscope, ShoppingBag, MapPin, 
  UserCircle2, Package, Calendar, CreditCard, Landmark, Wallet, Plus, 
  PieChart, ListOrdered, Activity, Receipt, QrCode, Trash2, Image as ImageIcon, 
  ArrowUpRight, ArrowDownRight, Smartphone, Briefcase, BarChart3, Percent
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

const fmt = (n: number) => `₹${n.toLocaleString('en-IN')}`

export default function StatusDemoPage() {
  // Top Level Controls
  const [loc, setLoc] = useState("all")
  const [staff, setStaff] = useState("all")
  const [period, setPeriod] = useState("month")

  // 1. COMPREHENSIVE KPI DATASET MAPPING TIME SLICES
  const dataSlices = {
    day: { income: 14500, outcome: 5200, net: 9300, pharmRev: 8900, consultRev: 5600, marginPct: 64.1 },
    week: { income: 85200, outcome: 31000, net: 54200, pharmRev: 52000, consultRev: 33200, marginPct: 63.6 },
    month: { income: 285420, outcome: 98200, net: 187220, pharmRev: 165420, consultRev: 120000, marginPct: 65.5 },
    all: { income: 1420000, outcome: 640000, net: 780000, pharmRev: 820000, consultRev: 600000, marginPct: 54.9 },
  }
  const s = dataSlices[period as keyof typeof dataSlices] || dataSlices.month

  // 2. EXPENSE DISTRIBUTION PIE DATA
  const expenseCategories = [
    { label: "Pharmacy Restock", val: s.outcome * 0.65, pct: 65, c: "bg-blue-500", ring: "stroke-blue-500" },
    { label: "Staffing / Payroll", val: s.outcome * 0.20, pct: 20, c: "bg-indigo-500", ring: "stroke-indigo-500" },
    { label: "Clinic Rent & Utls", val: s.outcome * 0.10, pct: 10, c: "bg-violet-500", ring: "stroke-violet-500" },
    { label: "Other Overheads", val: s.outcome * 0.05, pct: 5, c: "bg-slate-400", ring: "stroke-slate-400" },
  ]

  // 3. COMPREHENSIVE PAYMENT GRID DATA
  const paymentSplits = [
    { method: "Physical Cash", amount: s.income * 0.45, share: 45, icon: Wallet, style: "text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 border-emerald-100" },
    { method: "UPI / Digital QR", amount: s.income * 0.30, share: 30, icon: Smartphone, style: "text-sky-600 bg-sky-50 dark:bg-sky-900/20 border-sky-100" },
    { method: "Credit/Debit Cards", amount: s.income * 0.15, share: 15, icon: CreditCard, style: "text-indigo-600 bg-indigo-50 dark:bg-indigo-900/20 border-indigo-100" },
    { method: "Insurance Claims", amount: s.income * 0.10, share: 10, icon: Landmark, style: "text-amber-600 bg-amber-50 dark:bg-amber-900/20 border-amber-100" },
  ]

  // 4. DYNAMIC LEDGER (CUSTOM CREATION SYSTEM)
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [ledger, setLedger] = useState([
    { id: 1, title: "Monthly Electricity Bill", type: "Utility", date: "May 10", amount: 4500, user: "Dr. Reddy" },
    { id: 2, title: "Surgical Gloves Stock", type: "Pharmacy", date: "May 08", amount: 12500, user: "Admin" },
    { id: 3, title: "Biohazard Disposal Fee", type: "Facility", date: "May 02", amount: 2200, user: "Receptionist" },
  ])
  const [form, setForm] = useState({ title: "", amount: "", type: "Generic" })

  const handleSaveCustom = () => {
    if (!form.title || !form.amount) return
    setLedger([
      {
        id: Date.now(),
        title: form.title,
        type: form.type,
        date: "Just Now",
        amount: parseFloat(form.amount),
        user: "Active User"
      },
      ...ledger
    ])
    setIsAddOpen(false)
    setForm({ title: "", amount: "", type: "Generic" })
  }

  const removeRecord = (id: number) => {
    setLedger(ledger.filter(r => r.id !== id))
  }

  return (
    <div className="space-y-6 p-1 bg-slate-50/50 dark:bg-slate-950 min-h-screen text-slate-900 dark:text-slate-100 pb-12">
      
      {/* AESTHETIC GLOBAL NAVIGATION HEADER */}
      <div className="sticky top-0 z-50 backdrop-blur-xl bg-white/80 dark:bg-slate-900/80 border-b border-slate-200 dark:border-slate-800 -mx-1 px-4 py-3 shadow-sm flex flex-wrap items-center justify-between gap-4">
        
        {/* Branding */}
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-700 text-white flex items-center justify-center shadow-md shadow-blue-500/20">
            <BarChart3 className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-black tracking-tight text-slate-900 dark:text-white">Clinic Intelligence</h1>
            <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 leading-none">Realtime Ledger</p>
          </div>
        </div>

        {/* Central Slicer: Time Windows */}
        <Tabs value={period} onValueChange={setPeriod} className="bg-slate-100 dark:bg-slate-800 p-1 rounded-full">
          <TabsList className="h-8 bg-transparent border-0 space-x-1">
            {["day", "week", "month", "all"].map(p => (
              <TabsTrigger key={p} value={p} className="text-xs font-extrabold rounded-full h-6 px-4 data-[state=active]:bg-white dark:data-[state=active]:bg-slate-700 data-[state=active]:shadow-sm capitalize text-slate-500 data-[state=active]:text-slate-900 dark:data-[state=active]:text-white transition-all">
                {p === "all" ? "All Time" : p}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {/* Right Filters: Dimensional Selection */}
        <div className="flex items-center gap-2">
          <Select value={loc} onValueChange={setLoc}>
            <SelectTrigger className="h-9 w-36 border-slate-200 font-bold text-xs rounded-lg bg-white dark:bg-slate-900 shadow-sm">
              <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300"><MapPin className="w-3.5 h-3.5 opacity-70" /><SelectValue /></div>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="font-bold">All Branches</SelectItem>
              <SelectItem value="main" className="font-bold">Main Clinic</SelectItem>
              <SelectItem value="sub" className="font-bold">Secondary</SelectItem>
            </SelectContent>
          </Select>

          <Select value={staff} onValueChange={setStaff}>
            <SelectTrigger className="h-9 w-36 border-slate-200 font-bold text-xs rounded-lg bg-white dark:bg-slate-900 shadow-sm">
              <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300"><UserCircle2 className="w-3.5 h-3.5 opacity-70" /><SelectValue /></div>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="font-bold">Total Staff</SelectItem>
              <SelectItem value="reddy" className="font-bold">Dr. Reddy</SelectItem>
              <SelectItem value="staff1" className="font-bold">Front Desk</SelectItem>
            </SelectContent>
          </Select>
          
          <Button size="sm" className="h-9 rounded-lg font-extrabold px-4 bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-500/30 transition-transform active:scale-95 flex gap-2" onClick={() => setIsAddOpen(true)}>
            <Plus className="w-4 h-4 stroke-[3]" /> Record 
          </Button>
        </div>
      </div>

      {/* SECTION 1: GLANCE LEVEL OVERVIEW (INCOME, OUTCOME, NET) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 px-3 mt-4">
        
        {/* Card: TOTAL INFLOW / INCOME */}
        <Card className="border-0 shadow-xl shadow-slate-200/50 dark:shadow-none bg-white dark:bg-slate-900 overflow-hidden relative group transition-all hover:shadow-2xl">
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-50 to-white dark:from-emerald-950/10 dark:to-slate-900 opacity-50 pointer-events-none" />
          <CardContent className="p-6 relative z-10">
            <div className="flex justify-between items-start">
              <div>
                <div className="flex items-center gap-1.5 mb-1">
                  <div className="p-1.5 bg-emerald-100 dark:bg-emerald-900/50 rounded-lg text-emerald-600 dark:text-emerald-400"><TrendingUp className="w-4 h-4" /></div>
                  <p className="text-xs font-black uppercase tracking-widest text-emerald-700 dark:text-emerald-400">Total Income</p>
                </div>
                <h3 className="text-4xl font-black tracking-tight text-slate-900 dark:text-white drop-shadow-sm">{fmt(s.income)}</h3>
              </div>
            </div>
            <div className="mt-6 space-y-3 border-t border-emerald-100 dark:border-emerald-900/30 pt-4">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-slate-500 dark:text-slate-400">Consultation Revenue</span>
                <span className="font-black text-slate-800 dark:text-slate-200">{fmt(s.consultRev)}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-slate-500 dark:text-slate-400">Pharmacy Income</span>
                <span className="font-black text-blue-600 dark:text-blue-400 flex items-center gap-1"><Package className="w-3 h-3"/> {fmt(s.pharmRev)}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Card: TOTAL SPENDING / OUTCOME */}
        <Card className="border-0 shadow-xl shadow-slate-200/50 dark:shadow-none bg-white dark:bg-slate-900 relative transition-all hover:shadow-2xl">
          <CardContent className="p-6">
            <div className="flex items-start gap-1.5 mb-1">
              <div className="p-1.5 bg-rose-100 dark:bg-rose-900/50 rounded-lg text-rose-600 dark:text-rose-400"><ShoppingBag className="w-4 h-4" /></div>
              <p className="text-xs font-black uppercase tracking-widest text-rose-700 dark:text-rose-400">Total Expenses</p>
            </div>
            <h3 className="text-4xl font-black tracking-tight text-slate-900 dark:text-white">{fmt(s.outcome)}</h3>
            
            {/* Spend intensity visualization */}
            <div className="mt-6">
              <div className="flex justify-between items-center text-xs font-black mb-1.5">
                <span className="text-slate-500">Cost Ratio</span>
                <span className="text-rose-600">{((s.outcome / Math.max(1, s.income)) * 100).toFixed(0)}% of Income</span>
              </div>
              <div className="w-full h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-rose-500 to-amber-500 transition-all duration-700 ease-out rounded-full" style={{ width: `${Math.min((s.outcome / Math.max(1, s.income)) * 100, 100)}%` }} />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Card: NET BALANCE PROFIT */}
        <Card className="border-0 shadow-2xl shadow-indigo-500/20 relative bg-gradient-to-br from-blue-600 to-indigo-700 text-white overflow-hidden">
          <div className="absolute -right-4 -top-4 text-white/10"><BarChart3 className="w-32 h-32 rotate-12" /></div>
          <CardContent className="p-6 relative z-10 flex flex-col h-full justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-blue-100/70 mb-1">Net Profit Margin</p>
              <h3 className="text-5xl font-black tracking-tight drop-shadow-md">{fmt(s.net)}</h3>
            </div>
            <div className="mt-6 flex items-center gap-2">
              <span className="px-3 py-1 rounded-full bg-white/20 border border-white/30 text-xs font-black backdrop-blur-md flex items-center gap-1.5">
                <Percent className="w-3 h-3 stroke-[3]" /> {s.marginPct}% Performance
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* SECTION 2: MULTIPLE WAYS OF PAYMENT (DETAILED BREAKDOWN) */}
      <div className="px-3">
        <Card className="border-0 shadow-md bg-white dark:bg-slate-900">
          <CardHeader className="pb-3 pt-5 px-5 border-b border-slate-50 dark:border-slate-800/50">
            <CardTitle className="text-sm font-black uppercase tracking-wider text-slate-500 flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-blue-600" /> Multichannel Payment Breakdown
            </CardTitle>
          </CardHeader>
          <CardContent className="p-5">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {paymentSplits.map((p) => (
                <div key={p.method} className={cn("p-4 rounded-2xl border flex flex-col gap-3 transition-all hover:shadow-lg hover:-translate-y-0.5", p.style)}>
                  <div className="flex justify-between items-start">
                    <div className={cn("p-2 rounded-xl bg-white dark:bg-slate-800 shadow-sm", p.style.split(' ')[0])}>
                      <p.icon className="w-5 h-5" />
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] font-black bg-white dark:bg-slate-800 px-2 py-0.5 rounded-md border border-inherit text-slate-600 dark:text-slate-300 shadow-sm">{p.share}%</p>
                    </div>
                  </div>
                  <div>
                    <p className="text-xs font-bold opacity-70 mb-0.5">{p.method}</p>
                    <p className="text-2xl font-black leading-tight">{fmt(Math.floor(p.amount))}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* SECTION 3: EXPENSE PIE CHART + CUSTOM CREATION SYSTEM (LEDGER) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 px-3">
        
        {/* EXPENSE DISTRIBUTION (PIE CHART WIDGET) */}
        <div className="lg:col-span-5">
          <Card className="border-0 shadow-xl bg-white dark:bg-slate-900 h-full flex flex-col">
            <CardHeader className="pb-2 pt-5">
              <CardTitle className="text-base font-black tracking-tight text-slate-800 dark:text-slate-100 flex items-center gap-2">
                <PieChart className="w-5 h-5 text-indigo-600" /> Where the Money Goes
              </CardTitle>
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Expense Distribution</p>
            </CardHeader>
            <CardContent className="p-6 flex-1 flex flex-col md:flex-row items-center justify-center gap-8">
              {/* Functional SVG Donut */}
              <div className="relative w-36 h-36 shrink-0">
                <svg className="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
                  <circle cx="18" cy="18" r="15.915" fill="transparent" stroke="#f1f5f9" strokeWidth="5" />
                  <circle cx="18" cy="18" r="15.915" fill="transparent" className="stroke-blue-500" strokeWidth="5" strokeDasharray="65 35" strokeDashoffset="0" />
                  <circle cx="18" cy="18" r="15.915" fill="transparent" className="stroke-indigo-500" strokeWidth="5" strokeDasharray="20 80" strokeDashoffset="-65" />
                  <circle cx="18" cy="18" r="15.915" fill="transparent" className="stroke-violet-500" strokeWidth="5" strokeDasharray="10 90" strokeDashoffset="-85" />
                  <circle cx="18" cy="18" r="15.915" fill="transparent" className="stroke-slate-300" strokeWidth="5" strokeDasharray="5 95" strokeDashoffset="-95" />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-xl font-black tracking-tighter text-slate-800 dark:text-white">{fmt(s.outcome).slice(0, -3)}k</span>
                  <span className="text-[8px] font-extrabold uppercase tracking-widest text-slate-400">Cost</span>
                </div>
              </div>

              {/* Custom Smart Legend */}
              <div className="flex-1 w-full space-y-2.5">
                {expenseCategories.map((cat) => (
                  <div key={cat.label} className="flex items-center justify-between group border-b border-slate-50 dark:border-slate-800 pb-1.5 last:border-0">
                    <div className="flex items-center gap-2">
                      <div className={cn("w-2.5 h-2.5 rounded-full", cat.c)} />
                      <span className="text-xs font-bold text-slate-600 dark:text-slate-300 group-hover:text-slate-900 transition-colors truncate">{cat.label}</span>
                    </div>
                    <div className="text-right">
                      <span className="text-xs font-black text-slate-900 dark:text-slate-100">{cat.pct}%</span>
                      <p className="text-[9px] font-bold text-slate-400">{fmt(Math.floor(cat.val))}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* INTERACTIVE CUSTOM LEDGER (THE DYNAMIC SYSTEM SYSTEM) */}
        <div className="lg:col-span-7">
          <Card className="border-0 shadow-xl bg-white dark:bg-slate-900 h-full flex flex-col">
            <CardHeader className="flex flex-row items-center justify-between pb-4 pt-5 border-b border-slate-50 dark:border-slate-800/50">
              <div>
                <CardTitle className="text-base font-black flex items-center gap-2 text-slate-800 dark:text-slate-100">
                  <ListOrdered className="w-5 h-5 text-indigo-600" /> Manual Ledgers & Costs
                </CardTitle>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mt-1">Custom Entry Feed</p>
              </div>
              <Button size="sm" className="h-8 rounded-full font-bold bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 gap-1.5 shadow-sm border border-slate-200 dark:border-slate-700" onClick={() => setIsAddOpen(true)}>
                <Plus className="w-3.5 h-3.5" /> Record Cost
              </Button>
            </CardHeader>
            <CardContent className="p-0 flex-1 overflow-auto max-h-[400px]">
              <div className="divide-y divide-slate-50 dark:divide-slate-800">
                {ledger.length === 0 ? (
                  <div className="p-8 text-center text-slate-400 font-bold text-sm">No custom entries yet. Click 'Record Cost' above.</div>
                ) : (
                  ledger.map((item) => (
                    <div key={item.id} className="p-4 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800/50 group transition-all">
                      <div className="flex items-center gap-4">
                        <div className="p-2 rounded-xl bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 group-hover:scale-110 transition-transform">
                          <Receipt className="w-5 h-5" />
                        </div>
                        <div>
                          <p className="font-black text-sm text-slate-900 dark:text-slate-100">{item.title}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-[10px] font-black uppercase tracking-wider px-1.5 bg-slate-100 dark:bg-slate-800 text-slate-500 rounded">{item.type}</span>
                            <span className="text-[10px] font-bold text-slate-400">{item.date} • {item.user}</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <p className="text-base font-black text-slate-900 dark:text-white">{fmt(item.amount)}</p>
                        <Button variant="ghost" size="icon" className="h-8 w-8 opacity-0 group-hover:opacity-100 text-rose-500 hover:bg-rose-50 hover:text-rose-600 transition-all rounded-full" onClick={() => removeRecord(item.id)}>
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
            <div className="mt-auto p-4 bg-slate-50/50 dark:bg-slate-800/20 border-t border-slate-100 dark:border-slate-800 flex justify-between items-center">
              <span className="text-xs font-black text-slate-400 uppercase tracking-wider">Total Ledger Weight</span>
              <span className="font-black text-sm text-indigo-600 dark:text-indigo-400">{fmt(ledger.reduce((a,b)=>a+b.amount, 0))}</span>
            </div>
          </Card>
        </div>
      </div>

      {/* POPUP MODAL: RECORD NEW CUSTOM EXPENSE / LEDGER */}
      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent className="sm:max-w-[420px] p-0 bg-white dark:bg-slate-950 border-0 shadow-2xl rounded-3xl overflow-hidden animate-in zoom-in-95 duration-200">
          
          {/* Visual Header */}
          <div className="bg-gradient-to-r from-indigo-600 to-blue-600 p-6 text-white relative">
            <div className="absolute top-0 right-0 p-6 opacity-20 rotate-12"><Receipt className="w-16 h-16"/></div>
            <DialogHeader className="relative z-10">
              <DialogTitle className="text-xl font-black tracking-tight text-white">Record New Ledger</DialogTitle>
              <p className="text-blue-100 text-xs font-bold opacity-80">Add custom overheads, bills, or manual spending.</p>
            </DialogHeader>
          </div>

          {/* Form Content */}
          <div className="p-6 space-y-5 bg-white dark:bg-slate-950">
            <div className="space-y-1.5">
              <label className="text-xs font-black uppercase tracking-wider text-slate-500">Expense Title</label>
              <Input 
                value={form.title} 
                onChange={(e)=>setForm({...form, title:e.target.value})} 
                placeholder="e.g. Shop Rent, Utility, Generator Fuel" 
                className="h-11 border-slate-200 focus-visible:ring-indigo-500 font-bold"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-black uppercase tracking-wider text-slate-500">Amount (₹)</label>
                <Input 
                  type="number" 
                  value={form.amount} 
                  onChange={(e)=>setForm({...form, amount:e.target.value})} 
                  placeholder="0.00" 
                  className="h-11 border-slate-200 font-black text-lg text-indigo-600"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-black uppercase tracking-wider text-slate-500">Vertical</label>
                <Select value={form.type} onValueChange={(v)=>setForm({...form, type:v})}>
                  <SelectTrigger className="h-11 font-bold border-slate-200"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Pharmacy" className="font-bold">Pharmacy</SelectItem>
                    <SelectItem value="Utility" className="font-bold">Utility</SelectItem>
                    <SelectItem value="Generic" className="font-bold">General Cost</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Digital Receipt Scanning Bridge UI */}
            <div className="border-2 border-dashed border-slate-100 dark:border-slate-800 rounded-2xl p-5 flex flex-col items-center justify-center gap-3 text-center bg-slate-50 dark:bg-slate-900/50 transition-colors hover:bg-indigo-50/50 dark:hover:bg-slate-800">
              <div className="h-10 w-10 rounded-full bg-white dark:bg-slate-800 shadow-sm flex items-center justify-center text-slate-400 group-hover:text-indigo-600"><ImageIcon className="w-5 h-5" /></div>
              <div>
                <p className="text-xs font-black text-slate-800 dark:text-slate-200">Scan Receipt (Optional)</p>
                <p className="text-[10px] font-bold text-slate-400">Bridge directly to mobile device</p>
              </div>
              <Button variant="outline" size="sm" className="h-8 bg-white font-extrabold text-xs gap-2 rounded-lg border-slate-200 shadow-sm hover:border-indigo-300" onClick={()=>alert("Mobile bridge linking...")}>
                <QrCode className="w-3.5 h-3.5 text-indigo-600" /> Mobile Scan
              </Button>
            </div>
          </div>

          {/* Action Footer */}
          <DialogFooter className="bg-slate-50 dark:bg-slate-900/50 p-4 flex justify-end gap-2 border-t border-slate-100 dark:border-slate-800">
            <Button variant="ghost" size="sm" className="font-bold rounded-lg" onClick={() => setIsAddOpen(false)}>Dismiss</Button>
            <Button size="sm" className="px-6 font-black bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg shadow-lg shadow-indigo-500/30" onClick={handleSaveCustom}>Save to Ledger</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  )
}
