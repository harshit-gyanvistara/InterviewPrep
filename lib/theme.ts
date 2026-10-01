"use client";

const KEY = "interviewprep:theme";
export type Theme = "light" | "dark";

export const getTheme = (): Theme => (document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light");

export function setTheme(t: Theme) {
  document.documentElement.setAttribute("data-theme", t);
  try {
    localStorage.setItem(KEY, t);
  } catch {}
  window.dispatchEvent(new Event("interviewprep:theme"));
}
