// Turning untrusted third-party text (emails, Canvas pages, calendar titles) into short plain
// text that is safe to place inside the prompt's data tags.

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };

/** HTML to readable plain text: drops scripts/styles/tags, keeps line breaks, decodes common entities. */
export function htmlToText(html) {
  return String(html ?? "")
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, code) => {
      if (code[0] === "#") {
        const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : Number(code.slice(1));
        return Number.isFinite(n) && n > 31 ? String.fromCodePoint(n) : " ";
      }
      return ENTITIES[code.toLowerCase()] ?? m;
    });
}

/**
 * Makes untrusted text safe to embed between data tags: no angle brackets (so it can't
 * close or open a tag), no control characters, collapsed whitespace, and a length cap.
 */
export function sanitizeUntrusted(text, maxChars) {
  let out = String(text ?? "")
    .replace(/[<>]/g, " ")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (maxChars && out.length > maxChars) out = `${out.slice(0, maxChars).trimEnd()}…`;
  return out;
}

/** Strips quoted replies ("On ... wrote:") and signatures so the 2,000-char cap holds the new message. */
export function trimEmailBody(text) {
  const lines = String(text ?? "").split("\n");
  const cut = lines.findIndex((l) => /^On .+wrote:\s*$/.test(l.trim()) || /^-- ?$/.test(l) || /^>/.test(l.trim()));
  return (cut > 0 ? lines.slice(0, cut) : lines).join("\n");
}
