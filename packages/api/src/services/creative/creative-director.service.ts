/**
 * Creative Director service — the LLM-backed orchestration around the pure
 * creative-engine functions. Produces the structured plan, the three concepts,
 * and the QA verdict. All I/O (settings, fetch) lives here.
 */

import { env } from '../../config/env';
import { getSetting } from '../../helpers/getSetting';
import {
  buildConceptSetSystemPrompt,
  buildCreativePlanSystemPrompt,
  buildCreativePlanUserPrompt,
  buildQASystemPrompt,
  conceptModeTriplet,
  detectNiche,
  normalizePhotoPlacement,
  resolveCreativeMode,
  type CreativeInput,
  type CreativePlan,
  type QAReport,
} from './creative-engine';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

function log(event: string, data: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ event, ts: new Date().toISOString(), ...data }));
}

/** Pulls the first JSON object/array out of a model response, fences and all. */
export function extractJson<T>(raw: string): T | null {
  if (!raw) return null;
  const cleaned = raw.replace(/```json\s*/gi, '').replace(/```/g, '').trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const start = cleaned.search(/[[{]/);
    const end = Math.max(cleaned.lastIndexOf(']'), cleaned.lastIndexOf('}'));
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(cleaned.slice(start, end + 1)) as T;
    } catch {
      return null;
    }
  }
}

/**
 * Text LLM call. Prefers OpenRouter (same key the art director already used),
 * falls back to native Gemini. Optionally sends an image for QA (vision).
 */
async function callLLM(
  system: string,
  user: string,
  opts: { imageUrl?: string; maxTokens?: number; temperature?: number } = {},
): Promise<string | null> {
  const maxTokens = opts.maxTokens ?? 1200;
  const temperature = opts.temperature ?? 0.8;

  const openRouterKey = await getSetting('OPENROUTER_API_KEY');
  if (openRouterKey) {
    const model = (await getSetting('OPENROUTER_TEXT_MODEL')) || 'google/gemini-2.5-flash';
    const userContent: unknown = opts.imageUrl
      ? [{ type: 'text', text: user }, { type: 'image_url', image_url: { url: opts.imageUrl } }]
      : user;
    try {
      const r = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${openRouterKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': env.FRONTEND_URL,
          'X-Title': 'DisparaAI Creative Director',
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: userContent },
          ],
          max_tokens: maxTokens,
          temperature,
        }),
      });
      if (r.ok) {
        const d = (await r.json()) as any;
        const t = d.choices?.[0]?.message?.content;
        if (t) return String(t).trim();
      } else {
        log('creative_llm_http_error', { status: r.status });
      }
    } catch (e) {
      log('creative_llm_error', { error: String(e).slice(0, 200) });
    }
  }

  // Native Gemini fallback (text only; QA image is skipped if this path is used).
  const gkey = await getSetting('NANO_BANANA_API_KEY');
  if (gkey) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${gkey}`;
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `${system}\n\n${user}` }] }],
          generationConfig: { temperature, maxOutputTokens: maxTokens },
        }),
      });
      if (r.ok) {
        const d = (await r.json()) as any;
        const t = d.candidates?.[0]?.content?.parts?.[0]?.text;
        if (t) return String(t).trim();
      }
    } catch (e) {
      log('creative_llm_error', { error: String(e).slice(0, 200) });
    }
  }

  return null;
}

/** Stage 1: the structured campaign brief. Returns null on any failure. */
export async function buildCreativePlan(input: CreativeInput): Promise<CreativePlan | null> {
  const started = Date.now();
  const raw = await callLLM(buildCreativePlanSystemPrompt(input), buildCreativePlanUserPrompt(input), {
    maxTokens: 1400,
    temperature: 0.85,
  });
  if (!raw) {
    log('creative_plan_failed', {});
    return null;
  }
  const plan = extractJson<CreativePlan>(raw);
  if (!plan) {
    log('creative_plan_unparseable', {});
    return null;
  }
  const niche = detectNiche(input.topic, input.brand);
  plan.niche = niche;
  plan.mode = resolveCreativeMode(input.creativeMode, niche);
  if (input.hasUserPhoto) plan.photoPlacement = normalizePhotoPlacement(plan.photoPlacement);
  log('creative_plan_generated', { ms: Date.now() - started, headline: plan.headline, niche, mode: plan.mode });
  return plan;
}

export type Concept = {
  id: 'A' | 'B' | 'C';
  mode: string;
  title: string;
  concept: string;
  visualHook: string;
  headline: string;
  palette: string;
  whyItWorks: string;
};

function fallbackConcepts(input: CreativeInput, niche: string): Concept[] {
  const [a, b, c] = conceptModeTriplet(niche);
  const base = input.headline || input.topic.slice(0, 60);
  return [
    { id: 'A', mode: a, title: 'Rota principal', concept: `Direção ${a} em torno do ponto mais forte do briefing.`, visualHook: 'O assunto principal como herói da composição.', headline: base, palette: `${input.brand?.primaryColor || 'cor da marca'} com neutros claros`, whyItWorks: 'É a linguagem que melhor costuma funcionar para este nicho.' },
    { id: 'B', mode: b, title: 'Rota alternativa', concept: `Direção ${b}, mudando o registro visual e o ritmo.`, visualHook: 'Um enquadramento inesperado do mesmo assunto.', headline: base, palette: 'Paleta clara e contrastada', whyItWorks: 'Diferencia do que o nicho costuma publicar.' },
    { id: 'C', mode: c, title: 'Rota ousada', concept: `Direção ${c}, com uma ideia visual mais autoral.`, visualHook: 'Uma metáfora visual simples e memorável.', headline: base, palette: 'Cor de destaque forte sobre base neutra', whyItWorks: 'Maior chance de parar o scroll.' },
  ];
}

/** Creative Director mode: three distinct routes for one brief. */
export async function buildConcepts(input: CreativeInput): Promise<{ concepts: Concept[]; niche: string; fallback: boolean }> {
  const niche = detectNiche(input.topic, input.brand);
  const raw = await callLLM(buildConceptSetSystemPrompt(input), `BRIEFING: ${input.topic.slice(0, 1500)}\nRetorne apenas o array JSON.`, {
    maxTokens: 1600,
    temperature: 0.95,
  });
  const parsed = raw ? extractJson<Concept[]>(raw) : null;
  if (!Array.isArray(parsed) || parsed.length === 0) {
    log('concepts_fallback', {});
    return { concepts: fallbackConcepts(input, niche), niche, fallback: true };
  }
  const concepts = parsed.slice(0, 3).map((concept, index) => ({
    ...concept,
    id: (['A', 'B', 'C'][index] || 'A') as Concept['id'],
  }));
  log('creative_concepts_generated', { count: concepts.length, niche });
  return { concepts, niche, fallback: false };
}

/** Stage 4: vision QA. Returns null when no vision-capable path is available. */
export async function runQA(input: CreativeInput, plan: CreativePlan | null, imageUrl: string): Promise<QAReport | null> {
  const started = Date.now();
  const raw = await callLLM(
    buildQASystemPrompt(input, plan),
    'Review this generated image against the checklist. Return the JSON only.',
    { imageUrl, maxTokens: 900, temperature: 0.2 },
  );
  if (!raw) return null;
  const report = extractJson<QAReport>(raw);
  if (report) log('qa_completed', { ms: Date.now() - started, passed: report.passed, score: report.score });
  return report;
}
