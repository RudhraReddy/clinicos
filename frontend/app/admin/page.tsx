"use client"

import { useEffect, useState, useCallback } from "react"
import { cn } from "@/lib/utils"
import { useAuth } from "@/lib/auth_context"
import { useSettings } from "@/lib/settings_context"
import { useRouter } from "next/navigation"
import {
  api, getAdminStats, getAdminUsers, updateAdminUser, getActivityLog, getSystemDiagnostics,
  AdminUser, ActivityEntry, ActivityLogFilters, SystemDiagnostics, type Location,
} from "@/lib/api"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Loader2, Users, Activity, ShieldCheck, LogIn, LogOut, ChevronDown, ChevronRight, ToggleLeft, ToggleRight, Edit, PlusCircle, Plus, Pencil, Trash2, CreditCard, Calendar, Database, HardDrive, ScanEye, CheckCircle2, XCircle } from "lucide-react"
import { toast } from "sonner"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { DatePickerWithRange } from "@/components/ui/date-range-picker"
import { DateRange } from "react-day-picker"
import { format } from "date-fns"

// ─── Helpers ────────────────────────────────────────────────────────────────

function fmtTime(iso: string) {
  const d = new Date(iso)
  return d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true, dateStyle: 'short', timeStyle: 'short' })
}

function fmtBytes(bytes: number, decimals = 2) {
  if (!bytes || bytes <= 0) return '0 Bytes'
  const k = 1024
  const dm = decimals < 0 ? 0 : decimals
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i]
}

function fmtDate(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', year: 'numeric', month: 'short', day: 'numeric' })
}

function dateKey(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', year: 'numeric', month: 'short', day: 'numeric' })
}

const ACTION_COLORS: Record<string, string> = {
  CREATE: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  UPDATE: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  DELETE: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  LOGIN: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  LOGOUT: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
}

const ACTION_ICONS: Record<string, React.ElementType> = {
  CREATE: PlusCircle,
  UPDATE: Pencil,
  DELETE: Trash2,
  LOGIN: LogIn,
  LOGOUT: LogOut,
}

const ROLE_COLORS: Record<string, string> = {
  admin: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
  doctor: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  staff: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
}

// ─── Overview Tab ────────────────────────────────────────────────────────────

function OverviewTab() {
  const [stats, setStats] = useState<Awaited<ReturnType<typeof getAdminStats>> | null>(null)
  const [loading, setLoading] = useState(true)

  const [diag, setDiag] = useState<SystemDiagnostics | null>(null)
  const [runningDiag, setRunningDiag] = useState(false)

  const runDiagnostics = async () => {
    setRunningDiag(true)
    try {
      const data = await getSystemDiagnostics()
      setDiag(data)
      toast.success('Infrastructure Scan Successful')
    } catch (err) {
      toast.error('Failed to scan system infrastructure')
    } finally {
      setRunningDiag(false)
    }
  }

  useEffect(() => {
    getAdminStats()
      .then(setStats)
      .catch(() => toast.error('Failed to load stats'))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
  if (!stats) return null

  const kpiCards = [
    { label: 'Activities Today', value: stats.activities_today, icon: Activity, color: 'text-indigo-600', bg: 'bg-indigo-50 dark:bg-indigo-950/30 dark:text-indigo-400' },
    { label: 'Logged-in Users', value: stats.active_users, icon: Users, color: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-950/30 dark:text-emerald-400' },
    { label: "Today's Total Visits", value: stats.visits_today, icon: Calendar, color: 'text-amber-600', bg: 'bg-amber-50 dark:bg-amber-950/30 dark:text-amber-400' },
    { label: 'Bills Created Today', value: stats.bills_today, icon: CreditCard, color: 'text-rose-600', bg: 'bg-rose-50 dark:bg-rose-950/30 dark:text-rose-400' },
    { label: 'Registered Patients', value: stats.total_patients, icon: Users, color: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-950/30 dark:text-blue-400' },
    { label: 'Audit History Depth', value: stats.total_audit_entries, icon: ShieldCheck, color: 'text-purple-600', bg: 'bg-purple-50 dark:bg-purple-950/30 dark:text-purple-400' },
  ]

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
      {/* LEFT COLUMN: STATUS */}
      <Card className="shadow-md border overflow-hidden flex flex-col h-full">
        <CardHeader className="pb-3 border-b bg-muted/10 shrink-0">
          <CardTitle className="flex items-center gap-2 text-sm font-bold tracking-tight text-foreground/80">
            <ShieldCheck className="h-4 w-4 text-primary" />
            Live System Metrics
          </CardTitle>
        </CardHeader>
        
        <CardContent className="p-6 flex flex-col h-full justify-between space-y-8">
          {/* Primary Stats Breakdown - Clean Inline Rendering */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-6">
            {kpiCards.map((c, idx) => (
              <div key={c.label} className={cn(
                "flex items-center gap-4 p-4 rounded-2xl transition-colors",
                idx % 2 === 0 ? "bg-muted/5" : "bg-muted/5"
              )}>
                <div className={cn("p-3 rounded-xl ring-1 ring-inset ring-black/5 dark:ring-white/5", c.bg)}>
                  <c.icon className={cn("h-5 w-5", c.color)} />
                </div>
                <div className="space-y-0.5">
                  <p className="text-[10px] font-bold text-muted-foreground tracking-widest uppercase leading-none mb-1">{c.label}</p>
                  <p className="text-3xl font-black tracking-tight leading-none text-foreground">{c.value}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Connected Role Distribution at bottom */}
          <div className="bg-muted/10 border border-dashed border-muted-foreground/20 rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-4">
              <Users className="h-3.5 w-3.5 text-muted-foreground" />
              <h3 className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">User Distributions</h3>
            </div>
            <div className="flex flex-wrap gap-2.5">
              {['admin', 'doctor', 'staff'].map(role => {
                const count = stats.users_by_role[role] || 0
                return (
                  <div key={role} className={cn(
                    "flex items-center gap-3 px-3.5 py-1.5 rounded-full border shadow-sm ring-1 ring-black/5 transition-transform hover:scale-105",
                    ROLE_COLORS[role] || 'bg-muted text-muted-foreground'
                  )}>
                    <span className="capitalize text-[11px] font-bold tracking-wide">{role}</span>
                    <span className="font-extrabold text-sm border-l border-current/20 pl-3">{count}</span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Infrastructure Diagnostics Section */}
          <div className="border border-muted/60 bg-muted/5 rounded-2xl overflow-hidden transition-all shadow-inner">
            <div className="px-4 py-2.5 border-b border-muted flex items-center justify-between bg-muted/10">
              <div className="flex items-center gap-2">
                <HardDrive className="h-3.5 w-3.5 text-muted-foreground/70" />
                <h3 className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Infrastructure Telemetry</h3>
              </div>
              <Button 
                variant="ghost" 
                size="sm" 
                className={cn(
                  "h-6 px-2.5 text-[10px] font-bold uppercase gap-1.5 rounded-full border transition-all",
                  runningDiag ? "opacity-70 cursor-not-allowed" : "border-transparent hover:border-muted hover:bg-background active:scale-95"
                )}
                onClick={runDiagnostics}
                disabled={runningDiag}
              >
                {runningDiag ? <Loader2 className="h-3 w-3 animate-spin" /> : <ScanEye className="h-3 w-3" />}
                {diag ? 'Refresh Scan' : 'Run Diagnostics'}
              </Button>
            </div>

            {diag ? (
              <div className="p-4 space-y-4">
                {/* Quick Info Cards Grid */}
                <div className="grid grid-cols-2 gap-3">
                  {/* OCR Indicator */}
                  <div className="flex items-center gap-3 p-2 bg-background/50 border rounded-xl">
                    {diag.ocr_configured ? (
                      <div className="h-7 w-7 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-600 dark:text-emerald-400"><CheckCircle2 className="h-4 w-4" /></div>
                    ) : (
                      <div className="h-7 w-7 rounded-full bg-rose-500/10 flex items-center justify-center text-rose-600 dark:text-rose-400"><XCircle className="h-4 w-4" /></div>
                    )}
                    <div className="min-w-0">
                      <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider leading-none mb-0.5">OCR Service</p>
                      <p className="text-xs font-bold truncate">{diag.ocr_configured ? 'Google Vision Active' : 'Not Configured'}</p>
                    </div>
                  </div>

                  {/* DB Size */}
                  <div className="flex items-center gap-3 p-2 bg-background/50 border rounded-xl">
                    <div className="h-7 w-7 rounded-full bg-indigo-500/10 flex items-center justify-center text-indigo-600 dark:text-indigo-400"><Database className="h-4 w-4" /></div>
                    <div>
                      <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider leading-none mb-0.5">DB Footprint</p>
                      <p className="text-xs font-bold">{fmtBytes(diag.db_size_bytes)}</p>
                    </div>
                  </div>
                </div>

                {/* Container Storage Analysis */}
                <div className="space-y-2 p-3 bg-background/30 border border-dashed rounded-xl">
                  <div className="flex justify-between text-[10px] font-bold text-foreground uppercase tracking-tight">
                    <span className="flex items-center gap-1"><HardDrive className="h-3 w-3 text-muted-foreground" /> Container Root Volume</span>
                    <span className="text-muted-foreground">{diag.system_disk.total > 0 ? `${Math.round((diag.system_disk.used / diag.system_disk.total) * 100)}% Capacity` : 'Metric Pending'}</span>
                  </div>
                  
                  <div className="w-full h-2 bg-muted rounded-full overflow-hidden ring-1 ring-inset ring-black/5 dark:ring-white/5">
                    <div 
                      className={cn(
                        "h-full transition-all duration-700 ease-out rounded-full",
                        diag.system_disk.total > 0 && (diag.system_disk.used / diag.system_disk.total) > 0.8 ? "bg-rose-500" : "bg-primary"
                      )}
                      style={{ width: `${diag.system_disk.total > 0 ? (diag.system_disk.used / diag.system_disk.total) * 100 : 0}%` }} 
                    />
                  </div>

                  <div className="flex justify-between text-[10px] text-muted-foreground font-medium pt-0.5">
                    <span className="flex items-center gap-1">Media Files: <strong className="text-foreground font-bold">{fmtBytes(diag.media_size_bytes)}</strong></span>
                    <span>Total Allocated: {fmtBytes(diag.system_disk.total)}</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-5 text-center flex flex-col items-center justify-center opacity-60 group-hover:opacity-100 transition-opacity">
                <HardDrive className="h-5 w-5 text-muted-foreground mb-2 stroke-[1.5]" />
                <p className="text-[11px] font-medium text-muted-foreground italic leading-tight">Disk scanning and service verification<br />available on trigger.</p>
              </div>
            )}
          </div>

          {/* System Connectivity Banner */}
          <div className="flex items-center justify-between text-[10px] font-medium text-muted-foreground border-t border-dashed border-muted mt-auto pt-4">
            <div className="flex items-center gap-2.5">
              <div className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </div>
              <span className="tracking-widest uppercase font-bold text-emerald-600 dark:text-emerald-400">Core Services Active</span>
            </div>
            <div className="flex items-center gap-3 text-muted-foreground/60 font-semibold uppercase tracking-wider">
              <span>API v1.2</span>
              <span className="w-1 h-1 rounded-full bg-muted-foreground/40"></span>
              <span className="text-foreground font-bold">Secure Connection</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* RIGHT COLUMN: RECENT ACTIVITY */}
      <Card className="shadow-md overflow-hidden border flex flex-col h-full min-h-[500px]">
        <CardHeader className="pb-3 border-b bg-muted/10 shrink-0">
          <CardTitle className="flex items-center gap-2 text-sm font-bold tracking-tight text-foreground/80">
            <Activity className="h-4 w-4 text-primary" />
            Recent System Activity
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 flex-1 overflow-hidden flex flex-col">
          <div className="p-5 space-y-0 flex-1 overflow-y-auto max-h-[550px] custom-scrollbar">
            {stats.recent_activity.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                <Activity className="h-8 w-8 opacity-20 mb-2" />
                <p className="text-sm font-medium italic">No recorded activities yet.</p>
              </div>
            ) : (
              stats.recent_activity.map((e, idx) => {
                const Icon = ACTION_ICONS[e.action] || Activity
                const colorClass = ACTION_COLORS[e.action] || ''
                const actionLabel = e.action === 'CREATE' ? 'created' : e.action === 'UPDATE' ? 'updated' : e.action === 'DELETE' ? 'deleted' : e.action === 'LOGIN' ? 'logged in' : e.action === 'LOGOUT' ? 'logged out' : e.action.toLowerCase()
                
                return (
                  <div key={e.id} className="relative flex gap-4 pb-6 last:pb-2 group">
                    {/* Connector line */}
                    {idx !== stats.recent_activity.length - 1 && (
                      <span className="absolute left-[15px] top-8 -bottom-1 w-px bg-muted-foreground/20 group-last:hidden" aria-hidden="true" />
                    )}
                    
                    {/* Status dot/icon */}
                    <div className={cn(
                      "relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border shadow-sm ring-4 ring-background",
                      colorClass
                    )}>
                      <Icon className="h-3.5 w-3.5" />
                    </div>

                    {/* Item Info */}
                    <div className="flex flex-1 flex-col min-w-0 pt-0.5">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-x-3 gap-y-1">
                        <p className="text-sm leading-snug font-medium text-foreground/90">
                          <span className="font-semibold text-foreground">{e.username || 'System'}</span>
                          {' '}
                          <span className="text-muted-foreground font-normal">{actionLabel}</span>
                          {' '}
                          {e.resource_type && e.resource_type !== 'auth' && (
                            <span className="capitalize text-primary/80 font-medium tracking-tight">{e.resource_type.replace('_', ' ')}</span>
                          )}
                        </p>
                        <time className="text-xs whitespace-nowrap tabular-nums text-muted-foreground bg-secondary/50 border border-muted/30 px-2 py-0.5 rounded-full inline-flex self-start sm:self-auto">
                          {fmtTime(e.timestamp)}
                        </time>
                      </div>
                      {e.resource_label && (
                        <p className="mt-1 text-xs text-muted-foreground/70 truncate italic pl-1 border-l-2 border-muted ml-0.5">
                          {e.resource_label}
                        </p>
                      )}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ─── Users Tab ───────────────────────────────────────────────────────────────

function UsersTab() {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState<string | null>(null)

  // Edit user state
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null)
  const [editUsername, setEditUsername] = useState("")
  const [editRole, setEditRole] = useState<'staff' | 'doctor' | 'admin'>("staff")
  const [editLocation, setEditLocation] = useState("")
  const [editActive, setEditActive] = useState(true)
  const [editAssignedStaffIds, setEditAssignedStaffIds] = useState<string[]>([])

  const load = useCallback(() => {
    setLoading(true)
    getAdminUsers()
      .then(setUsers)
      .catch(() => toast.error('Failed to load users'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const handleEditClick = (u: AdminUser) => {
    setEditingUser(u)
    setEditUsername(u.username)
    setEditRole(u.role)
    setEditLocation(u.location_label || "")
    setEditActive(u.is_active)
    setEditAssignedStaffIds(u.assigned_staff_ids || [])
  }

  const handleSaveEdit = async () => {
    if (!editingUser) return
    setUpdating(editingUser.user_id)
    try {
      const payload: any = {
        username: editUsername,
        role: editRole,
        location_label: editLocation || null,
        is_active: editActive,
      }
      if (editRole === 'doctor') {
        payload.assigned_staff_ids = editAssignedStaffIds
      }

      const res = await fetch(`/api/admin/users/${editingUser.user_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || 'Failed to update user')
      }

      toast.success('User updated successfully')
      setEditingUser(null)
      load()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Update failed')
    } finally {
      setUpdating(null)
    }
  }

  const activeStaff = users.filter(u => u.role === 'staff' && u.is_active)

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>

  return (
    <Card>
      <CardContent className="pt-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Location</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Edit</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map(u => (
              <TableRow key={u.user_id} className={!u.is_active ? 'opacity-50' : ''}>
                <TableCell className="font-medium">{u.username}</TableCell>
                <TableCell>
                  <Badge variant="outline" className={ROLE_COLORS[u.role] || ''}>
                    {u.role}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{u.location_label ?? '—'}</TableCell>
                <TableCell>
                  <Badge variant={u.is_active ? 'default' : 'secondary'}>
                    {u.is_active ? 'Active' : 'Inactive'}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleEditClick(u)}
                    title="Edit User"
                  >
                    <Edit className="h-4 w-4 text-primary" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {/* User Edit Dialog */}
        <Dialog open={!!editingUser} onOpenChange={(open) => !open && setEditingUser(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Edit User Details</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1">
                <Label htmlFor="edit-username" className="text-sm font-semibold">User Name</Label>
                <Input
                  id="edit-username"
                  value={editUsername}
                  onChange={(e) => setEditUsername(e.target.value)}
                  placeholder="Username"
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="edit-role" className="text-sm font-semibold">Role</Label>
                <select
                  id="edit-role"
                  className="w-full h-10 px-3 py-2 border rounded-md bg-background text-sm"
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value as any)}
                >
                  <option value="staff">staff</option>
                  <option value="doctor">doctor</option>
                  <option value="admin">admin</option>
                </select>
              </div>

              <div className="space-y-1">
                <Label htmlFor="edit-location" className="text-sm font-semibold">Location</Label>
                <Input
                  id="edit-location"
                  value={editLocation}
                  onChange={(e) => setEditLocation(e.target.value)}
                  placeholder="Location / Chamber Label"
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="edit-status" className="text-sm font-semibold">Status</Label>
                <select
                  id="edit-status"
                  className="w-full h-10 px-3 py-2 border rounded-md bg-background text-sm"
                  value={editActive ? "active" : "inactive"}
                  onChange={(e) => setEditActive(e.target.value === "active")}
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>

              {/* Staff Assignments for Doctor Role */}
              {editRole === 'doctor' && (
                <div className="space-y-2 border-t pt-4">
                  <Label className="text-sm font-semibold">Assign Staff to Doctor</Label>
                  <p className="text-xs text-muted-foreground">Select staff members assigned to this doctor.</p>
                  <div className="space-y-1.5 max-h-40 overflow-y-auto border rounded p-2 bg-muted/15">
                    {activeStaff.map(staff => {
                      const checked = editAssignedStaffIds.includes(staff.user_id)
                      return (
                        <label key={staff.user_id} className="flex items-center gap-2 text-sm cursor-pointer py-1 hover:bg-muted/30 px-1 rounded">
                          <input
                            type="checkbox"
                            checked={checked}
                            className="rounded border-gray-300 text-primary focus:ring-primary"
                            onChange={(e) => {
                              if (e.target.checked) {
                                setEditAssignedStaffIds([...editAssignedStaffIds, staff.user_id])
                              } else {
                                setEditAssignedStaffIds(editAssignedStaffIds.filter(id => id !== staff.user_id))
                              }
                            }}
                          />
                          <span>{staff.username} {staff.location_label ? `(${staff.location_label})` : ''}</span>
                        </label>
                      )
                    })}
                    {activeStaff.length === 0 && (
                      <p className="text-xs text-muted-foreground text-center py-2">No active staff users available.</p>
                    )}
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-4 border-t">
                <Button variant="outline" onClick={() => setEditingUser(null)} disabled={!!updating}>
                  Cancel
                </Button>
                <Button onClick={handleSaveEdit} disabled={!!updating}>
                  {updating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  Save Changes
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  )
}

// ─── Activity Log Tab ─────────────────────────────────────────────────────────

function ActivityLogTab({ allUsers }: { allUsers: AdminUser[] }) {
  const [entries, setEntries] = useState<ActivityEntry[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState<ActivityLogFilters>({})
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set())
  const [date, setDate] = useState<DateRange | undefined>()

  useEffect(() => {
    setFilters(prev => ({
      ...prev,
      date_from: date?.from ? format(date.from, 'yyyy-MM-dd') : undefined,
      date_to: date?.to ? format(date.to, 'yyyy-MM-dd') : date?.from ? format(date.from, 'yyyy-MM-dd') : undefined,
    }))
    setPage(1)
  }, [date])

  const LIMIT = 50

  const load = useCallback(async (f: ActivityLogFilters, p: number) => {
    setLoading(true)
    try {
      const data = await getActivityLog({ ...f, page: p, limit: LIMIT })
      setEntries(data.entries)
      setTotal(data.total)
    } catch {
      toast.error('Failed to load activity log')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load(filters, page) }, [load, filters, page])

  const setFilter = (key: keyof ActivityLogFilters, val: string) => {
    setFilters(prev => ({ ...prev, [key]: val || undefined }))
    setPage(1)
  }

  const toggleDay = (day: string) => {
    setExpandedDays(prev => {
      const next = new Set(prev)
      next.has(day) ? next.delete(day) : next.add(day)
      return next
    })
  }

  // Group entries by date
  const grouped: Record<string, ActivityEntry[]> = {}
  for (const e of entries) {
    const day = dateKey(e.timestamp)
    if (!grouped[day]) grouped[day] = []
    grouped[day].push(e)
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">User</label>
              <select className="text-sm border rounded px-2 py-1 bg-background min-w-[140px]"
                onChange={e => setFilter('user_id', e.target.value)}>
                <option value="">All Users</option>
                {allUsers.map(u => <option key={u.user_id} value={u.user_id}>{u.username} ({u.role})</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Action</label>
              <select className="text-sm border rounded px-2 py-1 bg-background"
                onChange={e => setFilter('action', e.target.value)}>
                <option value="">All Actions</option>
                {['CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT'].map(a =>
                  <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Resource</label>
              <select className="text-sm border rounded px-2 py-1 bg-background"
                onChange={e => setFilter('resource_type', e.target.value)}>
                <option value="">All Resources</option>
                {['patient', 'visit', 'bill', 'patient_image', 'inventory_product', 'inventory_batch', 'purchase_invoice', 'user', 'auth'].map(r =>
                  <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Date Range</label>
              <DatePickerWithRange date={date} setDate={setDate} className="w-[260px]" />
            </div>
          </div>
        </CardContent>
      </Card>

      {loading && <div className="flex justify-center py-8"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>}

      {!loading && entries.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">No activity found</div>
      )}

      {/* Grouped by day */}
      {!loading && Object.entries(grouped).map(([day, dayEntries]) => {
        const isOpen = expandedDays.has(day)
        return (
          <Card key={day}>
            <CardHeader className="py-3 cursor-pointer hover:bg-muted/50 rounded-t-lg"
              onClick={() => toggleDay(day)}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 font-medium">
                  {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  {day}
                </div>
                <Badge variant="secondary">{dayEntries.length} events</Badge>
              </div>
            </CardHeader>
            {isOpen && (
              <CardContent className="pt-0">
                <div className="flex flex-col gap-1 px-2 py-4 border-t max-h-[500px] overflow-y-auto pr-3">
                  {dayEntries.map((e, idx) => {
                    const Icon = ACTION_ICONS[e.action] || Activity
                    const colorClass = ACTION_COLORS[e.action] || ''
                    const actionLabel = e.action === 'CREATE' ? 'created' : e.action === 'UPDATE' ? 'updated' : e.action === 'DELETE' ? 'deleted' : e.action === 'LOGIN' ? 'logged in' : e.action === 'LOGOUT' ? 'logged out' : e.action.toLowerCase()

                    return (
                      <div key={e.id} className="relative flex gap-3 pb-3 last:pb-0 group items-start">
                        {idx !== dayEntries.length - 1 && (
                          <span className="absolute left-[13px] top-7 -bottom-3 w-px bg-muted-foreground/20 group-last:hidden" aria-hidden="true" />
                        )}
                        <div className={cn(
                          "relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border shadow-sm ring-4 ring-background",
                          colorClass
                        )}>
                          <Icon className="h-3 w-3" />
                        </div>
                        <div className="flex-1 flex flex-col min-w-0 pt-0.5">
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="flex items-center flex-wrap gap-x-2 text-sm leading-none min-w-0 flex-1">
                              <span className="font-semibold text-foreground shrink-0">{e.username || 'System'}</span>
                              <span className="text-muted-foreground shrink-0">{actionLabel}</span>
                              {e.resource_type && e.resource_type !== 'auth' && (
                                <span className="capitalize text-primary/80 font-medium shrink-0">{e.resource_type.replace('_', ' ')}</span>
                              )}
                              {e.resource_label && (
                                <span className="text-muted-foreground/60 truncate italic max-w-md">— {e.resource_label}</span>
                              )}
                            </div>
                            <time className="text-[11px] tabular-nums text-muted-foreground shrink-0 whitespace-nowrap">
                              {new Date(e.timestamp).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true, hour: 'numeric', minute: '2-digit' })}
                            </time>
                          </div>
                          {e.details && (
                            <p className="mt-0.5 text-[11px] text-muted-foreground/50 truncate font-mono select-all">
                              {e.details}
                            </p>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </CardContent>
            )}
          </Card>
        )
      })}

      {/* Pagination */}
      {total > LIMIT && (
        <div className="flex items-center justify-center gap-3">
          <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
          <span className="text-sm text-muted-foreground">Page {page} of {Math.ceil(total / LIMIT)}</span>
          <Button variant="outline" size="sm" disabled={page * LIMIT >= total} onClick={() => setPage(p => p + 1)}>Next</Button>
        </div>
      )}
    </div>
  )
}

// ─── Settings Tab ─────────────────────────────────────────────────────────────

function SettingsTab() {
    const { expiryReminderMonths, setSettings } = useSettings()
    const [localMonths, setLocalMonths] = useState(expiryReminderMonths)

    useEffect(() => {
        setLocalMonths(expiryReminderMonths)
    }, [expiryReminderMonths])

    const handleSave = () => {
        const val = Math.max(1, Math.min(24, localMonths))
        setSettings({ expiryReminderMonths: val })
        toast.success(`Expiry reminder set to ${val} months`)
    }

    // ── Locations state ──
    const [locations, setLocations] = useState<Location[]>([])
    const [locLoading, setLocLoading] = useState(true)
    const [newLocName, setNewLocName] = useState('')
    const [addingLoc, setAddingLoc] = useState(false)
    const [editingLocId, setEditingLocId] = useState<number | null>(null)
    const [editingLocName, setEditingLocName] = useState('')

    const loadLocations = async () => {
        setLocLoading(true)
        try {
            setLocations(await api.getLocations())
        } catch {
            toast.error('Failed to load locations')
        } finally {
            setLocLoading(false)
        }
    }

    useEffect(() => { loadLocations() }, []) // eslint-disable-line react-hooks/exhaustive-deps

    const handleAddLocation = async () => {
        const name = newLocName.trim()
        if (!name) return
        try {
            await api.createLocation(name)
            setNewLocName('')
            setAddingLoc(false)
            await loadLocations()
            toast.success(`Location "${name}" created`)
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : 'Failed to create location')
        }
    }

    const handleRenameLocation = async (id: number) => {
        const name = editingLocName.trim()
        if (!name) return
        try {
            await api.updateLocation(id, { name })
            setEditingLocId(null)
            await loadLocations()
            toast.success('Location renamed')
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : 'Failed to rename')
        }
    }

    const handleToggleActive = async (loc: Location) => {
        try {
            await api.updateLocation(loc.id, { is_active: !loc.is_active })
            await loadLocations()
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : 'Failed to update')
        }
    }

    const handleDeleteLocation = async (loc: Location) => {
        if (!window.confirm(`Delete location "${loc.name}"? This cannot be undone.`)) return
        try {
            const res = await api.deleteLocation(loc.id)
            if (res.error) {
                toast.error(res.error)
            } else {
                await loadLocations()
                toast.success(`Deleted "${loc.name}"`)
            }
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : 'Failed to delete')
        }
    }

    return (
        <div className="space-y-6 max-w-lg">
            {/* ── Inventory Settings ── */}
            <div>
                <h2 className="text-lg font-semibold mb-1">Inventory Settings</h2>
                <p className="text-sm text-muted-foreground">
                    These settings apply across all inventory tables and dashboards.
                </p>
            </div>
            <div className="rounded-lg border p-4 space-y-4">
                <div className="space-y-1">
                    <label className="text-sm font-medium">Expiry Reminder (months)</label>
                    <p className="text-xs text-muted-foreground">
                        Items expiring within this many months will be flagged as &quot;Expires Soon&quot;.
                    </p>
                    <div className="flex items-center gap-3 mt-2">
                        <input
                            type="number"
                            min={1}
                            max={24}
                            value={localMonths}
                            onChange={e => {
                                const n = parseInt(e.target.value, 10)
                                if (!isNaN(n)) setLocalMonths(n)
                            }}
                            className="w-24 h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                        />
                        <span className="text-sm text-muted-foreground">months (1–24)</span>
                    </div>
                </div>
                <Button size="sm" onClick={handleSave}>Save Settings</Button>
            </div>

            {/* ── Locations ── */}
            <div>
                <h2 className="text-lg font-semibold mb-1">Locations</h2>
                <p className="text-sm text-muted-foreground">
                    Clinic branches or chambers. Used to track inventory and billing per location.
                </p>
            </div>
            <div className="rounded-lg border divide-y">
                {locLoading ? (
                    <div className="p-4 text-sm text-muted-foreground">Loading…</div>
                ) : locations.length === 0 && !addingLoc ? (
                    <div className="p-4 text-sm text-muted-foreground">No locations yet.</div>
                ) : (
                    locations.map(loc => (
                        <div key={loc.id} className="flex items-center gap-2 px-4 py-3">
                            {editingLocId === loc.id ? (
                                <>
                                    <Input
                                        autoFocus
                                        value={editingLocName}
                                        onChange={e => setEditingLocName(e.target.value)}
                                        onKeyDown={e => {
                                            if (e.key === 'Enter') handleRenameLocation(loc.id)
                                            if (e.key === 'Escape') setEditingLocId(null)
                                        }}
                                        className="h-8 flex-1"
                                    />
                                    <Button size="sm" onClick={() => handleRenameLocation(loc.id)}>Save</Button>
                                    <Button size="sm" variant="ghost" onClick={() => setEditingLocId(null)}>Cancel</Button>
                                </>
                            ) : (
                                <>
                                    <span className="flex-1 text-sm font-medium">{loc.name}</span>
                                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${loc.is_active ? 'bg-green-100 text-green-700' : 'bg-muted text-muted-foreground'}`}>
                                        {loc.is_active ? 'Active' : 'Inactive'}
                                    </span>
                                    <Button
                                        size="icon"
                                        variant="ghost"
                                        className="h-8 w-8"
                                        title="Rename"
                                        onClick={() => { setEditingLocId(loc.id); setEditingLocName(loc.name) }}
                                    >
                                        <Pencil className="h-3.5 w-3.5" />
                                    </Button>
                                    <Button
                                        size="icon"
                                        variant="ghost"
                                        className="h-8 w-8"
                                        title={loc.is_active ? 'Deactivate' : 'Reactivate'}
                                        onClick={() => handleToggleActive(loc)}
                                    >
                                        {loc.is_active ? <XCircle className="h-3.5 w-3.5 text-muted-foreground" /> : <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />}
                                    </Button>
                                    <Button
                                        size="icon"
                                        variant="ghost"
                                        className="h-8 w-8 text-rose-600 hover:text-rose-700"
                                        title="Delete"
                                        onClick={() => handleDeleteLocation(loc)}
                                    >
                                        <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                </>
                            )}
                        </div>
                    ))
                )}

                {addingLoc && (
                    <div className="flex items-center gap-2 px-4 py-3">
                        <Input
                            autoFocus
                            placeholder="Location name…"
                            value={newLocName}
                            onChange={e => setNewLocName(e.target.value)}
                            onKeyDown={e => {
                                if (e.key === 'Enter') handleAddLocation()
                                if (e.key === 'Escape') { setAddingLoc(false); setNewLocName('') }
                            }}
                            className="h-8 flex-1"
                        />
                        <Button size="sm" onClick={handleAddLocation}>Add</Button>
                        <Button size="sm" variant="ghost" onClick={() => { setAddingLoc(false); setNewLocName('') }}>Cancel</Button>
                    </div>
                )}

                <div className="px-4 py-3">
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setAddingLoc(true)}
                        disabled={addingLoc}
                    >
                        <Plus className="h-3.5 w-3.5 mr-1.5" />
                        Add Location
                    </Button>
                </div>
            </div>
        </div>
    )
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function AdminPage() {
  const { role, isLoading } = useAuth()
  const router = useRouter()
  const [allUsers, setAllUsers] = useState<AdminUser[]>([])

  useEffect(() => {
    if (!isLoading && role !== 'admin') {
      router.replace('/')
    }
  }, [role, isLoading, router])

  useEffect(() => {
    if (role === 'admin') {
      getAdminUsers().then(setAllUsers).catch(() => {})
    }
  }, [role])

  if (isLoading) {
    return <div className="flex justify-center py-24"><Loader2 className="h-10 w-10 animate-spin text-muted-foreground" /></div>
  }

  if (role !== 'admin') return null

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <ShieldCheck className="h-7 w-7 text-purple-600" />
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Admin Panel</h1>
          <p className="text-muted-foreground">System administration, user management, and audit log</p>
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="activity">Activity Log</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <OverviewTab />
        </TabsContent>

        <TabsContent value="users" className="mt-4">
          <UsersTab />
        </TabsContent>

        <TabsContent value="activity" className="mt-4">
          <ActivityLogTab allUsers={allUsers} />
        </TabsContent>

        <TabsContent value="settings" className="mt-4">
          <SettingsTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}
