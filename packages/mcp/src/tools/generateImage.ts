import { api } from '../api-client';
import { GenerateImageInput } from '../types';

export async function generateImage(input: GenerateImageInput) {
  const result = await api.generateImage({
    prompt: input.prompt,
    style: input.style,
    aspectRatio: input.aspect_ratio,
    brandId: input.brand_id,
    enrich: input.enrich,
    artStyle: input.art_style,
    bakeText: input.bake_text,
  });
  return { image_url: result.imageUrl };
}
