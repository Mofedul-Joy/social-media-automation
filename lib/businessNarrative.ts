/**
 * Two of the three context inputs on the search page — "Describe yourself" and
 * "Why you are using this tool" — share one `BusinessContext.description`
 * field. No new schema field was added for them (decided in
 * .scratch/hon-sma-v2/issues/02-business-context-settings-ui.md), so the two
 * answers are stored as one piece of labelled prose and split apart on read.
 *
 * The labels are part of the stored value on purpose. `description` is fed
 * verbatim to the AI as instructions, so it has to read as sense on its own;
 * a hidden delimiter would be invisible to the model and would also break the
 * moment someone edited the row by hand in Supabase. These read fine as prose
 * AND are precise enough to split on.
 *
 * Pure string work, no imports: this is used from the client component, so it
 * must never reach for the server-side Supabase client the way lib/config.ts
 * does.
 */

const ABOUT_LABEL = "About me:";
const PURPOSE_LABEL = "Why I'm using this tool:";

/** Anchored to line start, so the same words inside a sentence do not split it. */
const PURPOSE_AT_LINE_START = /^Why I'm using this tool:[ \t]*/m;
const LEADING_ABOUT = /^About me:[ \t]*/;

/**
 * A line the user typed that begins with one of the two labels would be
 * indistinguishable from a real section heading, and the split would then hand
 * the second half of "Describe yourself" to "Why you are using this tool" on
 * the next page load. Indenting such a line by one space is enough to stop it
 * matching — the anchors are `^`, and one leading space on a line inside a
 * paragraph changes nothing a reader or the AI cares about. Re-escaping is a
 * no-op, because an already-indented line no longer matches.
 */
const COLLIDING_LINE = /^(About me:|Why I'm using this tool:)/gm;
const escapeMarkers = (s: string) => s.replace(COLLIDING_LINE, " $1");

export interface DescriptionParts {
  about: string;
  purpose: string;
}

/**
 * A description with no labels at all — the bundled example context, or a row
 * written before this UI existed — is treated as all "about". That is the
 * honest reading: it is a description of the business, and guessing which half
 * of it was really a purpose would be inventing content the user never wrote.
 */
export function splitDescription(description: string | undefined | null): DescriptionParts {
  const text = (description ?? "").trim();
  if (!text) return { about: "", purpose: "" };

  const match = text.match(PURPOSE_AT_LINE_START);
  if (!match || match.index === undefined) {
    return { about: text.replace(LEADING_ABOUT, "").trim(), purpose: "" };
  }
  return {
    about: text.slice(0, match.index).replace(LEADING_ABOUT, "").trim(),
    purpose: text.slice(match.index + match[0].length).trim(),
  };
}

/**
 * The inverse. An empty half is dropped rather than written as an empty
 * heading, so a half-filled form does not hand the AI a label with nothing
 * under it — and so both halves empty gives an empty description, which is
 * what makes the existing fall-back-to-example-context behaviour still fire.
 */
export function joinDescription(about: string, purpose: string): string {
  const parts: string[] = [];
  if (about.trim()) parts.push(`${ABOUT_LABEL} ${escapeMarkers(about.trim())}`);
  if (purpose.trim()) parts.push(`${PURPOSE_LABEL} ${escapeMarkers(purpose.trim())}`);
  return parts.join("\n\n");
}
