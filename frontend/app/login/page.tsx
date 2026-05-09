"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Monitor, Stethoscope, ArrowLeft, Eye, EyeOff } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

type Role = "staff" | "doctor"
type Step = "role" | "login" | "forgot"

export default function LoginPage() {
  const router = useRouter()

  const [step, setStep] = useState<Step>("role")
  const [selectedRole, setSelectedRole] = useState<Role | null>(null)
  const [visible, setVisible] = useState(false)

  // Login form
  const [loginUsername, setLoginUsername] = useState("")
  const [loginPassword, setLoginPassword] = useState("")
  const [loginLoading, setLoginLoading] = useState(false)

  // Forgot password form
  const [resetUsername, setResetUsername] = useState("")
  const [resetTotpInput, setResetTotpInput] = useState("")
  const [resetGrantToken, setResetGrantToken] = useState("")   // 10-min grant from backend
  const [resetTotpVerified, setResetTotpVerified] = useState(false)
  const [resetTotpLoading, setResetTotpLoading] = useState(false)
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [newPasswordVisible, setNewPasswordVisible] = useState(false)
  const [confirmPasswordVisible, setConfirmPasswordVisible] = useState(false)
  const [resetLoading, setResetLoading] = useState(false)

  function selectRole(role: Role) {
    setSelectedRole(role)
    setStep("login")
  }

  function goToForgot() {
    // Pre-fill the reset username from whatever was typed in login
    setResetUsername(loginUsername)
    setResetTotpInput("")
    setResetGrantToken("")
    setResetTotpVerified(false)
    setNewPassword("")
    setConfirmPassword("")
    setStep("forgot")
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoginLoading(true)
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ username: loginUsername, password: loginPassword }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? data.message ?? "Login failed")
        return
      }
      const role: string = data.role ?? ""
      if (role === "admin") {
        window.location.href = "/admin"
      } else if (role === "doctor") {
        window.location.href = "/doctor"
      } else {
        window.location.href = "/"
      }
    } catch {
      toast.error("Network error — please try again")
    } finally {
      setLoginLoading(false)
    }
  }

  async function handleVerifyResetTotp(e: React.FormEvent) {
    e.preventDefault()
    setResetTotpLoading(true)
    try {
      const res = await fetch("/api/auth/verify-totp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ totp_code: resetTotpInput }),
      })
      const data = await res.json()
      if (res.ok && data.grant_token) {
        setResetGrantToken(data.grant_token)
        setResetTotpVerified(true)
      } else {
        toast.error("Invalid or expired code. Codes refresh every 30 seconds.")
      }
    } catch {
      toast.error("Network error — please try again")
    } finally {
      setResetTotpLoading(false)
    }
  }

  async function handleReset(e: React.FormEvent) {
    e.preventDefault()
    if (newPassword !== confirmPassword) {
      toast.error("Passwords do not match")
      return
    }
    setResetLoading(true)
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          username: resetUsername,
          grant_token: resetGrantToken,   // signed 10-min token
          new_password: newPassword,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? data.message ?? "Reset failed")
        // If grant expired, send user back to re-verify
        if (res.status === 400 && data.error?.includes('expired')) {
          setResetTotpVerified(false)
          setResetGrantToken("")
          setResetTotpInput("")
        }
        return
      }
      toast.success("Password updated successfully")
      setResetTotpInput("")
      setResetGrantToken("")
      setResetTotpVerified(false)
      setNewPassword("")
      setConfirmPassword("")
      setStep("login")
    } catch {
      toast.error("Network error — please try again")
    } finally {
      setResetLoading(false)
    }
  }

  const roleLabel = selectedRole === "doctor" ? "Doctor" : "Staff"
  const createAccountHref = `/create-account?role=${selectedRole ?? "staff"}`

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 px-4">
      {/* Role selection — step 1 */}
      <div
        className="w-full max-w-md"
        style={{
          transition: "opacity 250ms ease, transform 250ms ease",
          opacity: step === "role" ? 1 : 0,
          transform: step === "role" ? "translateY(0)" : "translateY(-12px)",
          pointerEvents: step === "role" ? "auto" : "none",
          position: step === "role" ? "static" : "absolute",
        }}
      >
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-gray-50">
            ClinicOS
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Choose your access type to continue
          </p>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <button
            onClick={() => selectRole("staff")}
            className="group rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 text-left shadow-sm hover:shadow-md hover:border-blue-400 dark:hover:border-blue-500 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <Monitor className="h-8 w-8 mb-3 text-blue-500 group-hover:scale-110 transition-transform" />
            <div className="font-semibold text-gray-900 dark:text-gray-50">Staff</div>
            <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              Front Desk Access
            </div>
          </button>

          <button
            onClick={() => selectRole("doctor")}
            className="group rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 text-left shadow-sm hover:shadow-md hover:border-emerald-400 dark:hover:border-emerald-500 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
          >
            <Stethoscope className="h-8 w-8 mb-3 text-emerald-500 group-hover:scale-110 transition-transform" />
            <div className="font-semibold text-gray-900 dark:text-gray-50">Doctor</div>
            <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              Clinical Dashboard
            </div>
          </button>
        </div>
      </div>

      {/* Login form — step 2 */}
      <div
        className="w-full max-w-sm"
        style={{
          transition: "opacity 250ms ease, transform 250ms ease",
          opacity: step === "login" ? 1 : 0,
          transform: step === "login" ? "translateY(0)" : "translateY(12px)",
          pointerEvents: step === "login" ? "auto" : "none",
          position: step === "login" ? "static" : "absolute",
        }}
      >
        <Card className="shadow-lg border-gray-200 dark:border-gray-800 dark:bg-gray-900">
          <CardContent className="pt-6 pb-6 px-6">
            <div className="flex items-center gap-2 mb-6">
              <button
                onClick={() => setStep("role")}
                className="rounded-md p-1 text-gray-500 hover:text-gray-900 dark:hover:text-gray-50 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                aria-label="Back to role selection"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
              <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-50">
                {roleLabel} Login
              </h2>
            </div>

            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="login-username">Username</Label>
                <Input
                  id="login-username"
                  type="text"
                  autoComplete="username"
                  placeholder="your_username"
                  value={loginUsername}
                  onChange={(e) => setLoginUsername(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="login-password">Password</Label>
                <div className="relative">
                  <Input
                    id="login-password"
                    type={visible ? "text" : "password"}
                    autoComplete="current-password"
                    placeholder="••••••••"
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    required
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setVisible((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors focus:outline-none"
                    aria-label={visible ? "Hide password" : "Show password"}
                  >
                    {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <Button type="submit" className="w-full" disabled={loginLoading}>
                {loginLoading ? "Signing in…" : "Login"}
              </Button>
            </form>

            <div className="mt-4 flex flex-col items-center gap-1.5 text-sm">
              <a
                href={createAccountHref}
                className="text-blue-600 dark:text-blue-400 hover:underline"
              >
                Don&apos;t have an account? Create one
              </a>
              <button
                type="button"
                onClick={goToForgot}
                className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:underline transition-colors"
              >
                Forgot password?
              </button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Forgot password — step 3 */}
      <div
        className="w-full max-w-sm"
        style={{
          transition: "opacity 250ms ease, transform 250ms ease",
          opacity: step === "forgot" ? 1 : 0,
          transform: step === "forgot" ? "translateY(0)" : "translateY(12px)",
          pointerEvents: step === "forgot" ? "auto" : "none",
          position: step === "forgot" ? "static" : "absolute",
        }}
      >
        <Card className="shadow-lg border-gray-200 dark:border-gray-800 dark:bg-gray-900">
          <CardContent className="pt-6 pb-6 px-6">
            <div className="flex items-center gap-2 mb-6">
              <button
                onClick={() => setStep("login")}
                className="rounded-md p-1 text-gray-500 hover:text-gray-900 dark:hover:text-gray-50 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                aria-label="Back to login"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
              <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-50">
                Reset Password
              </h2>
            </div>

            <form onSubmit={handleReset} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="reset-username">Username</Label>
                <Input
                  id="reset-username"
                  type="text"
                  autoComplete="username"
                  placeholder="your_username"
                  value={resetUsername}
                  onChange={(e) => setResetUsername(e.target.value)}
                  required
                />
              </div>

              {/* Sub-step A: TOTP verify */}
              {!resetTotpVerified ? (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="reset-totp">6-digit authenticator code</Label>
                    <Input
                      id="reset-totp"
                      inputMode="numeric"
                      maxLength={6}
                      placeholder="123456"
                      value={resetTotpInput}
                      onChange={(e) => setResetTotpInput(e.target.value.replace(/\D/g, ""))}
                      required
                      autoComplete="one-time-code"
                    />
                  </div>
                  <Button
                    type="button"
                    className="w-full"
                    disabled={resetTotpLoading || resetTotpInput.length !== 6}
                    onClick={handleVerifyResetTotp}
                  >
                    {resetTotpLoading ? "Verifying…" : "Verify Code"}
                  </Button>
                </div>
              ) : (
                /* Sub-step B: new password (TOTP already verified) */
                <>
                  <div className="text-xs text-emerald-600 dark:text-emerald-400 -mt-1">
                    ✓ Identity verified — set your new password below
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="new-password">New password</Label>
                    <div className="relative">
                      <Input
                        id="new-password"
                        type={newPasswordVisible ? "text" : "password"}
                        autoComplete="new-password"
                        placeholder="••••••••"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        required
                        className="pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setNewPasswordVisible((v) => !v)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors focus:outline-none"
                        aria-label={newPasswordVisible ? "Hide password" : "Show password"}
                      >
                        {newPasswordVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="confirm-password">Confirm password</Label>
                    <div className="relative">
                      <Input
                        id="confirm-password"
                        type={confirmPasswordVisible ? "text" : "password"}
                        autoComplete="new-password"
                        placeholder="••••••••"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        required
                        className="pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setConfirmPasswordVisible((v) => !v)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors focus:outline-none"
                        aria-label={confirmPasswordVisible ? "Hide password" : "Show password"}
                      >
                        {confirmPasswordVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  <Button type="submit" className="w-full" disabled={resetLoading}>
                    {resetLoading ? "Resetting…" : "Reset Password"}
                  </Button>
                </>
              )}
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
