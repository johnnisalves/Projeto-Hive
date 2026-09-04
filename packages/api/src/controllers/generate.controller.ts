import { Request, Response } from 'express';
import { generateImage } from '../services/nanobana.service';
import { generateCaption, refineSlide } from '../services/caption.service';
import { enrichImagePrompt } from '../services/artDirector.service';
import { buildCreativePlan, runQA, type Concept } from '../services/creative/creative-director.service';
import { buildFallbackImagePrompt, buildNegativePrompt, detectNiche, normalizeLogoPlacement, planToImagePrompt, resolveCreativeMode, DEFAULT_LOGO_PLACEMENT, type BrandContext, type CreativeInput, type CreativePlan } from '../services/creative/creative-engine';
import { compositeLogo } from '../services/creative/logo-composite';
import type { FormatSpec } from '../services/creative/format-spec';
import { prisma } from '../config/database';
import { resolveOwnerId } from '../helpers/resolveOwnerId';

function brandToContext(brand: any): BrandContext | null {
  if (!brand) return null;
  return {
    name: brand.name,
    description: brand.description,
    voiceTone: brand.voiceTone,
    primaryColor: brand.primaryColor,
    secondaryColor: brand.secondaryColor,
    accentColor: brand.accentColor,
    backgroundColor: brand.backgroundColor,
    products: brand.products,
    artDirection: brand.artDirection,
    // Prisma field is `nicho`; the engine expects `niche`.
    niche: brand.nicho,
    slogan: brand.slogan,
    // Commercial WhatsApp is the phone the engine may print; fall back to `phone`.
    phone: brand.whatsappPhone || brand.phone,
    address: brand.cidade,
    cidade: brand.cidade,
    // Prisma field is `websiteUrl`.
    website: brand.websiteUrl,
    referenceImages: Array.isArray(brand.referenceImages) ? brand.referenceImages : [],
  };
}

export async function generateImageController(req: Request, res: Response) {
  try {
    const {
      prompt, style, aspectRatio, format, brandId, enrich, artStyle, bakeText,
      // Creative Engine controls (all optional; the endpoint stays backward compatible)
      creativeMode, creativeIntensity, variationSeed, hasUserPhoto,
      creativeEngine, chosenConcept, qaMode, headline, points, platform,
      creativePlan, recomposedFrom,
    } = req.body as any;

    // Resolve the brand once (used by both the new engine and the legacy path).
    let brand: any = null;
    if (brandId) {
      try {
        const userId = await resolveOwnerId((req as any).userId);
        brand = await prisma.brand.findFirst({ where: { id: brandId, userId } });
      } catch {
        /* ignore brand fetch errors — proceed without brand */
      }
    }

    let finalPrompt: string = prompt;
    let negativePrompt: string | undefined;
    let preEnriched = false;
    let plan: CreativePlan | null = null;
    let usedEngine: 'v2' | 'legacy' | 'none' = 'none';

    // The official logo, when cadastered, is sent to the image model as a
    // reference so it reproduces the real mark instead of inventing one.
    const logoUrl: string | undefined = brand?.logoUrl || undefined;

    // ── Creative Engine v2 (opt-in via creativeEngine:true) ──
    if (creativeEngine) {
      const input: CreativeInput = {
        topic: prompt,
        brand: brandToContext(brand),
        format: format || aspectRatio,
        headline,
        points,
        platform,
        creativeMode,
        creativeIntensity,
        variationSeed,
        hasUserPhoto,
        bakeText,
        hasLogoReference: !!logoUrl,
        recomposedFrom,
      };
      const chosen: Concept | undefined = chosenConcept;
      if (chosen?.mode) input.creativeMode = chosen.mode;
      // A plan supplied by the caller (second format of a Feed+Story pair)
      // keeps the concept and copy identical; only the layout is rebuilt.
      plan = creativePlan || (await buildCreativePlan(input));
      // The compositing step draws from this, so it must always be sane numbers.
      if (plan && logoUrl) plan.logoPlacement = normalizeLogoPlacement(plan.logoPlacement);
      finalPrompt = plan ? planToImagePrompt(plan, input) : buildFallbackImagePrompt(input);
      negativePrompt = buildNegativePrompt(plan);
      preEnriched = true;
      usedEngine = 'v2';
    }
    // ── Legacy 1-stage art director (opt-in via enrich) ──
    else if (enrich) {
      const enriched = await enrichImagePrompt({
        topic: prompt,
        brand: brandToContext(brand),
        aspectRatio,
        style,
        artStyle,
        bakeText,
      });
      finalPrompt = enriched.prompt;
      negativePrompt = enriched.negativePrompt;
      preEnriched = true;
      usedEngine = 'legacy';
    }

    // Only pass the logo reference on the engine path (the model reproduces it);
    // the legacy path still reserves an area and composites separately.
    // Only the brand's real photos go as references — NOT the logo.
    // Sending the logo told the model "here is a mark, reproduce it", so it drew
    // one and the stamp added a second: the brand appeared twice. The real logo
    // reaches the artwork through the stamp below, never through the model.
    const brandRefs: string[] = Array.isArray(brand?.referenceImages) ? brand.referenceImages : [];
    const referenceImages = usedEngine === 'v2' && brandRefs.length ? brandRefs.slice(0, 5) : undefined;
    // Stamp the REAL logo file on the finished canvas. Image models redraw logos
    // from references and never get them exact; this does.
    const logoPlacement = plan?.logoPlacement ?? DEFAULT_LOGO_PLACEMENT;
    const postProcess = usedEngine === 'v2' && logoUrl
      ? (buf: Buffer, spec: FormatSpec) => compositeLogo(buf, spec, { logoUrl, placement: logoPlacement, plateCandidates: [brand?.accentColor, brand?.secondaryColor, brand?.primaryColor, brand?.backgroundColor] })
      : undefined;
    const result = await generateImage({ prompt: finalPrompt, style, aspectRatio, format, negativePrompt, preEnriched, referenceImages, postProcess });

    // ── Optional QA pass ──
    let qa = null;
    if (creativeEngine && qaMode && qaMode !== 'off') {
      const input: CreativeInput = { topic: prompt, brand: brandToContext(brand), format: format || aspectRatio, headline, hasUserPhoto, bakeText };
      qa = await runQA(input, plan, result.imageUrl);
    }

    const niche = usedEngine === 'v2' ? detectNiche(prompt, brandToContext(brand)) : undefined;
    res.json({
      success: true,
      data: {
        ...result,
        creativeEngine: usedEngine,
        ...(usedEngine === 'v2' ? { plan, niche, mode: plan?.mode || resolveCreativeMode(creativeMode, niche || 'general'), photoPlacement: plan?.photoPlacement ?? null, logoPlacement: logoUrl ? logoPlacement : null, qa } : {}),
      },
    });
  } catch (err: any) {
    console.error('Image generation error:', err.message || err);
    res.status(500).json({ success: false, error: err.message || 'Failed to generate image' });
  }
}

export async function generateCaptionController(req: Request, res: Response) {
  try {
    const result = await generateCaption(req.body);
    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Failed to generate caption' });
  }
}

export async function refineSlideController(req: Request, res: Response) {
  try {
    const result = await refineSlide(req.body);
    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Failed to refine slide' });
  }
}
