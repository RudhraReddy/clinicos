"use client"

import { Suspense, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { ArrowLeft, Check, Eye, EyeOff } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

type Role = "staff" | "doctor"
type Step = "totp" | "details"

const PASSWORD_CHECKS = [
  { label: "Min 8 characters", test: (pw: string) => /.{8,}/.test(pw) },
  { label: "At least 1 uppercase letter", test: (pw: string) => /[A-Z]/.test(pw) },
  { label: "At least 1 number", test: (pw: string) => /[0-9]/.test(pw) },
  { label: "At least 1 special symbol", test: (pw: string) => /[^a-zA-Z0-9]/.test(pw) },
]

function CreateAccountContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const roleParam = searchParams.get("role")

  const [step, setStep] = useState<Step>("totp")
  const [totpCode, setTotpCode] = useState("")
  const [totpLoading, setTotpLoading] = useState(false)
  const [shaking, setShaking] = useState(false)

  const [role, setRole] = useState<Role>(roleParam === "doctor" ? "doctor" : "staff")
  const [username, setUsername] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [locationLabel, setLocationLabel] = useState("")
  const [passwordVisible, setPasswordVisible] = useState(false)
  const [confirmVisible, setConfirmVisible] = useState(false)
  const [registerLoading, setRegisterLoading] = useState(false)

  const passwordChecks = PASSWORD_CHECKS.map((c) => ({ ...c, passing: c.test(password) }))
  const allChecksPassing = passwordChecks.every((c) => c.passing)
  const passwordsMatch = password === confirmPassword && confirmPassword.length > 0
  const canSubmit = allChecksPassing && passwordsMatch && username.trim().length > 0 && email.trim().length > 0

  function triggerShake() {
    setShaking(true)
    setTimeout(() => setShaking(false), 600)
  }

  async function handleVerifyTotp(e: React.FormEvent) {
    e.preventDefault()
    setTotpLoading(true)
    try {
      const res = await fetch("/api/auth/verify-totp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ totp_code: totpCode }),
      })
      if (res.ok) {
        setStep("details")
      } else {
        triggerShake()
        toast.error("Invalid or expired code. Codes refresh every 30 seconds.")
      }
    } catch {
      triggerShake()
      toast.error("Network error — please try again")
    } finally {
      setTotpLoading(false)
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setRegisterLoading(true)
    try {
      const body: Record<string, string> = {
        totp_code: totpCode,
        email,
        username,
        password,
        role,
      }
      if (role === "staff" && locationLabel.trim()) {
        body.location_label = locationLabel.trim()
      }
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (res.status === 201) {
        toast.success("Account created! Please log in.")
        router.push("/login")
      } else {
        toast.error(data.error ?? data.message ?? "Registration failed")
      }
    } catch {
      toast.error("Network error — please try again")
    } finally {
      setRegisterLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 px-4">
      <style>{`
        @keyframes ca-shake {
          0%   { transform: translateX(0); }
          15%  { transform: translateX(-6px); }
          30%  { transform: translateX(6px); }
          45%  { transform: translateX(-5px); }
          60%  { transform: translateX(5px); }
          75%  { transform: translateX(-3px); }
          90%  { transform: translateX(3px); }
          100% { transform: translateX(0); }
        }
        .ca-shake { animation: ca-shake 0.55s ease; }
      `}</style>

      {/* Step 1 — TOTP Gate */}
      <div
        className="w-full max-w-sm"
        style={{
          transition: "opacity 250ms ease, transform 250ms ease",
          opacity: step === "totp" ? 1 : 0,
          transform: step === "totp" ? "translateY(0)" : "translateY(-12px)",
          pointerEvents: step === "totp" ? "auto" : "none",
          position: step === "totp" ? "static" : "absolute",
        }}
      >
        <Card className="shadow-lg border-gray-200 dark:border-gray-800 dark:bg-gray-900">
          <CardContent className="pt-6 pb-6 px-6">
            <div className="mb-6">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-50">
                Verify Identity
              </h2>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Open Google Authenticator &rarr; ClinicOS entry and enter the 6-digit code
              </p>
            </div>

            <form onSubmit={handleVerifyTotp} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="totp-input">6-digit code</Label>
                <Input
                  id="totp-input"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="123456"
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ""))}
                  required
                  className={shaking ? "ca-shake" : ""}
                  autoComplete="one-time-code"
                />
              </div>

              <Button
                type="submit"
                className="w-full"
                disabled={totpLoading || totpCode.length !== 6}
              >
                {totpLoading ? "Verifying…" : "Continue"}
              </Button>
            </form>

            <div className="mt-4 text-center text-sm">
              <button
                type="button"
                onClick={() => router.push("/login")}
                className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:underline transition-colors inline-flex items-center gap-1"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Back to Login
              </button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Step 2 — Account Details */}
      <div
        className="w-full max-w-sm"
        style={{
          transition: "opacity 250ms ease, transform 250ms ease",
          opacity: step === "details" ? 1 : 0,
          transform: step === "details" ? "translateY(0)" : "translateY(12px)",
          pointerEvents: step === "details" ? "auto" : "none",
          position: step === "details" ? "static" : "absolute",
        }}
      >
        <Card className="shadow-lg border-gray-200 dark:border-gray-800 dark:bg-gray-900">
          <CardContent className="pt-6 pb-6 px-6">
            <div className="flex items-center gap-2 mb-6">
              <button
                onClick={() => setStep("totp")}
                className="rounded-md p-1 text-gray-500 hover:text-gray-900 dark:hover:text-gray-50 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                aria-label="Back to verification"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
              <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-50">
                Create Account
              </h2>
            </div>

            <form onSubmit={handleRegister} className="space-y-4">
              {/* Role toggle */}
              <div className="space-y-1.5">
                <Label>Role</Label>
                <div className="flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setRole("staff")}
                    className={[
                      "flex-1 py-2 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500",
                      role === "staff"
                        ? "bg-blue-600 text-white"
                        : "bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800",
                    ].join(" ")}
                  >
                    Staff
                  </button>
                  <button
                    type="button"
                    onClick={() => setRole("doctor")}
                    className={[
                      "flex-1 py-2 text-sm font-medium border-l border-gray-200 dark:border-gray-700 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500",
                      role === "doctor"
                        ? "bg-blue-600 text-white border-l-blue-600"
                        : "bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800",
                    ].join(" ")}
                  >
                    Doctor
                  </button>
                </div>
              </div>

              {/* Username */}
              <div className="space-y-1.5">
                <Label htmlFor="ca-username">Username / Display Name</Label>
                <Input
                  id="ca-username"
                  type="text"
                  autoComplete="username"
                  placeholder="Dr. Sharma or Front Desk"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                />
              </div>

              {/* Email */}
              <div className="space-y-1.5">
                <Label htmlFor="ca-email">Email</Label>
                <Input
                  id="ca-email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>

              {/* Password */}
              <div className="space-y-1.5">
                <Label htmlFor="ca-password">Password</Label>
                <div className="relative">
                  <Input
                    id="ca-password"
                    type={passwordVisible ? "text" : "password"}
                    autoComplete="new-password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setPasswordVisible((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors focus:outline-none"
                    aria-label={passwordVisible ? "Hide password" : "Show password"}
                  >
                    {passwordVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>

                {/* Strength indicators */}
                {password.length > 0 && (
                  <ul className="mt-1.5 space-y-1">
                    {passwordChecks.map((c) => (
                      <li
                        key={c.label}
                        className={[
                          "flex items-center gap-1.5 text-xs transition-colors",
                          c.passing
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-gray-400 dark:text-gray-500",
                        ].join(" ")}
                      >
                        <Check className="h-3 w-3 shrink-0" />
                        {c.label}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Confirm Password */}
              <div className="space-y-1.5">
                <Label htmlFor="ca-confirm">Confirm Password</Label>
                <div className="relative">
                  <Input
                    id="ca-confirm"
                    type={confirmVisible ? "text" : "password"}
                    autoComplete="new-password"
                    placeholder="••••••••"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    className={[
                      "pr-10",
                      confirmPassword.length > 0 && !passwordsMatch
                        ? "border-red-400 focus-visible:ring-red-400"
                        : "",
                    ].join(" ")}
                  />
                  <button
                    type="button"
                    onClick={() => setConfirmVisible((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors focus:outline-none"
                    aria-label={confirmVisible ? "Hide password" : "Show password"}
                  >
                    {confirmVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {confirmPassword.length > 0 && !passwordsMatch && (
                  <p className="text-xs text-red-500">Passwords do not match</p>
                )}
              </div>

              {/* Location Label — staff only */}
              {role === "staff" && (
                <div className="space-y-1.5">
                  <Label htmlFor="ca-location">Location Label</Label>
                  <Input
                    id="ca-location"
                    type="text"
                    placeholder="e.g. Branch A, Downtown Clinic"
                    value={locationLabel}
                    onChange={(e) => setLocationLabel(e.target.value)}
                  />
                </div>
              )}

              <Button
                type="submit"
                className="w-full"
                disabled={!canSubmit || registerLoading}
              >
                {registerLoading ? "Creating account…" : "Create Account"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export default function CreateAccountPage() {
  return (
    <Suspense>
      <CreateAccountContent />
    </Suspense>
  )
}
