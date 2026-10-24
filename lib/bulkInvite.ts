import type { Attributes } from "./memberAttributes";
import { MAX_DEPTH } from "./orgSections";
import type { StudentField } from "./orgSettings";

// Client-safe, pure. Turns a pasted or uploaded student list into invite rows (plans/b2b-college.md B.3).
// Columns: email, then optionally a section path ("CSE / 2027 / A") and any of the org's details
// (by label or key). A header row is optional; without one, column 2 is the section.

export const MAX_BULK_ROWS = 500;

export interface BulkRow {
  email: string;
  /** Names from the top of the tree down, or null for no section. */
  section: string[] | null;
  attributes: Attributes;
}

export interface BulkParse {
  rows: BulkRow[];
  /** Problems by line number (1-based, counting the header), for the admin to fix. */
  errors: { line: number; message: string }[];
}

const EMAIL = /^[^\s@,;<>"']+@[^\s@,;<>"']+\.[^\s@,;<>"']+$/;

/** One CSV/TSV line into cells; double quotes wrap cells containing the separator. */
export function splitLine(line: string): string[] {
  const sep = line.includes("\t") ? "\t" : ",";
  const out: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) {
      out.push(cell.trim());
      cell = "";
    } else cell += ch;
  }
  out.push(cell.trim());
  return out;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");

export const sectionPath = (cell: string): string[] => cell.split(/\s*[/>]\s*/).map((p) => p.trim()).filter(Boolean);

export function parseInviteRows(text: string, fields: StudentField[]): BulkParse {
  const lines = text.split(/\r?\n/).map((l, i) => ({ line: i + 1, cells: splitLine(l) })).filter((l) => l.cells.some(Boolean));
  const errors: BulkParse["errors"] = [];
  if (!lines.length) return { rows: [], errors };

  // A first line with no email in it is a header.
  const hasHeader = !lines[0].cells.some((c) => EMAIL.test(c));
  const header = hasHeader ? lines[0].cells.map(norm) : [];
  const col = (...names: string[]) => header.findIndex((h) => names.includes(h));
  const emailCol = hasHeader ? Math.max(col("email", "emailaddress", "mail"), 0) : 0;
  const sectionCol = hasHeader ? col("section", "cohort", "group", "class", "batch") : 1;
  const fieldCols = hasHeader ? fields.map((f) => ({ key: f.key, at: header.findIndex((h) => h === norm(f.key) || h === norm(f.label)) })).filter((c) => c.at >= 0) : [];

  const rows: BulkRow[] = [];
  const seen = new Set<string>();
  for (const { line, cells } of hasHeader ? lines.slice(1) : lines) {
    const email = (cells[emailCol] ?? "").toLowerCase();
    if (!EMAIL.test(email)) {
      errors.push({ line, message: `"${cells[emailCol] ?? ""}" isn't an email address.` });
      continue;
    }
    if (seen.has(email)) {
      errors.push({ line, message: `${email} appears more than once.` });
      continue;
    }
    const path = sectionCol >= 0 && cells[sectionCol] ? sectionPath(cells[sectionCol]) : [];
    if (path.length > MAX_DEPTH) {
      errors.push({ line, message: `The section "${cells[sectionCol]}" is more than ${MAX_DEPTH} levels deep.` });
      continue;
    }
    const attributes: Attributes = {};
    for (const { key, at } of fieldCols) if (cells[at]) attributes[key] = cells[at].slice(0, 80);
    seen.add(email);
    rows.push({ email, section: path.length ? path : null, attributes });
  }
  if (rows.length > MAX_BULK_ROWS) {
    errors.push({ line: 0, message: `A file can have at most ${MAX_BULK_ROWS} people; this has ${rows.length}. Split it.` });
    return { rows: [], errors };
  }
  return { rows, errors };
}
