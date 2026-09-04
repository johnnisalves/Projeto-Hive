import { Router, Response } from 'express';
import { z } from 'zod';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate';
import { generateImageController, generateCaptionController, refineSlideController } from '../controllers/generate.controller';
import { renderTemplateToImage, renderHtmlToImage, renderComposedToImage } from '../services/template-renderer.service';
import { TEMPLATES } from '../services/templates';
import { generateImage } from '../services/nanobana.service';
import { generateImagePromptForStudio, callText, generateAltText } from '../services/caption.service';
import { enrichImagePrompt } from '../services/artDirector.service';
import { prisma } from '../config/database';
import { resolveOwnerId } from '../helpers/resolveOwnerId';
import { generateContentPlan } from '../services/content-planner.service';
import { buildConcepts } from '../services/creative/creative-director.service';

const router = Router();

const imageSchema = z.object({
  prompt: z.string().min(1),
  style: z.string().optional(),
  aspectRatio: z.enum(['1:1', '9:16', '4:5', '16:9']).optional(),
  // Named format ('ig-feed', 'yt-thumbnail'…). Takes precedence over aspectRatio.
  format: z.string().optional(),
  brandId: z.string().optional(),
  // Legacy 1-stage art director (opt-in)
  enrich: z.boolean().optional(),
  artStyle: z.enum(['humanizado', 'grafico']).optional(),
  bakeText: z.boolean().optional(),
  // Creative Engine v2 (opt-in)
  creativeEngine: z.boolean().optional(),
  creativeMode: z.enum(['auto', 'cinematic', 'editorial', 'food', 'pop', 'luxury', 'minimal', 'vintage', 'humor', 'viral', '3d', 'product', 'humanized', 'constructive']).optional(),
  creativeIntensity: z.enum(['conservative', 'balanced', 'bold', 'experimental']).optional(),
  variationSeed: z.number().optional(),
  hasUserPhoto: z.boolean().optional(),
  headline: z.string().optional(),
  points: z.array(z.string()).optional(),
  platform: z.string().optional(),
  qaMode: z.enum(['off', 'report']).optional(),
  chosenConcept: z.any().optional(),
  // Reuse a plan from a previous generation (Feed + Story pair).
  creativePlan: z.any().optional(),
  recomposedFrom: z.string().optional(),
});

const captionSchema = z.object({
  topic: z.string().optional(),
  tone: z.enum(['educativo', 'inspirador', 'humor', 'noticia']).optional(),
  mode: z.enum(['engajar', 'vender', 'educar']).optional(),
  platform: z.string().optional(),
  hashtagsCount: z.number().min(1).max(30).optional(),
  language: z.string().optional(),
  maxLength: z.number().max(2200).optional(),
  brandId: z.string().optional(),
  imageUrl: z.string().optional(),
});

router.use(authMiddleware);

router.post('/image', validate(imageSchema), generateImageController);
router.post('/caption', validate(captionSchema), generateCaptionController);

// "Melhorar prompt": corrige o portugues e estrutura o texto do usuario como
// briefing profissional — preservando literalmente o que ele escreveu e sem
// inventar fatos. E texto puro, rapido e barato; roda antes da geracao.
const improvePromptSchema = z.object({
  prompt: z.string().min(3).max(6000),
  brandId: z.string().optional(),
  aspectRatio: z.string().optional(),
  platform: z.string().optional(),
});
router.post('/improve-prompt', validate(improvePromptSchema), async (req: AuthRequest, res: Response) => {
  try {
    const { prompt, brandId, aspectRatio, platform } = req.body as { prompt: string; brandId?: string; aspectRatio?: string; platform?: string };
    const ownerId = await resolveOwnerId(req.userId!);
    let brandBlock = 'nao informada';
    if (brandId) {
      const brand = await prisma.brand.findFirst({ where: { id: brandId, userId: ownerId } });
      if (brand) {
        brandBlock = [
          `Nome: ${brand.name}`,
          brand.nicho ? `Ramo: ${brand.nicho}` : '',
          brand.cidade ? `Cidade: ${brand.cidade}` : '',
          brand.slogan ? `Slogan: ${brand.slogan}` : '',
          brand.voiceTone ? `Tom de voz: ${brand.voiceTone}` : '',
          brand.products?.length ? `Produtos: ${brand.products.slice(0, 6).join(', ')}` : '',
          brand.artDirection ? `Regras de arte: ${brand.artDirection.slice(0, 600)}` : '',
        ].filter(Boolean).join('\n');
      }
    }
    const instruction = `Voce e um diretor de criacao senior de agencia. Reescreva o TEXTO DO USUARIO abaixo como um briefing criativo profissional, em portugues do Brasil impecavel, pronto para um gerador de imagem publicitaria.

REGRAS ABSOLUTAS:
1. Preserve LITERALMENTE tudo que o usuario disse de forma explicita: headline, texto de apoio, CTA, cena, pessoas, objetos, formato. Corrija apenas ortografia e acentuacao desses textos, sem trocar palavras.
2. NUNCA invente preco, desconto, promocao, cashback, data, prazo, endereco, telefone, premio ou qualquer promessa que o usuario nao escreveu.
3. Preencha apenas o que faltou: objetivo, cena/composicao, direcao de fotografia e luz, paleta coerente com a marca, hierarquia visual. Se o usuario nao deu headline, proponha UMA (2 a 7 palavras) marcada como "sugestao".
4. Respeite as regras de arte da marca (abaixo). Se a marca proibe algo, nao inclua.
5. Formato do post: ${aspectRatio || '4:5'}${platform ? ` (${platform})` : ''}.
6. Saida: texto corrido em secoes curtas com estes titulos, em MAIUSCULAS: OBJETIVO, CENA E COMPOSICAO, DIRECAO DE ARTE, TEXTO NA ARTE (headline / apoio / CTA), FORMATO. Maximo 220 palavras. Sem markdown, sem comentarios, sem explicar o que mudou.

MARCA:
${brandBlock}

TEXTO DO USUARIO:
"""${prompt.slice(0, 5000)}"""`;
    const improved = (await callText(instruction, undefined, ownerId)).trim().replace(/^```[a-z]*\n?|```$/g, '').trim();
    if (!improved) throw new Error('A IA nao devolveu texto.');
    res.json({ success: true, data: { prompt: improved } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Falha ao melhorar o prompt' });
  }
});

// Creative Director mode: three distinct concepts for one brief (text only, cheap).
const conceptsSchema = z.object({
  prompt: z.string().min(1),
  brandId: z.string().optional(),
  format: z.string().optional(),
  aspectRatio: z.enum(['1:1', '9:16', '4:5', '16:9']).optional(),
  creativeMode: z.string().optional(),
  creativeIntensity: z.enum(['conservative', 'balanced', 'bold', 'experimental']).optional(),
  platform: z.string().optional(),
  headline: z.string().optional(),
});
router.post('/concepts', validate(conceptsSchema), async (req: AuthRequest, res: Response) => {
  try {
    const { prompt, brandId, format, aspectRatio, creativeMode, creativeIntensity, platform, headline } = req.body as any;
    let brand: any = null;
    if (brandId) {
      const userId = await resolveOwnerId(req.userId!);
      brand = await prisma.brand.findFirst({ where: { id: brandId, userId } });
    }
    const result = await buildConcepts({
      topic: prompt,
      brand: brand ? {
        name: brand.name, description: brand.description, voiceTone: brand.voiceTone,
        primaryColor: brand.primaryColor, secondaryColor: brand.secondaryColor,
        accentColor: brand.accentColor, backgroundColor: brand.backgroundColor,
        products: brand.products, artDirection: brand.artDirection,
        niche: brand.nicho, slogan: brand.slogan, website: brand.websiteUrl,
        phone: brand.whatsappPhone || brand.phone,
      } : null,
      format: format || aspectRatio,
      creativeMode,
      creativeIntensity,
      platform,
      headline,
    });
    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Falha ao gerar conceitos' });
  }
});

// Planejador de conteúdo mensal com IA
const contentPlanSchema = z.object({
  brandId: z.string().optional(),
  month: z.string().optional(),
  postsCount: z.number().min(1).max(31).optional(),
  platforms: z.array(z.string()).optional(),
  goals: z.string().optional(),
});
router.post('/content-plan', validate(contentPlanSchema), async (req: AuthRequest, res: Response) => {
  try {
    const ownerId = await resolveOwnerId(req.userId!);
    const result = await generateContentPlan({ ownerId, ...req.body });
    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Falha ao gerar plano de conteúdo' });
  }
});

// #6 Repurpose: adapta uma legenda para o formato/tom de cada plataforma
const PLATFORM_RULES_REPURPOSE: Record<string, string> = {
  instagram: 'Instagram: visual, emojis com moderacao, quebras de linha, CTA no fim, ate 5 hashtags.',
  facebook: 'Facebook: tom mais conversacional, pode ser um pouco mais longo, storytelling, 2-3 hashtags.',
  linkedin: 'LinkedIn: profissional, sem emojis exagerados, insight/valor, sem hashtags demais (3-4), tom de autoridade.',
  x: 'X/Twitter: MUITO curto e direto (ate 280 caracteres), 1 ideia forte, 1-2 hashtags no maximo.',
  whatsapp: 'WhatsApp Status: curtissimo, direto, 1 frase de impacto + CTA, emojis ok, sem hashtags.',
};
const repurposeSchema = z.object({
  caption: z.string().min(1),
  platforms: z.array(z.enum(['instagram', 'facebook', 'linkedin', 'x', 'whatsapp'])).min(1),
  brandId: z.string().optional(),
});
router.post('/repurpose', validate(repurposeSchema), async (req: AuthRequest, res: Response) => {
  try {
    const { caption, platforms, brandId } = req.body as { caption: string; platforms: string[]; brandId?: string };
    let brandTone = '';
    if (brandId) {
      const ownerId = await resolveOwnerId(req.userId!);
      const brand = await prisma.brand.findFirst({ where: { id: brandId, userId: ownerId } });
      if (brand) brandTone = `\nTOM DA MARCA ${brand.name}: ${brand.voiceTone || 'profissional'}.`;
    }
    const out: Record<string, string> = {};
    await Promise.all(platforms.map(async (p) => {
      const prompt = `Reescreva o conteudo abaixo adaptado para ${PLATFORM_RULES_REPURPOSE[p] || p}.${brandTone}\nMantenha a mensagem central. Responda APENAS com o texto final, sem explicacoes.\n\nCONTEUDO ORIGINAL:\n${caption}`;
      try { out[p] = (await callText(prompt)).trim(); } catch (e: any) { out[p] = `(erro: ${e?.message || 'falha'})`; }
    }));
    res.json({ success: true, data: { results: out } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Falha ao adaptar conteudo' });
  }
});

// #7 Variacoes A/B de legenda: gera N variacoes para testar
const variationsSchema = z.object({
  topic: z.string().min(1),
  count: z.number().min(2).max(5).optional(),
  platform: z.string().optional(),
  brandId: z.string().optional(),
});
router.post('/caption-variations', validate(variationsSchema), async (req: AuthRequest, res: Response) => {
  try {
    const { topic, count, platform, brandId } = req.body as { topic: string; count?: number; platform?: string; brandId?: string };
    const n = count || 3;
    let brandTone = '';
    if (brandId) {
      const ownerId = await resolveOwnerId(req.userId!);
      const brand = await prisma.brand.findFirst({ where: { id: brandId, userId: ownerId } });
      if (brand) brandTone = ` Tom da marca ${brand.name}: ${brand.voiceTone || 'profissional'}.`;
    }
    const prompt = `Gere ${n} VARIACOES bem diferentes de legenda para um post sobre: "${topic}" (plataforma: ${platform || 'Instagram'}).${brandTone}
Cada variacao deve testar um angulo/gancho diferente (ex: pergunta, dado, historia, urgencia, beneficio). Curtas e escaneaveis.
Responda APENAS com um array JSON de strings, ex: ["variacao 1","variacao 2","variacao 3"]`;
    const raw = await callText(prompt);
    let s = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
    const a = s.indexOf('['), b = s.lastIndexOf(']');
    if (a >= 0 && b > a) s = s.slice(a, b + 1);
    let variations: string[] = [];
    try { const parsed = JSON.parse(s); if (Array.isArray(parsed)) variations = parsed.map((x) => String(x)).slice(0, n); } catch { /* ignore */ }
    if (!variations.length) variations = raw.split('\n').map((l) => l.replace(/^\s*[\d\-\.\)]+\s*/, '').trim()).filter(Boolean).slice(0, n);
    res.json({ success: true, data: { variations } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Falha ao gerar variacoes' });
  }
});

const imagePromptSchema = z.object({
  topic: z.string().min(1),
  brandId: z.string().optional(),
  style: z.string().optional(),
  aspectRatio: z.string().optional(),
  usage: z.string().optional(),
});

router.post('/image-prompt', validate(imagePromptSchema), async (req: AuthRequest, res: Response) => {
  try {
    const result = await generateImagePromptForStudio(req.body);
    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Failed to generate image prompt' });
  }
});

// Refine slide content with AI (Gemini)
const refineSchema = z.object({
  title: z.string().min(1),
  subtitle: z.string().optional(),
  label: z.string().optional(),
  instruction: z.string().min(1),
});
router.post('/refine', validate(refineSchema), refineSlideController);

// Template-based image generation (no AI needed)
const templateSchema = z.object({
  title: z.string().min(1),
  subtitle: z.string().optional(),
  body: z.string().optional(),
  accent: z.string().optional(),
  template: z.string().optional().default('bold-gradient'),
  aspectRatio: z.enum(['1:1', '9:16', '4:5']).optional(),
  // Brand integration
  brandId: z.string().optional(),
  primaryColor: z.string().optional(),
  secondaryColor: z.string().optional(),
  backgroundColor: z.string().optional(),
  textColor: z.string().optional(),
  mutedColor: z.string().optional(),
  fontFamily: z.string().optional(),
  headingFont: z.string().optional(),
  bodyFont: z.string().optional(),
  logoUrl: z.string().optional(),
  brandName: z.string().optional(),
  applyBrand: z.boolean().optional(),
});

router.post('/template', validate(templateSchema), async (req: AuthRequest, res: Response) => {
  try {
    const body = { ...req.body };

    // If brandId provided, fetch brand and apply colors/logo
    if (body.brandId && body.applyBrand !== false) {
      const userId = await resolveOwnerId(req.userId!);
      const brand = await prisma.brand.findFirst({
        where: { id: body.brandId, userId },
      });
      if (brand) {
        body.primaryColor = body.primaryColor || brand.primaryColor;
        body.secondaryColor = body.secondaryColor || brand.secondaryColor;
        body.backgroundColor = body.backgroundColor || brand.backgroundColor || undefined;
        body.textColor = body.textColor || brand.textColor || undefined;
        body.mutedColor = body.mutedColor || brand.mutedColor || undefined;
        body.fontFamily = body.fontFamily || brand.fontFamily || undefined;
        body.headingFont = body.headingFont || brand.headingFont || undefined;
        body.bodyFont = body.bodyFont || brand.bodyFont || undefined;
        body.logoUrl = body.logoUrl || brand.logoUrl || undefined;
        body.brandName = body.brandName || brand.name;
      }
    }

    const result = await renderTemplateToImage(body);
    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Failed to render template' });
  }
});

// List available templates
router.get('/templates', (_req: AuthRequest, res: Response) => {
  res.json({ success: true, data: TEMPLATES });
});

// Render raw HTML/CSS/Tailwind to image (used by MCP from IDEs)
const htmlSchema = z.object({
  html: z.string().min(1),
  width: z.number().optional().default(1080),
  height: z.number().optional().default(1080),
});

router.post('/html', validate(htmlSchema), async (req: AuthRequest, res: Response) => {
  try {
    const { html, width, height } = req.body;
    const result = await renderHtmlToImage(html, width, height);
    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Failed to render HTML' });
  }
});

// Composed image: AI background + HTML/Tailwind overlay
const composedSchema = z.object({
  html: z.string().min(1),
  // Either provide a prompt to generate the background OR a ready URL
  backgroundPrompt: z.string().optional(),
  backgroundUrl: z.string().url().optional(),
  aspectRatio: z.enum(['1:1', '9:16', '4:5']).optional(),
  overlayOpacity: z.number().min(0).max(1).optional(),
  // Brand integration
  brandId: z.string().optional(),
  applyBrand: z.boolean().optional(),
  // Art-director enrichment of the AI background (defaults ON when a brand is applied)
  enrichBackground: z.boolean().optional(),
});

function getSizeFromAspect(ar?: string): { width: number; height: number } {
  switch (ar) {
    case '9:16': return { width: 1080, height: 1920 };
    case '4:5': return { width: 1080, height: 1350 };
    default: return { width: 1080, height: 1080 };
  }
}

router.post('/composed', validate(composedSchema), async (req: AuthRequest, res: Response) => {
  try {
    const { html, backgroundPrompt, backgroundUrl, aspectRatio, overlayOpacity, brandId, applyBrand, enrichBackground } = req.body;
    const { width, height } = getSizeFromAspect(aspectRatio);

    // Resolve brand once (used for both art-director enrichment and overlay colors/logo)
    let brand: any = null;
    if (brandId && applyBrand !== false) {
      const userId = await resolveOwnerId(req.userId!);
      brand = await prisma.brand.findFirst({ where: { id: brandId, userId } });
    }

    // Step 1: Resolve background URL (generate via AI if prompt was given)
    let bgUrl = backgroundUrl as string | undefined;
    if (!bgUrl && backgroundPrompt) {
      let bgPrompt: string = backgroundPrompt;
      let bgNegative: string | undefined;
      let bgPreEnriched = false;
      // Art-director enrichment: default ON when a brand is applied, unless explicitly disabled
      const shouldEnrich = enrichBackground !== false && !!brand;
      if (shouldEnrich) {
        try {
          const enriched = await enrichImagePrompt({
            topic: backgroundPrompt,
            brand: {
              name: brand.name,
              description: brand.description,
              voiceTone: brand.voiceTone,
              primaryColor: brand.primaryColor,
              secondaryColor: brand.secondaryColor,
              accentColor: brand.accentColor || undefined,
              backgroundColor: brand.backgroundColor || undefined,
              products: brand.products,
              artDirection: brand.artDirection || undefined,
            },
            aspectRatio,
            bakeText: false,
          });
          bgPrompt = enriched.prompt;
          bgNegative = enriched.negativePrompt;
          bgPreEnriched = true;
        } catch {
          /* fall back to the raw background prompt */
        }
      }
      console.log(`[composed] AI background (enriched=${bgPreEnriched}):`, bgPrompt.slice(0, 120));
      const bg = await generateImage({ prompt: bgPrompt, aspectRatio, negativePrompt: bgNegative, preEnriched: bgPreEnriched });
      bgUrl = bg.imageUrl;
    }
    // bgUrl can be empty — the HTML itself may contain the background
    if (!bgUrl) bgUrl = '';

    // Step 2: Brand overlay fields (colors / fonts / logo / name)
    let brandPrimaryColor: string | undefined;
    let brandSecondaryColor: string | undefined;
    let brandAccentColor: string | undefined;
    let brandTextColor: string | undefined;
    let brandFontFamily: string | undefined;
    let brandHeadingFont: string | undefined;
    let brandBodyFont: string | undefined;
    let brandLogoUrl: string | undefined;
    let brandName: string | undefined;
    if (brand) {
      brandPrimaryColor = brand.primaryColor;
      brandSecondaryColor = brand.secondaryColor;
      brandAccentColor = brand.accentColor || undefined;
      brandTextColor = brand.textColor || undefined;
      brandFontFamily = brand.fontFamily || undefined;
      brandHeadingFont = brand.headingFont || undefined;
      brandBodyFont = brand.bodyFont || undefined;
      brandLogoUrl = brand.logoUrl || undefined;
      brandName = brand.name;
    }

    // Step 3: Compose
    const result = await renderComposedToImage({
      backgroundUrl: bgUrl,
      html,
      width,
      height,
      overlayOpacity,
      brandPrimaryColor,
      brandSecondaryColor,
      brandAccentColor,
      brandTextColor,
      brandFontFamily,
      brandHeadingFont,
      brandBodyFont,
      brandLogoUrl,
      brandName,
    });

    res.json({ success: true, data: { ...result, backgroundUrl: bgUrl } });
  } catch (err: any) {
    console.error('[composed] error:', err);
    res.status(500).json({ success: false, error: err?.message || 'Failed to render composed image' });
  }
});

/**
 * POST /api/generate/alt-text — descricao da imagem para leitor de tela.
 *
 * A IA ja enxerga a arte, entao acessibilidade sai praticamente de graca.
 * O Instagram tambem usa o alt_text para entender o conteudo, o que ajuda
 * o alcance — e o dobro motivo para preencher.
 */
const altTextSchema = z.object({ imageUrl: z.string().url() });

router.post('/alt-text', validate(altTextSchema), async (req: AuthRequest, res: Response) => {
  try {
    const texto = await generateAltText(req.body.imageUrl);
    if (!texto) {
      res.status(503).json({ success: false, error: 'A IA nao conseguiu descrever a imagem agora.' });
      return;
    }
    res.json({ success: true, data: { altText: texto } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Falha ao gerar o texto alternativo' });
  }
});

export default router;
