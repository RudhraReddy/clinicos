"use client"

import { useEffect, useState, useCallback } from "react"
import { useAuth } from "@/lib/auth_context"
import { useRouter } from "next/navigation"
import {
  getAdminStats, getAdminUsers, updateAdminUser, getActivityLog,
  AdminUser, ActivityEntry, ActivityLogFilters,
} from "@/lib/api"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Loader2, Users, Activity, ShieldCheck, LogIn, ChevronDown, ChevronRight, ToggleLeft, ToggleRight, Edit } from "lucide-react"
import { toast } from "sonner"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

// ─── Helpers ────────────────────────────────────────────────────────────────

function fmtTime(iso: string) {
  const d = new Date(iso)
  return d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true, dateStyle: 'short', timeStyle: 'short' })
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

const ROLE_COLORS: Record<string, string> = {
  admin: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
  doctor: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  staff: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
}

// ─── Overview Tab ────────────────────────────────────────────────────────────

function OverviewTab() {
  const [stats, setStats] = useState<Awaited<ReturnType<typeof getAdminStats>> | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getAdminStats()
      .then(setStats)
      .catch(() => toast.error('Failed to load stats'))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
  if (!stats) return null

  const kpiCards = [
    { label: 'Active Users', value: stats.active_users, icon: Users, color: 'text-blue-600' },
    { label: 'Inactive Users', value: stats.inactive_users, icon: Users, color: 'text-gray-400' },
    { label: 'Logins Today', value: stats.logins_today, icon: LogIn, color: 'text-green-600' },
    { label: 'Total Audit Entries', value: stats.total_audit_entries, icon: Activity, color: 'text-purple-600' },
  ]

  return (
    <div className="space-y-6">
      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {kpiCards.map(c => (
          <Card key={c.label}>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <c.icon className={`h-8 w-8 ${c.color}`} />
                <div>
                  <p className="text-2xl font-bold">{c.value}</p>
                  <p className="text-xs text-muted-foreground">{c.label}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Users by role */}
      <Card>
        <CardHeader><CardTitle className="text-base">Users by Role</CardTitle></CardHeader>
        <CardContent className="flex gap-4 flex-wrap">
          {Object.entries(stats.users_by_role).map(([role, count]) => (
            <div key={role} className="flex items-center gap-2">
              <Badge className={ROLE_COLORS[role] || ''}>{role}</Badge>
              <span className="font-semibold">{count}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Recent activity */}
      <Card>
        <CardHeader><CardTitle className="text-base">Recent Activity</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-2">
            {stats.recent_activity.map(e => (
              <div key={e.id} className="flex items-center gap-3 text-sm py-1 border-b last:border-0">
                <span className="text-xs text-muted-foreground w-32 shrink-0">{fmtTime(e.timestamp)}</span>
                <Badge variant="outline" className={`${ACTION_COLORS[e.action] || ''} text-xs`}>{e.action}</Badge>
                <span className="font-medium">{e.username ?? '—'}</span>
                <span className="text-muted-foreground">{e.resource_type}</span>
                <span className="truncate text-muted-foreground">{e.resource_label}</span>
              </div>
            ))}
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
              <label className="text-xs text-muted-foreground">From</label>
              <input type="date" className="text-sm border rounded px-2 py-1 bg-background"
                onChange={e => setFilter('date_from', e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">To</label>
              <input type="date" className="text-sm border rounded px-2 py-1 bg-background"
                onChange={e => setFilter('date_to', e.target.value)} />
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
                <div className="space-y-1">
                  {dayEntries.map(e => (
                    <div key={e.id} className="flex items-start gap-3 py-1.5 border-b last:border-0 text-sm">
                      <span className="text-xs text-muted-foreground w-20 shrink-0 mt-0.5">
                        {new Date(e.timestamp).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true })}
                      </span>
                      <Badge className={`${ACTION_COLORS[e.action] || ''} text-xs shrink-0`}>{e.action}</Badge>
                      <span className="font-medium shrink-0 w-24 truncate">{e.username ?? '—'}</span>
                      <span className="text-muted-foreground shrink-0">{e.resource_type ?? ''}</span>
                      <span className="flex-1 truncate">{e.resource_label}</span>
                      {e.details && <span className="text-xs text-muted-foreground truncate max-w-[200px]">{e.details}</span>}
                    </div>
                  ))}
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
      </Tabs>
    </div>
  )
}
