import { getSetting } from '../helpers/getSetting';
import { env } from '../config/env';

/**
 * Art Director — 2-stage image prompt enrichment.
 *
 * Turns a short topic/brief into a dense, cinematic, campaign-grade image prompt
 * (in English, for the image model) plus a negative prompt. Optionally brand-aware.
 * Ported (behavior) from the Supabase "Dispara AI" generate-image art-director stage.
 */

export interface ArtBrandContext {
  name?: string | null;
  description?: string | null;
  voiceTone?: string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  accentColor?: string | null;
  backgroundColor?: string | null;
  products?: string[] | null;
  artDirection?: string | null; // optional per-company creative rules (ex: "no wood-fire oven")
}

export interface EnrichImageParams {
  topic: string;
  brand?: ArtBrandContext | null;
  aspectRatio?: string;
  style?: string;
  artStyle?: 'humanizado' | 'grafico';
  bakeText?: boolean; // allow legible text baked into the image (default false — we overlay text)
}

export interface EnrichImageResult {
  prompt: string;
  negativePrompt: string;
  enriched: boolean;
}

const NEGATIVE_BASE =
  'text, letters, words, numbers, watermark, logo, signature, low quality, blurry, out of focus, pixelated, jpeg artifacts, deformed, ugly, extra fingers, mutated hands, poorly drawn, amateur, generic stock photo, canva template, clipart, flat vector (unless requested), oversaturated, harsh flash, cluttered, busy layout, messy composition';

async function callArtDirectorLLM(fullPrompt: string): Promise<string | null> {
  const provider = ((await getSetting('NANO_BANANA_PROVIDER')) || 'google').toLowerCase();

  // Preferred: OpenRouter text model
  if (provider === 'openrouter') {
    const apiKey = await getSetting('OPENROUTER_API_KEY');
    if (apiKey) {
      const model = (await getSetting('OPENROUTER_TEXT_MODEL')) || 'google/gemini-2.5-flash';
      try {
        const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': env.FRONTEND_URL,
            'X-Title': 'OpenHive',
          },
          body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: fullPrompt }],
            temperature: 0.7,
            max_tokens: 700,
          }),
        });
        if (r.ok) {
          const d = (await r.json()) as any;
          const t = d.choices?.[0]?.message?.content;
          if (t) return String(t).trim();
        }
      } catch {
        /* fall through */
      }
    }
  }

  // Fallback: native Google Gemini text
  const gkey = await getSetting('NANO_BANANA_API_KEY');
  if (gkey) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${gkey}`;
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: fullPrompt }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 700 },
        }),
      });
      if (r.ok) {
        const d = (await r.json()) as any;
        const t = d.candidates?.[0]?.content?.parts?.[0]?.text;
        if (t) return String(t).trim();
      }
    } catch {
      /* fall through */
    }
  }

  return null;
}

export async function enrichImagePrompt(params: EnrichImageParams): Promise<EnrichImageResult> {
  const { topic, brand, aspectRatio, style, artStyle, bakeText } = params;
  const ar = aspectRatio || '1:1';

  const brandBlock = brand
    ? [
        `\nIDENTIDADE DA MARCA (alinhe mood e paleta, NÃO escreva o nome na imagem):`,
        brand.name ? `- Marca: ${brand.name}` : '',
        brand.description ? `- Sobre: ${brand.description}` : '',
        brand.voiceTone ? `- Tom: ${brand.voiceTone}` : '',
        `- Paleta: primária ${brand.primaryColor || '-'}, secundária ${brand.secondaryColor || '-'}, destaque ${brand.accentColor || '-'}, fundo ${brand.backgroundColor || '-'}`,
        brand.products && brand.products.length ? `- Produtos: ${brand.products.slice(0, 6).join(', ')}` : '',
        brand.artDirection ? `- REGRAS DE ARTE OBRIGATÓRIAS: ${brand.artDirection}` : '',
      ]
        .filter(Boolean)
        .join('\n')
    : '';

  const styleDirective =
    artStyle === 'grafico'
      ? 'ESTILO: design gráfico/publicitário moderno — cards, ícones, formas geométricas, glassmorphism, infográfico premium; NÃO fotorrealista.'
      : 'ESTILO: fotografia publicitária hiper-realista, cinematográfica e premium (foto real dominante).';

  const textRule = bakeText
    ? 'O texto principal PODE aparecer renderizado, grande e legível, ortografia impecável.'
    : "NÃO inclua nenhum texto, letra, número, logo ou marca-d'água na imagem — o texto será sobreposto depois. Deixe áreas de respiro / espaço negativo para o texto.";

  const system = `Você é um DIRETOR DE ARTE de publicidade de altíssimo nível. Transforme o TEMA em um PROMPT DE IMAGEM em INGLÊS, pronto para um gerador de imagem por IA, com qualidade de campanha de marca grande.

REGRAS OBRIGATÓRIAS do prompt que você vai escrever:
- 60 a 110 palavras, em INGLÊS, um único parágrafo denso e específico.
- ${styleDirective}
- Direção cinematográfica: luz quente e direcional, profundidade de campo (bokeh no fundo), lente (ex: 50mm/85mm), sombras suaves, contraste elegante, textura ultra detalhada, cores vibrantes mas naturais, direção de arte premium.
- Se envolver COMIDA: extremamente apetitosa e realista — brilho natural, vapor quando fizer sentido, ingredientes frescos, textura real, close-up gastronômico irresistível.
- ${textRule}
- Composição limpa, foco claro. Evite cara de "template de Canva", clipart e stock genérico.
- Respeite a proporção ${ar}.${brandBlock}

RESPONDA EXATAMENTE NESTE FORMATO (sem markdown, sem aspas, sem comentários):
PROMPT: <o prompt em inglês>
NEGATIVE: <negative prompt em inglês, itens separados por vírgula>`;

  const user = `TEMA/BRIEF: "${topic}"${style ? `\nEstilo pedido: ${style}` : ''}\nProporção: ${ar}`;

  const raw = await callArtDirectorLLM(`${system}\n\n${user}`);

  if (raw) {
    const pMatch = raw.match(/PROMPT:\s*([\s\S]+?)(?=NEGATIVE:|$)/i);
    const nMatch = raw.match(/NEGATIVE:\s*([\s\S]+)$/i);
    const prompt = pMatch?.[1]?.trim();
    const negative = nMatch?.[1]?.trim();
    if (prompt && prompt.length > 20) {
      const negativePrompt = [negative, NEGATIVE_BASE].filter(Boolean).join(', ');
      return { prompt, negativePrompt, enriched: true };
    }
  }

  // Graceful fallback: a solid enriched prompt without the LLM.
  const foodHint = /pizza|food|burger|comida|prato|drink|bebida|caf|doce|sobremesa/i.test(topic)
    ? ', mouth-watering realistic food, natural glossy highlights, fresh ingredients, real texture, gastronomic close-up'
    : '';
  const fallbackPrompt = `${style ? style + ' style, ' : ''}professional advertising photography, cinematic, ${topic}${foodHint}, warm directional lighting, shallow depth of field with soft bokeh, ultra-detailed texture, elegant contrast, vibrant natural colors, premium high-end campaign art direction${bakeText ? '' : ', no text, no letters, generous negative space for text overlay'}`;
  return { prompt: fallbackPrompt, negativePrompt: NEGATIVE_BASE, enriched: false };
}
