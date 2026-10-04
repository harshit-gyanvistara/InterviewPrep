import type { DomainProfile } from "./index";

/** Medical students, interns and residents (e.g. members of a medical college). */
export const medical: DomainProfile = {
  id: "medical",
  label: "Medicine / healthcare",
  match:
    /\bmbbs\b|\bneet\b|medical|medicine|doctor|physician|surgeon|surgery|\bresiden(t|cy)\b|house officer|clinical|clinician|\bhospital\b|nurse|nursing|paediatric|pediatric|cardiolog|radiolog|anaesthe|anesthe|obstetric|gynaecolog|gynecolog|psychiatr|dermatolog|ophthalm|orthopaedic|orthopedic/.source,
  interviewerContext: `FIELD: Medicine (medical students, interns, residents).
- Interviews in this field include oral vivas and clinical case discussions (history, examination findings, differentials, investigations, management, red flags), MMI-style ethics and communication stations (consent, capacity, confidentiality, breaking bad news, errors and candour), and PG/residency selection interviews (specialty motivation, research and audit, teamwork, pressure and duty hours).
- Present a clinical case as a short vignette with key vitals and findings, and reveal more only when asked, like a real examiner. Push with "what next?" and "why?".
- Expect structure where it is standard: ABCDE for emergencies, SPIKES for bad news, the four principles for ethics.
- Patient safety comes first: if an answer would harm a patient, probe it.
- Everything is a simulation. Never give medical advice about a real person.`,
  scoringContext: `- Medicine: treat patient safety as critical. An answer that would harm a patient (missed red flag, unsafe dose, skipped ABC) caps the relevant dimension at 4, whatever else was good.
- Medicine: credit structured clinical reasoning (differentials ranked by likelihood and danger, justified investigations) over listing facts.
- Speech-to-text often mangles drug names and medical terms. Judge the term the candidate clearly meant.`,
  roundHints:
    "Fitting round types for this field: clinical viva / case discussion, MMI ethics or communication station, PG/residency selection interview, hospital job interview. Never a programming round.",
  roadmapHints:
    "Prep for this field means clinical case practice, ethics and communication scenarios (MMI), specialty research, and evidence of audit, research or teamwork for selection interviews.",
  allowsCoding: false,
  version: 1,
};
