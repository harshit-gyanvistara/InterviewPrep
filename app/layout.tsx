import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import { Shell } from "@/components/Shell";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { NotesFab } from "@/components/NotesFab";
import { NotesPanel } from "@/components/NotesPanel";
import { DialogProvider } from "@/lib/dialogContext";
import { NotesProvider } from "@/lib/notesContext";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Offerly — Prepare. Practice. Land the job.",
  description: "Mock interviews that feel like the real thing, with AI feedback for graduates.",
  appleWebApp: {
    // Lets someone add this to their home screen and open it full-screen, without the browser chrome.
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Offerly",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover", // lets our safe-area padding reach under notches/home indicators
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#b4b8e6" },
    { media: "(prefers-color-scheme: dark)", color: "#1b1c2e" },
  ],
};

// Applies the saved theme before paint to avoid a flash.
const themeScript = `try{var t=localStorage.getItem("interviewprep:theme");if(t)document.documentElement.setAttribute("data-theme",t)}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <DialogProvider>
          <NotesProvider>
            <Shell>{children}</Shell>
            <NotesFab />
            <NotesPanel />
          </NotesProvider>
          <ConfirmDialog />
        </DialogProvider>
      </body>
    </html>
  );
}
