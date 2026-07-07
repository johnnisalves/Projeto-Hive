import { api } from '../api-client';

export interface ComposeImageInput {
  background_prompt?: string;
  background_url?: string;
  html: string;
  aspect_ratio?: '1:1' | '4:5' | '9:16';
  overlay_opacity?: number;
  brand_id?: string;
  apply_brand?: boolean;
  enrich_background?: boolean;
}

export async function composeImageWithOverlay(input: ComposeImageInput) {
  if (!input.background_prompt && !input.background_url) {
    throw new Error('Either background_prompt or background_url is required');
  }

  const result = await api.generateComposed({
    html: input.html,
    backgroundPrompt: input.background_prompt,
    backgroundUrl: input.background_url,
    aspectRatio: input.aspect_ratio,
    overlayOpacity: input.overlay_opacity,
    brandId: input.brand_id,
    applyBrand: input.apply_brand,
    enrichBackground: input.enrich_background,
  });

  return {
    image_url: (result as any).imageUrl,
    background_url: (result as any).backgroundUrl,
    tip: 'Use this image_url with create_post or add_image_to_post to publish.',
  };
}
