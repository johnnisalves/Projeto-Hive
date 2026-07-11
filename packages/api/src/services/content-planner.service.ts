import { prisma } from '../config/database';
import { callText } from './caption.service';

/**
 * Planejador de conteúdo com IA (DisparaAI).
 * Gera um plano de conteúdo para um período (ex: mês) a partir da marca + objetivos,
 * devolvendo uma lista estruturada de ideias de post prontas para virar rascunho.
 */

export interface ContentPlanItem {
  day: number;              // dia do mês (1-31)
  weekday?: string;         // ex: "Segunda"
  theme: string;            // tema/assunto do post
  format: string;           // ex: "Carrossel", "Reel", "Post único", "Story"
  hook: string;             // gancho/headline
  captionIdea: string;      // ideia de legenda (curta)
  hashtags: string[];       // hashtags sugeridas
  objective?: string;       // engajar | vender | educar
}

export interface GenerateContentPlanParams {
  ownerId: string;
  brandId?: string;
  month?: string;           // "2026-07" ou nome; livre
  postsCount?: number;      // quantos posts no plano (default 12)
  platforms?: string[];     // ex: ["instagram","facebook"]
  goals?: string;           // objetivos do mês (texto livre)
}

export interface GenerateContentPlanResult {
  month: string;
  brandName?: string;
  items: ContentPlanItem[];
}

function safeParseJsonArray(raw: string): any[] {
  // remove cercas de código e tenta achar o primeiro array JSON
  let s = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const start = s.indexOf('[');
  const end = s.lastIndexOf(']');
  if (start >= 0 && end > start) s = s.slice(start, end + 1);
  try {
    const parsed = JSON.parse(s);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function generateContentPlan(params: GenerateContentPlanParams): Promise<GenerateContentPlanResult> {
  const count = Math.min(Math.max(params.postsCount || 12, 1), 31);
  const platforms = params.platforms && params.platforms.length ? params.platforms.join(', ') : 'Instagram';
  const month = params.month || 'o próximo mês';

  let brand: any = null;
  if (params.brandId) {
    brand = await prisma.brand.findFirst({ where: { id: params.brandId, userId: params.ownerId } });
  }

  const brandBlock = brand
    ? `MARCA: ${brand.name}
DESCRIÇÃO: ${brand.description || '—'}
TOM DE VOZ: ${brand.voiceTone || '—'}
PRODUTOS/SERVIÇOS: ${(brand.products || []).join(', ') || '—'}
HASHTAGS PADRÃO: ${(brand.defaultHashtags || []).join(' ') || '—'}`
    : 'MARCA: (genérica — use um tom profissional e versátil)';

  const prompt = `Você é um estrategista de social media sênior. Monte um PLANO DE CONTEÚDO para ${month} com exatamente ${count} posts para as plataformas: ${platforms}.

${brandBlock}

OBJETIVOS DO MÊS: ${params.goals || 'crescer alcance, engajamento e vendas de forma equilibrada'}

Regras:
- Varie formatos (Carrossel, Reel, Post único, Story) e objetivos (engajar, vender, educar).
- Distribua os posts ao longo do mês (dias diferentes, evite domingos em excesso).
- Ganchos ("hook") fortes, específicos e escaneáveis.
- Legendas ("captionIdea") curtas (1-2 frases) — é só a IDEIA, não a legenda final.
- 3 a 6 hashtags relevantes por post (sem #, só as palavras).

Responda APENAS com um array JSON válido (sem texto fora do JSON), no formato:
[
  {"day": 3, "weekday": "Quarta", "theme": "...", "format": "Carrossel", "hook": "...", "captionIdea": "...", "hashtags": ["...","..."], "objective": "educar"}
]`;

  const raw = await callText(prompt);
  const arr = safeParseJsonArray(raw);

  const items: ContentPlanItem[] = arr.slice(0, count).map((it: any, i: number) => ({
    day: Number(it.day) || i + 1,
    weekday: typeof it.weekday === 'string' ? it.weekday : undefined,
    theme: String(it.theme || it.tema || 'Conteúdo'),
    format: String(it.format || it.formato || 'Post único'),
    hook: String(it.hook || it.gancho || ''),
    captionIdea: String(it.captionIdea || it.caption || it.legenda || ''),
    hashtags: Array.isArray(it.hashtags) ? it.hashtags.map((h: any) => String(h).replace(/^#/, '')).slice(0, 8) : [],
    objective: typeof it.objective === 'string' ? it.objective : undefined,
  }));

  if (!items.length) {
    throw new Error('A IA não retornou um plano válido. Tente novamente ou ajuste os objetivos.');
  }

  return { month, brandName: brand?.name, items };
}
