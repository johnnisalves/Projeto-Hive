import { Request, Response } from 'express';
import { generateImage } from '../services/nanobana.service';
import { generateCaption, refineSlide } from '../services/caption.service';
import { enrichImagePrompt } from '../services/artDirector.service';
import { prisma } from '../config/database';
import { resolveOwnerId } from '../helpers/resolveOwnerId';

export async function generateImageController(req: Request, res: Response) {
  try {
    const { prompt, style, aspectRatio, brandId, enrich, artStyle, bakeText } = req.body as any;

    let finalPrompt: string = prompt;
    let negativePrompt: string | undefined;
    let preEnriched = false;

    // 2-stage art-director enrichment (opt-in via `enrich`)
    if (enrich) {
      let brand: any = null;
      if (brandId) {
        try {
          const userId = await resolveOwnerId((req as any).userId);
          brand = await prisma.brand.findFirst({ where: { id: brandId, userId } });
        } catch {
          /* ignore brand fetch errors — enrich without brand */
        }
      }
      const enriched = await enrichImagePrompt({
        topic: prompt,
        brand: brand
          ? {
              name: brand.name,
              description: brand.description,
              voiceTone: brand.voiceTone,
              primaryColor: brand.primaryColor,
              secondaryColor: brand.secondaryColor,
              accentColor: brand.accentColor,
              backgroundColor: brand.backgroundColor,
              products: brand.products,
              artDirection: brand.artDirection,
            }
          : null,
        aspectRatio,
        style,
        artStyle,
        bakeText,
      });
      finalPrompt = enriched.prompt;
      negativePrompt = enriched.negativePrompt;
      preEnriched = true;
    }

    const result = await generateImage({ prompt: finalPrompt, style, aspectRatio, negativePrompt, preEnriched });
    res.json({ success: true, data: result });
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
