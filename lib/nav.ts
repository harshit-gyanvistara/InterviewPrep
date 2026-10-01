import { BarChart3, Compass, LayoutDashboard, Mic, NotebookPen, StickyNote } from "lucide-react";

/** Shared between the desktop pill nav and the mobile bottom tab bar (components/Shell.tsx, components/MobileNav.tsx). */
export const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/practice", label: "Practice", icon: Mic },
  { href: "/progress", label: "Progress", icon: BarChart3 },
  { href: "/prepare", label: "Prepare", icon: Compass },
  { href: "/cortex", label: "Cortex", icon: NotebookPen },
  { href: "/notes", label: "Notes", icon: StickyNote },
];
