import type { Metadata } from "next";
import Image from "next/image";
import { Geist, Geist_Mono } from "next/font/google";

import GlobalLogoutButton from "@/app/components/GlobalLogoutButton";
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
          <GlobalLogoutButton />
          <div className="flex min-h-0 flex-1 flex-col">{children}</div>
        </AuthRoleProvider>
        <footer className="border-t border-zinc-800 bg-black px-4 py-8">
          <div className="mx-auto flex max-w-[1800px] flex-col items-center justify-center gap-3">
            <Image
              src="/Logo_1024_white.webp"
              alt="Aaron Bowser Photography"
              width={480}
              height={160}
              className="h-32 w-auto opacity-90"
            />
            <p className="text-center text-xs text-zinc-500">
              powered by Aaron Bowser Photography
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
