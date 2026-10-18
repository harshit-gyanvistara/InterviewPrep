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

const description = "Practise interviews out loud with an AI interviewer that follows up, then get a scored report that shows exactly what to fix. For any profession.";

export const metadata: Metadata = {
  // Absolute base for the share image and links in previews (app/opengraph-image.tsx).
  metadataBase: new URL(process.env.SITE_URL ?? "https://build-score.com"),
  title: "Offerly: mock interviews with an AI interviewer",
  description,
  openGraph: { title: "Offerly: walk into your interview already practised", description, siteName: "Offerly", type: "website" },
  twitter: { card: "summary_large_image", title: "Offerly: walk into your interview already practised", description },
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
    { media: "(prefers-color-scheme: light)", color: "#fafaf9" },
    { media: "(prefers-color-scheme: dark)", color: "#0e0f12" },
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
