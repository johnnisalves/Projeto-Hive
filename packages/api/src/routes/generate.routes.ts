import { Router, Response } from 'express';
import { z } from 'zod';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate';
import { generateImageController, generateCaptionController, refineSlideController } from '../controllers/generate.controller';
import { renderTemplateToImage, renderHtmlToImage, renderComposedToImage } from '../services/template-renderer.service';
import { TEMPLATES } from '../services/templates';
import { generateImage } from '../services/nanobana.service';
import { generateImagePromptForStudio } from '../services/caption.service';
import { enrichImagePrompt } from '../services/artDirector.service';
import { prisma } from '../config/database';
import { resolveOwnerId } from '../helpers/resolveOwnerId';

const router = Router();

const imageSchema = z.object({
  prompt: z.string().min(1),
  style: z.string().optional(),
  aspectRatio: z.enum(['1:1', '9:16', '4:5']).optional(),
  // Art-director enrichment (opt-in)
  brandId: z.string().optional(),
  enrich: z.boolean().optional(),
  artStyle: z.enum(['humanizado', 'grafico']).optional(),
  bakeText: z.boolean().optional(),
});

const captionSchema = z.object({
  topic: z.string().min(1),
  tone: z.enum(['educativo', 'inspirador', 'humor', 'noticia']).optional(),
  hashtagsCount: z.number().min(1).max(30).optional(),
  language: z.string().optional(),
  maxLength: z.number().max(2200).optional(),
  brandId: z.string().optional(),
});

router.use(authMiddleware);

router.post('/image', validate(imageSchema), generateImageController);
router.post('/caption', validate(captionSchema), generateCaptionController);

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

export default router;
