"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Settings } from "lucide-react"
import { useSettings } from "@/lib/settings_context"
import { toast } from "sonner"

export function GlobalSettingsDialog() {
    const { 
        clinicName, 
        clinicAddress, 
        clinicPhone, 
        referenceDoctor, 
        appFontSize,
        setSettings,
        setPreviewFontSize
    } = useSettings()

    const [open, setOpen] = useState(false)
    const [settingsNameDraft, setSettingsNameDraft] = useState("")
    const [settingsAddressDraft, setSettingsAddressDraft] = useState("")
    const [settingsPhoneDraft, setSettingsPhoneDraft] = useState("")
    const [settingsReferenceDoctorDraft, setSettingsReferenceDoctorDraft] = useState("")
    const [fontSizeDraft, setFontSizeDraft] = useState<number[]>([16])

    // Update drafts when dialog opens
    useEffect(() => {
        if (open) {
            setSettingsNameDraft(clinicName)
            setSettingsAddressDraft(clinicAddress)
            setSettingsPhoneDraft(clinicPhone)
            setSettingsReferenceDoctorDraft(referenceDoctor)
            setFontSizeDraft([appFontSize])
        } else {
            // Revert preview if dialog is closed without saving
            setPreviewFontSize(null)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open])

    // Live preview for font size
    useEffect(() => {
        if (open) {
            setPreviewFontSize(fontSizeDraft[0])
        }
    }, [fontSizeDraft, open, setPreviewFontSize])

    const handleSave = () => {
        setSettings({
            clinicName: settingsNameDraft,
            clinicAddress: settingsAddressDraft,
            clinicPhone: settingsPhoneDraft,
            referenceDoctor: settingsReferenceDoctorDraft,
            appFontSize: fontSizeDraft[0]
        })
        setOpen(false)
        toast.success("Settings saved successfully")
    }

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="ghost" size="icon" title="Settings">
                    <Settings className="h-5 w-5" />
                </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Global Settings</DialogTitle>
                    <DialogDescription>
                        Configure your clinic details and application preferences.
                    </DialogDescription>
                </DialogHeader>
                
                <div className="space-y-6 pt-4">
                    {/* Clinic Details */}
                    <div className="space-y-4">
                        <h4 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground border-b pb-2">
                            Clinic Details
                        </h4>
                        <div className="space-y-2">
                            <Label htmlFor="global-clinic-name">Clinic Name</Label>
                            <Input
                                id="global-clinic-name"
                                value={settingsNameDraft}
                                onChange={(e) => setSettingsNameDraft(e.target.value)}
                                placeholder="MediCare Clinic"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="global-clinic-address">Clinic Address</Label>
                            <Textarea
                                id="global-clinic-address"
                                value={settingsAddressDraft}
                                onChange={(e) => setSettingsAddressDraft(e.target.value)}
                                placeholder="123 Health St, Medical District, City"
                                rows={2}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="global-clinic-phone">Clinic Phone</Label>
                            <Input
                                id="global-clinic-phone"
                                value={settingsPhoneDraft}
                                onChange={(e) => setSettingsPhoneDraft(e.target.value)}
                                placeholder="+91 98765 43210"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="global-clinic-refdoc">Reference Doctor</Label>
                            <Input
                                id="global-clinic-refdoc"
                                value={settingsReferenceDoctorDraft}
                                onChange={(e) => setSettingsReferenceDoctorDraft(e.target.value)}
                                placeholder="Dr. John Doe"
                            />
                        </div>
                    </div>

                    {/* Appearance */}
                    <div className="space-y-4">
                        <h4 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground border-b pb-2">
                            Appearance
                        </h4>
                        <div className="space-y-4 pt-2">
                            <div className="flex justify-between items-center">
                                <Label>App Font Size</Label>
                                <span className="text-sm text-muted-foreground">{fontSizeDraft[0]}px</span>
                            </div>
                            <div className="grid grid-cols-4 gap-2 my-4">
                                {[
                                    { label: "Small", value: 12 },
                                    { label: "Default", value: 16 },
                                    { label: "Large", value: 20 },
                                    { label: "Huge", value: 24 }
                                ].map(({ label, value }) => (
                                    <Button
                                        key={value}
                                        type="button"
                                        variant={fontSizeDraft[0] === value ? "default" : "outline"}
                                        onClick={() => setFontSizeDraft([value])}
                                        className="flex flex-col items-center justify-center h-[3.5rem] px-2"
                                    >
                                        <span className="font-semibold">{value}px</span>
                                        <span className="text-[10px] font-normal uppercase tracking-wider opacity-70">{label}</span>
                                    </Button>
                                ))}
                            </div>
                        </div>
                    </div>

                    <Button className="w-full" onClick={handleSave}>
                        Save Preferences
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    )
}
