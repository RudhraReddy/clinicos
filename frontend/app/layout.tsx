import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ClinicOS - Medical Management",
  description: "Efficient clinic management for modern healthcare providers.",
};

import { ThemeProvider } from "@/components/theme-provider";
import AppShell from "@/components/layout/AppShell";
import { AuthProvider } from "@/lib/auth_context";
import { SettingsProvider } from "@/lib/settings_context";
import { Toaster } from "sonner";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
        suppressHydrationWarning
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <SettingsProvider>
            <AuthProvider>
              <AppShell>{children}</AppShell>
              <Toaster richColors closeButton />
            </AuthProvider>
          </SettingsProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
