import type { NoteLink } from "./types";

/** Where clicking a note's "linked to" chip should take you. */
export function noteLinkHref(link: NoteLink): string {
  switch (link.type) {
    case "session":
      return `/report/${link.id}`; // falls back to the report-not-found screen if it isn't scored yet
    case "pack":
      return `/practice?pack=${link.id}`;
    case "roadmap-item":
      return `/prepare?tab=roadmap`;
    case "story":
      return `/prepare?tab=stories`;
    default:
      return "/notes";
  }
}

export const NOTE_TYPE_LABEL: Record<NoteLink["type"], string> = {
  session: "Interview",
  pack: "Round",
  "roadmap-item": "Roadmap",
  story: "Story",
  other: "Note",
};
