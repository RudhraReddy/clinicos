"use client"

import { useState, useEffect } from "react"
import { useParams, useRouter } from "next/navigation"
import { api, type Visit } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { ArrowLeft, User, Calendar, Clock } from "lucide-react"


export default function VisitDetailPage() {
    const params = useParams()
    const router = useRouter()
    const [visit, setVisit] = useState<Visit | null>(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        if (params.id) {
            loadVisit(params.id as string)
        }
    }, [params.id])

    const loadVisit = async (id: string) => {
        setLoading(true)
        try {
            const data = await api.getVisit(id)
            setVisit(data)
        } catch (e) {
            console.error(e)
        } finally {
            setLoading(false)
        }
    }

    if (loading) return <div className="p-8">Loading...</div>
    if (!visit) return <div className="p-8">Visit not found</div>

    return (
        <div className="space-y-6 max-w-5xl mx-auto py-6">
            <div className="flex items-center gap-4">
                <Button variant="ghost" onClick={() => router.back()}>
                    <ArrowLeft className="mr-2 h-4 w-4" /> Back
                </Button>
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Visit Details</h1>
                    <div className="flex items-center gap-4 text-muted-foreground mt-1">
                        <span className="flex items-center gap-1"><User className="h-4 w-4" /> {visit.patient_name}</span>
                        <span className="flex items-center gap-1"><Calendar className="h-4 w-4" /> {visit.visit_date}</span>
                        <span className="flex items-center gap-1"><Clock className="h-4 w-4" /> {visit.visit_time || '--:--'}</span>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Info Column */}
                <div className="md:col-span-1 space-y-6">
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-lg">Stats</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div>
                                <label className="text-sm font-medium text-muted-foreground">Status</label>
                                <div className="capitalize font-medium">{visit.status}</div>
                            </div>
                            <div>
                                <label className="text-sm font-medium text-muted-foreground">Reason</label>
                                <div className="text-sm">{visit.reason || "None"}</div>
                            </div>

                        </CardContent>
                    </Card>
                </div>


            </div>
        </div>
    )
}
