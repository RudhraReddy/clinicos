"use client"

import { useState, useEffect } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Settings, Check, X, Loader2, Users } from "lucide-react"
import { toast } from "sonner"
import { useAuth } from "@/lib/auth_context"

interface StaffUser {
  user_id: string
  username: string
  role: string
  location_label?: string | null
}

export function StaffAssignmentDialog() {
  const { assignedStaff, refreshAssignedStaff } = useAuth()
  const [open, setOpen] = useState(false)
  const [allStaff, setAllStaff] = useState<StaffUser[]>([])
  const [loading, setLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)  // user_id being acted on

  const fetchAllStaff = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/auth/users?role=staff', { credentials: 'include' })
      if (res.ok) {
        const data = await res.json()
        setAllStaff(data)
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) fetchAllStaff()
  }, [open])

  const isAssigned = (user_id: string) =>
    assignedStaff.some(s => s.user_id === user_id)

  const handleToggle = async (staff: StaffUser) => {
    setActionLoading(staff.user_id)
    try {
      if (isAssigned(staff.user_id)) {
        // Remove assignment
        const res = await fetch(`/api/auth/users/assign-staff/${staff.user_id}`, {
          method: 'DELETE',
          credentials: 'include',
        })
        if (res.ok) {
          toast.success(`${staff.username} removed from your team`)
          await refreshAssignedStaff()
        } else {
          const data = await res.json().catch(() => ({}))
          toast.error(data.error || 'Failed to remove assignment')
        }
      } else {
        // Add assignment
        const res = await fetch('/api/auth/users/assign-staff', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ staff_id: staff.user_id }),
        })
        if (res.ok) {
          toast.success(`${staff.username} added to your team`)
          await refreshAssignedStaff()
        } else {
          const data = await res.json().catch(() => ({}))
          toast.error(data.error || 'Failed to assign staff')
        }
      }
    } finally {
      setActionLoading(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" title="Staff Assignments">
          <Settings className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Staff Assignments
          </DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          Select which staff members&apos; data you can view in your dashboard.
        </p>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : allStaff.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">No staff accounts found.</p>
        ) : (
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {allStaff.map(staff => {
              const assigned = isAssigned(staff.user_id)
              const busy = actionLoading === staff.user_id
              return (
                <div
                  key={staff.user_id}
                  className="flex items-center justify-between rounded-lg border p-3"
                >
                  <div>
                    <p className="font-medium text-sm">{staff.username}</p>
                    {staff.location_label && (
                      <p className="text-xs text-muted-foreground">{staff.location_label}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {assigned && <Badge variant="secondary" className="text-xs">Assigned</Badge>}
                    <Button
                      variant={assigned ? "outline" : "default"}
                      size="sm"
                      onClick={() => handleToggle(staff)}
                      disabled={busy}
                    >
                      {busy ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : assigned ? (
                        <><X className="h-3 w-3 mr-1" />Remove</>
                      ) : (
                        <><Check className="h-3 w-3 mr-1" />Assign</>
                      )}
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
