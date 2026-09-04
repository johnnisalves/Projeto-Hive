/**
 * Pulls copy the client marked as mandatory out of a long brief.
 *
 * Agency-style briefs bury "HEADLINE: ..." hundreds of characters in, and a
 * planner reading 3000 characters of art direction reliably paraphrases it
 * ("A espera acabou." came back as "Petrolina, a espera acabou!"). Finding
 * these lines up front and repeating them at the top of the prompt is what
 * makes "escreva exatamente assim" actually hold.
 */

export type MandatoryCopy = { headline?: string; support?: string; cta?: string };

const COPY_PATTERNS: Array<{ key: keyof MandatoryCopy; re: RegExp }> = [
  { key: 'headline', re: /(?:^|\n)\s*(?:HEADLINE|TÍTULO|TITULO)\s*[:\-–]\s*(.+)/i },
  { key: 'support', re: /(?:^|\n)\s*(?:TEXTO DE APOIO|SUBHEADLINE|SUBTÍTULO|SUBTITULO|APOIO|LINHA DE APOIO)\s*[:\-–]\s*(.+)/i },
  { key: 'cta', re: /(?:^|\n)\s*(?:CTA|CHAMADA(?: PARA AÇÃO| PARA ACAO)?|CALL TO ACTION|BOTÃO|BOTAO)\s*[:\-–]\s*(.+)/i },
];

/** Strips surrounding quotes and typography so the value compares literally. */
function cleanCopy(raw: string): string {
  return raw.trim().replace(/^["“”'‘’]+|["“”'‘’]+$/g, '').trim();
}

export function extractMandatoryCopy(text: string): MandatoryCopy {
  const out: MandatoryCopy = {};
  for (const { key, re } of COPY_PATTERNS) {
    const m = text.match(re);
    if (!m || !m[1]) continue;
    const value = cleanCopy(m[1]);
    // "Sem CTA." and friends are an instruction to omit, not copy to render.
    if (value && value.length <= 160 && !/^(sem|nenhum|nenhuma|não|nao|none|n\/a)\b/i.test(value)) {
      out[key] = value;
    }
  }
  return out;
}

/** Block repeated at the end of the planning prompt, where it cannot be missed. */
export function mandatoryCopyBlock(text: string): string {
  const copy = extractMandatoryCopy(text);
  const lines: string[] = [];
  if (copy.headline) lines.push(`- "headline" MUST be exactly: ${copy.headline}`);
  if (copy.support) lines.push(`- "subheadline" MUST be exactly: ${copy.support}`);
  if (copy.cta) lines.push(`- "cta" MUST be exactly: ${copy.cta}`);
  if (!lines.length) return '';
  return `

MANDATORY COPY — THE CLIENT DICTATED THESE EXACT STRINGS. Copy them character by character into the JSON fields. Do not add a city name, an exclamation mark, an extra word or any flourish. Do not paraphrase and do not "improve" them:
${lines.join('\n')}`;
}
