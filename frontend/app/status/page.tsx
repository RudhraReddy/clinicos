"use client"
import { useState, useEffect, useMemo } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Loader2, TrendingUp, Users, IndianRupee, Package, RefreshCw, AlertTriangle, Clock, Star } from "lucide-react"
import { Button } from "@/components/ui/button"
import { api, type Visit, type BillingHistoryEntry } from "@/lib/api"
import { getTodayIST } from "@/lib/utils"

type InvStats = Awaited<ReturnType<typeof api.getInventoryAnalytics>>

const DAY_NAMES = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"]
const PALETTE_HEX = ["#10b981","#3b82f6","#8b5cf6","#f59e0b","#f43f5e","#0ea5e9","#ec4899","#14b8a6"]
const PALETTE_CLS = ["from-emerald-500 to-teal-500","from-blue-500 to-indigo-500","from-purple-500 to-fuchsia-500","from-amber-500 to-orange-500","from-rose-500 to-pink-500","from-sky-500 to-cyan-500","from-pink-500 to-rose-500","from-teal-500 to-green-500"]

const fmt = (n: number) => `₹${n.toLocaleString('en-IN',{maximumFractionDigits:0})}`
const pct = (a: number, b: number) => b > 0 ? `${((a/b)*100).toFixed(1)}%` : '0%'

function KpiCard({title,value,sub,icon:Icon,color="text-primary"}:{title:string;value:string;sub?:string;icon:React.ElementType;color?:string}) {
  return (
    <Card>
      <CardContent className="pt-5 pb-4 px-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{title}</p>
            <p className={`text-2xl font-bold mt-1 ${color}`}>{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
          </div>
          <div className="p-2 rounded-md bg-slate-100 dark:bg-muted/60"><Icon className={`h-5 w-5 ${color}`}/></div>
        </div>
      </CardContent>
    </Card>
  )
}

function DonutChart({data,center,centerSub,centerColor}:{data:{label:string;value:number}[];center:string;centerSub?:string;centerColor?:string}) {
  const total = data.reduce((s,d)=>s+Math.abs(d.value),0)||1
  let angle = 0
  const slices = data.map((d,i)=>{
    const a = (Math.abs(d.value)/total)*360
    const s = angle; angle += a
    return {...d,start:s,angle:a,hex:PALETTE_HEX[i%PALETTE_HEX.length],cls:PALETTE_CLS[i%PALETTE_CLS.length]}
  })
  const gradient = `conic-gradient(${slices.map(s=>`${s.hex} ${s.start}deg ${s.start+s.angle}deg`).join(',')})`
  return (
    <div className="flex flex-col md:flex-row items-center gap-6">
      <div className="relative w-44 h-44 shrink-0 rounded-full shadow-xl flex items-center justify-center" style={{background:gradient}}>
        <div className="w-28 h-28 bg-background rounded-full flex flex-col items-center justify-center shadow-inner">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">{centerSub||'Net P&L'}</span>
          <span className={`text-base font-bold leading-tight text-center px-1 ${centerColor||'text-foreground'}`}>{center}</span>
        </div>
      </div>
      <div className="flex-1 grid grid-cols-2 gap-2 w-full">
        {slices.map(s=>(
          <div key={s.label} className="flex items-center gap-2 p-2.5 rounded-lg bg-slate-100 dark:bg-muted/30 border border-slate-200 dark:border-muted/50 hover:bg-slate-200 dark:hover:bg-muted/50 transition-colors">
            <div className={`w-2.5 h-2.5 rounded-full shrink-0 bg-gradient-to-br ${s.cls}`}/>
            <div className="min-w-0 flex-1">
              <div className="text-xs text-muted-foreground truncate leading-tight">{s.label}</div>
              <div className="text-sm font-bold text-foreground leading-snug">{fmt(Math.abs(s.value))} <span className="text-[10px] font-normal text-muted-foreground">({pct(Math.abs(s.value),total)})</span></div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function StackedBar({data}:{data:{week:string;medicine:number;visit_fees:number}[]}) {
  const max = Math.max(...data.map(d=>d.medicine+d.visit_fees),1)
  return (
    <div className="space-y-2">
      {data.map(d=>{
        const total = d.medicine+d.visit_fees
        return (
          <div key={d.week} className="flex items-center gap-2 group">
            <span className="text-[10px] text-muted-foreground w-10 shrink-0 text-right">{d.week}</span>
            <div className="flex-1 h-5 bg-slate-200 dark:bg-muted/40 rounded-sm overflow-hidden flex">
              <div className="h-full bg-blue-500 transition-all" style={{width:`${(d.visit_fees/max)*100}%`}}/>
              <div className="h-full bg-emerald-500 transition-all" style={{width:`${(d.medicine/max)*100}%`}}/>
            </div>
            <span className="text-[10px] font-medium w-16 shrink-0">{fmt(total)}</span>
          </div>
        )
      })}
      <div className="flex gap-4 pt-1">
        <div className="flex items-center gap-1 text-[10px]"><div className="w-2 h-2 rounded-full bg-blue-500"/><span className="text-muted-foreground">Visit Fees</span></div>
        <div className="flex items-center gap-1 text-[10px]"><div className="w-2 h-2 rounded-full bg-emerald-500"/><span className="text-muted-foreground">Medicine Sales</span></div>
      </div>
    </div>
  )
}

function HBar({label,value,max,color,sub}:{label:string;value:number;max:number;color:string;sub?:string}) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs"><span className="font-medium truncate">{label}</span><span className="text-muted-foreground shrink-0 ml-2">{sub??value}</span></div>
      <div className="h-2 bg-slate-200 dark:bg-muted/40 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{width:`${max>0?(value/max)*100:0}%`}}/>
      </div>
    </div>
  )
}

export default function StatusPage() {
  const [visits,setVisits] = useState<Visit[]>([])
  const [bills,setBills] = useState<BillingHistoryEntry[]>([])
  const [inv,setInv] = useState<InvStats|null>(null)
  const [loading,setLoading] = useState(true)
  const [error,setError] = useState<string|null>(null)

  const load = async () => {
    setLoading(true); setError(null)
    try {
      const [vd,bd,id] = await Promise.all([api.getVisits(),api.getBillingHistory({limit:1000,page:1}),api.getInventoryAnalytics()])
      setVisits(vd.filter(v=>v.status!=='deleted'))
      setBills(bd.bills)
      setInv(id)
    } catch(e) { setError(e instanceof Error?e.message:"Failed to load") }
    finally { setLoading(false) }
  }
  useEffect(()=>{load()},[])

  const today = getTodayIST()
  const todayDate = new Date(today)

  const visitStats = useMemo(()=>{
    const byDow=[0,0,0,0,0,0,0]
    const hourMap:Record<number,number>={}
    const patCount:Record<string,number>={}
    visits.forEach(v=>{
      if(v.visit_date) byDow[new Date(v.visit_date).getDay()]++
      if(v.visit_time){const h=parseInt(v.visit_time.split(':')[0]);if(!isNaN(h))hourMap[h]=(hourMap[h]||0)+1}
      patCount[v.patient_id]=(patCount[v.patient_id]||0)+1
    })
    const counts = Object.values(patCount)
    const newP = counts.filter(c=>c===1).length
    const returning = counts.filter(c=>c>1&&c<=5).length
    const loyal = counts.filter(c=>c>5).length
    const total = Object.keys(patCount).length
    const done = visits.filter(v=>v.status==='done').length
    const pending = visits.filter(v=>v.status==='in_progress').length
    const cancelled = visits.filter(v=>v.status==='cancelled').length
    const maxDow = Math.max(...byDow,1)
    const maxHour = Math.max(...Object.values(hourMap),1)
    return {byDow,hourMap,newP,returning,loyal,total,done,pending,cancelled,maxDow,maxHour}
  },[visits])

  const [plPeriod, setPlPeriod] = useState<'today'|'month'|'all'>('month')

  const pl = inv ? (inv.visit_fees_collected + inv.medicine_revenue) - inv.total_purchase_cost : 0
  const plPositive = pl >= 0

  const periodData = inv ? {
    today: {
      fees: inv.today_visit_fees,
      medicine: inv.today_medicine,
      net: inv.today_visit_fees + inv.today_medicine,
      label: 'Today'
    },
    month: {
      fees: inv.month_visit_fees,
      medicine: inv.month_medicine,
      net: inv.month_visit_fees + inv.month_medicine,
      label: 'This Month'
    },
    all: {
      fees: inv.visit_fees_collected,
      medicine: inv.medicine_revenue,
      net: pl,
      label: 'All Time'
    },
  } : null

  const pd = periodData?.[plPeriod]
  const pdPositive = pd ? pd.net >= 0 : true

  return (
    <div className="space-y-6 pb-10">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Clinic Analytics</h1>
          <p className="text-sm text-muted-foreground">Complete financial & operational overview</p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading?'animate-spin':''}`}/>Refresh
        </Button>
      </div>

      {loading && <div className="flex items-center justify-center py-24"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground"/></div>}
      {error && <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-red-600 text-sm">{error}</div>}

      {!loading && inv && (
        <div className="space-y-6">

          {/* ── HERO P&L DONUT ── */}
          <Card className="border-2 border-primary/10 bg-gradient-to-br from-background to-muted/20">
            <CardHeader className="pb-2 pt-5 px-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CardTitle className="text-sm font-semibold">Financial Overview — Net P&L</CardTitle>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${pdPositive?'bg-green-100 dark:bg-green-500/10 text-green-700 dark:text-green-400':'bg-red-100 dark:bg-red-500/10 text-red-700 dark:text-red-400'}`}>
                    {pdPositive?'▲ Profit':'▼ Loss'}
                  </span>
                </div>
                {/* Period switcher */}
                <div className="flex items-center bg-slate-100 dark:bg-muted/40 rounded-lg p-0.5 gap-0.5">
                  {(['today','month','all'] as const).map(p=>(
                    <button key={p} onClick={()=>setPlPeriod(p)}
                      className={`text-xs px-2.5 py-1 rounded-md font-medium transition-all ${
                        plPeriod===p
                          ? 'bg-white dark:bg-background shadow text-foreground'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}>
                      {p==='today'?'Today':p==='month'?'Month':'All Time'}
                    </button>
                  ))}
                </div>
              </div>
            </CardHeader>
            <CardContent className="px-5 pb-5">
              {pd && (
                plPeriod === 'today' ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    {/* Medicine sales split by payment type */}
                    <div className="space-y-3">
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground text-center md:text-left">Medicine Sales by Payment Type</p>
                      <DonutChart
                        center={fmt(pd.medicine)}
                        centerSub="Medicine"
                        centerColor="text-blue-600"
                        data={inv?.today_by_payment && inv.today_by_payment.length > 0
                          ? inv.today_by_payment.map(p => ({label: p.type, value: p.value}))
                          : [{label:"Cash Only (Est.)", value: pd.medicine || 1}]
                        }
                      />
                    </div>
                    {/* Visit fees collected vs pending */}
                    <div className="space-y-3">
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground text-center md:text-left">Visit Fees (Collected vs Pending)</p>
                      <DonutChart
                        center={fmt(pd.fees)}
                        centerSub="Collected Fees"
                        centerColor="text-teal-600"
                        data={[
                          {label:"Collected Fees", value: inv!.today_visit_fees},
                          {label:"Pending Fees", value: inv!.today_visit_fees_pending},
                        ]}
                      />
                    </div>
                  </div>
                ) : (
                  <DonutChart
                    center={fmt(pd.net)}
                    centerSub={pd.label}
                    centerColor={pdPositive ? 'text-emerald-600' : 'text-rose-600'}
                    data={plPeriod === 'all'
                      ? [
                          {label:"Visit Fees Collected", value: inv!.visit_fees_collected},
                          {label:"Medicine Sales", value: inv!.medicine_revenue},
                          {label:"Purchases Spent", value: inv!.total_purchase_cost},
                          {label:"Unpaid Fees", value: inv!.visit_fees_pending},
                        ]
                      : [
                          {label:"Visit Fees", value: pd.fees},
                          {label:"Medicine Sales", value: pd.medicine},
                        ]
                    }
                  />
                )
              )}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-6 pt-4 border-t border-slate-200 dark:border-muted">
                {[
                  {label:"Visit Fees", val: pd?.fees??0, color:"text-teal-600"},
                  {label:"Medicine", val: pd?.medicine??0, color:"text-blue-600"},
                  {label:"Net Income", val: pd?.net??0, color: pdPositive?"text-emerald-600":"text-rose-600"},
                  {label:plPeriod==='all'?'Margin':'of Total', val: null,
                    str: plPeriod==='all'
                      ? pct(pl, inv!.visit_fees_collected+inv!.medicine_revenue)
                      : pct(pd?.net??0, inv!.visit_fees_collected+inv!.medicine_revenue),
                    color: pdPositive?"text-emerald-600":"text-rose-600"},
                ].map(k=>(
                  <div key={k.label} className="text-center p-3 rounded-lg bg-slate-100 dark:bg-muted/40">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{k.label}</div>
                    <div className={`text-lg font-bold mt-0.5 ${k.color}`}>{k.str ?? fmt(k.val!)}</div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* ── TODAY & MONTH KPIs ── */}
          <div className="space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Period Breakdown</p>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <KpiCard title="Today — Visit Fees" value={fmt(inv.today_visit_fees)} sub="collected today" icon={IndianRupee} color="text-teal-600"/>
              <KpiCard title="Today — Medicine" value={fmt(inv.today_medicine)} sub="sold today" icon={Package} color="text-blue-600"/>
              <KpiCard title="This Month — Fees" value={fmt(inv.month_visit_fees)} sub="visit income" icon={TrendingUp} color="text-indigo-600"/>
              <KpiCard title="This Month — Medicine" value={fmt(inv.month_medicine)} sub="sales income" icon={TrendingUp} color="text-emerald-600"/>
            </div>
          </div>

          {/* ── ALERTS (moved up) ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="border-red-200 dark:border-red-800/30">
              <CardHeader className="pb-2 pt-5 px-5">
                <CardTitle className="text-sm font-semibold flex items-center gap-2 text-red-600">
                  <AlertTriangle className="h-4 w-4"/>{inv.low_stock_count} Low Stock Items
                </CardTitle>
              </CardHeader>
              <CardContent className="px-5 pb-5 space-y-2">
                {inv.low_stock.length===0 && <p className="text-xs text-muted-foreground">All items well stocked ✓</p>}
                {inv.low_stock.map((item, index)=>(
                  <div key={`${item.name}-${index}`} className="flex justify-between text-xs py-1 border-b last:border-0">
                    <span className="truncate font-medium">{item.name}</span>
                    <span className="text-red-500 font-bold shrink-0 ml-2">{item.qty} left</span>
                  </div>
                ))}
              </CardContent>
            </Card>
            <Card className="border-amber-200 dark:border-amber-800/30">
              <CardHeader className="pb-2 pt-5 px-5">
                <CardTitle className="text-sm font-semibold flex items-center gap-2 text-amber-600">
                  <Clock className="h-4 w-4"/>{inv.expiring_count} Expiring Soon
                </CardTitle>
              </CardHeader>
              <CardContent className="px-5 pb-5 space-y-2">
                {inv.expiring_soon.length===0 && <p className="text-xs text-muted-foreground">No items expiring soon ✓</p>}
                {inv.expiring_soon.map((item, index)=>(
                  <div key={`${item.name}-${item.expiry}-${index}`} className="flex justify-between text-xs py-1 border-b last:border-0">
                    <span className="truncate font-medium">{item.name}</span>
                    <span className="text-amber-500 font-bold shrink-0 ml-2">{item.expiry}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          {/* ── WEEKLY STACKED BAR + PAYMENT TABLE ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader className="pb-3 pt-5 px-5">
                <CardTitle className="text-sm font-semibold">Income Streams — Last 8 Weeks</CardTitle>
              </CardHeader>
              <CardContent className="px-5 pb-5">
                <StackedBar data={inv.weekly_income}/>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3 pt-5 px-5">
                <CardTitle className="text-sm font-semibold">Income Split (All Time)</CardTitle>
              </CardHeader>
              <CardContent className="px-5 pb-5 space-y-3">
                {[
                  {label:"Visit Fees Collected", value:inv.visit_fees_collected, max:inv.visit_fees_collected+inv.medicine_revenue, color:"bg-teal-500"},
                  {label:"Medicine Revenue", value:inv.medicine_revenue, max:inv.visit_fees_collected+inv.medicine_revenue, color:"bg-blue-500"},
                  {label:"Unpaid Visit Fees", value:inv.visit_fees_pending, max:inv.visit_fees_collected+inv.medicine_revenue, color:"bg-amber-500"},
                  {label:"Purchase Cost", value:inv.total_purchase_cost, max:inv.visit_fees_collected+inv.medicine_revenue, color:"bg-red-500"},
                  {label:"Current Stock Value", value:inv.total_current_value, max:inv.visit_fees_collected+inv.medicine_revenue, color:"bg-indigo-500"},
                ].map(r=><HBar key={r.label} {...r} sub={fmt(r.value)}/>)}
              </CardContent>
            </Card>
          </div>

          {/* ── TOP SELLERS (full width) ── */}
          <Card>
            <CardHeader className="pb-3 pt-5 px-5">
              <CardTitle className="text-sm font-semibold">Top 5 Selling Items</CardTitle>
            </CardHeader>
            <CardContent className="px-5 pb-5">
              {inv.top_items.length===0 && <p className="text-sm text-muted-foreground">No sales data yet.</p>}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {inv.top_items.map((item,i)=>{
                  const max = inv.top_items[0]?.revenue||1
                  return (
                    <div key={item.name} className="space-y-1.5 p-3 rounded-lg bg-slate-100 dark:bg-muted/30 border border-slate-200 dark:border-muted/50">
                      <div className="flex justify-between text-xs">
                        <span className="font-semibold flex items-center gap-1.5">
                          <span className="w-5 h-5 rounded-full bg-slate-200 dark:bg-muted flex items-center justify-center text-[10px] font-bold shrink-0">{i+1}</span>
                          <span className="truncate">{item.name}</span>
                        </span>
                        <span className="font-bold text-foreground shrink-0 ml-2">{fmt(item.revenue)}</span>
                      </div>
                      <div className="h-1.5 bg-slate-200 dark:bg-muted/60 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full bg-gradient-to-r ${PALETTE_CLS[i]}`} style={{width:`${(item.revenue/max)*100}%`}}/>
                      </div>
                      <div className="text-[10px] text-muted-foreground">{item.qty_sold} units sold</div>
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>

          {/* ── PATIENT METRICS ── */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card>
              <CardHeader className="pb-3 pt-5 px-5">
                <CardTitle className="text-sm font-semibold">Patient Loyalty Mix</CardTitle>
              </CardHeader>
              <CardContent className="px-5 pb-5 space-y-3">
                <div className="flex items-center justify-between py-2 border-b">
                  <span className="text-sm text-muted-foreground">Total Unique Patients</span>
                  <span className="text-2xl font-bold text-foreground">{visitStats.total}</span>
                </div>
                {[
                  {label:'New Patients', sub:'1 visit only', val:visitStats.newP, color:'text-emerald-600', bg:'bg-emerald-100 dark:bg-emerald-500/10'},
                  {label:'Returning', sub:'2–5 visits', val:visitStats.returning, color:'text-blue-600', bg:'bg-blue-100 dark:bg-blue-500/10'},
                  {label:'Loyal', sub:'6+ visits', val:visitStats.loyal, color:'text-purple-600', bg:'bg-purple-100 dark:bg-purple-500/10'},
                ].map(s=>(
                  <div key={s.label} className={`flex items-center justify-between p-3 rounded-lg ${s.bg}`}>
                    <div>
                      <div className={`text-sm font-semibold ${s.color}`}>{s.label}</div>
                      <div className="text-xs text-muted-foreground">{s.sub}</div>
                    </div>
                    <div className={`text-2xl font-bold ${s.color}`}>{s.val}</div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3 pt-5 px-5">
                <CardTitle className="text-sm font-semibold">Visit Completion</CardTitle>
              </CardHeader>
              <CardContent className="px-5 pb-5 space-y-3">
                {[
                  {label:"Done",value:visitStats.done,color:"bg-green-500"},
                  {label:"In Progress",value:visitStats.pending,color:"bg-blue-500"},
                  {label:"Cancelled",value:visitStats.cancelled,color:"bg-red-400"},
                ].map(r=><HBar key={r.label} label={r.label} value={r.value} max={visits.length} color={r.color} sub={`${r.value} visits`}/>)}
                <p className="text-xs text-muted-foreground pt-1">Completion rate: <span className="font-semibold text-foreground">{pct(visitStats.done,visits.length)}</span></p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3 pt-5 px-5">
                <CardTitle className="text-sm font-semibold">Busiest Days</CardTitle>
              </CardHeader>
              <CardContent className="px-5 pb-5 space-y-2">
                {DAY_NAMES.map((d,i)=>(
                  <HBar key={d} label={d} value={visitStats.byDow[i]} max={visitStats.maxDow} color="bg-primary/70" sub={`${visitStats.byDow[i]}`}/>
                ))}
              </CardContent>
            </Card>
          </div>



        </div>
      )}
    </div>
  )
}
