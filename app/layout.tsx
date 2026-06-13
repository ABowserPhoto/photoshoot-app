import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import RootAppChrome from "@/app/components/RootAppChrome";
import { AuthRoleProvider } from "@/app/contexts/AuthRoleContext";

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
  title: "Workflow",
  description: "Photoshoot workflow pipeline",
  icons: {
    icon: [{ url: "/favicon.webp", type: "image/webp" }],
    shortcut: "/favicon.webp",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-black text-white">
        <AuthRoleProvider>
          <RootAppChrome>{children}</RootAppChrome>
        </AuthRoleProvider>
      </body>
    </html>
  );
}
