import { z } from 'zod';

/**
 * Schemas de validacao das rotas de post.
 *
 * Ficam fora de post.routes.ts para poder ser testados sem subir o Express
 * nem o Prisma (ver post.schemas.test.ts).
 */

export const postImageSchema = z.object({
  imageUrl: z.string().url(),
  minioKey: z.string().optional(),
  order: z.number().int().min(0).max(9).optional(),
  source: z.enum(['NANOBANA', 'UPLOAD', 'URL']).optional(),
  prompt: z.string().optional(),
});

// Marcacao de pessoa na imagem. x/y sao a posicao relativa (0.0–1.0) onde o
// selo aparece; imageIndex diz em qual foto do carrossel a marcacao entra.
export const userTagSchema = z.object({
  username: z.string().min(1).max(30),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  imageIndex: z.number().int().min(0).max(9).optional(),
});

/**
 * Plataformas aceitas. TIKTOK precisa estar aqui: o enum do Prisma, o
 * publisher e a interface ja suportam, e a ausencia dele aqui fazia a
 * criacao de post com TikTok voltar 400.
 */
export const PLATFORMS = ['INSTAGRAM', 'FACEBOOK', 'LINKEDIN', 'X', 'TIKTOK', 'THREADS'] as const;

// Campos que alimentam os parametros extras da API do Instagram.
export const instagramFeatureShape = {
  userTags: z.array(userTagSchema).max(20).optional(),
  collaborators: z.array(z.string().min(1).max(30)).max(3).optional(),
  locationId: z.string().optional(),
  altText: z.string().max(1000).optional(),
  shareToFeed: z.boolean().optional(),
  audioName: z.string().max(100).optional(),
  coverUrl: z.string().url().optional(),
  thumbOffsetMs: z.number().int().min(0).optional(),
  isAiGenerated: z.boolean().optional(),
  isPaidPartnership: z.boolean().optional(),
  sponsorIds: z.array(z.string()).max(2).optional(),
  audioUrl: z.string().url().optional(),
  audioVolume: z.number().int().min(0).max(100).optional(),
};

export const createPostSchema = z.object({
  caption: z.string().max(2200).optional(),
  imageUrl: z.string().optional(), // Allow comma-separated URLs from MCP clients
  imageSource: z.enum(['NANOBANA', 'UPLOAD', 'URL']).optional(),
  nanoPrompt: z.string().optional(),
  source: z.enum(['WEB', 'TELEGRAM', 'MCP']).optional(),
  hashtags: z.array(z.string()).optional(),
  aspectRatio: z.string().optional(),
  isCarousel: z.boolean().optional(),
  images: z.array(postImageSchema).min(2).max(10).optional(),
  // Video fields
  mediaType: z.enum(['IMAGE', 'VIDEO', 'CAROUSEL']).optional(),
  publishMode: z.enum(['FEED', 'REELS', 'STORIES']).optional(),
  videoUrl: z.string().url().optional(),
  videoMinioKey: z.string().optional(),
  videoDurationSec: z.number().int().optional(),
  videoSizeBytes: z.number().int().optional(),
  keepMedia: z.boolean().optional(),
  editorState: z.any().optional(),
  brandId: z.string().uuid().optional(),
  platforms: z.array(z.enum(PLATFORMS)).optional(),
  sendWhatsappStatus: z.boolean().optional(),
  // Recursos de publicacao do Instagram (marcacao, colaboradores, acessibilidade, etc.)
  ...instagramFeatureShape,
});

export const scheduleSchema = z.object({
  scheduledAt: z.string().datetime(),
});

/**
 * Campanha: varias imagens viram varios posts agendados de uma vez.
 * Cada item ja chega com legenda e horario definidos pela tela.
 */
export const campaignSchema = z.object({
  items: z.array(z.object({
    imageUrl: z.string().url(),
    caption: z.string().max(2200).optional(),
    hashtags: z.array(z.string()).optional(),
    scheduledAt: z.string().datetime(),
  })).min(2).max(60),
  brandId: z.string().uuid().optional(),
  platforms: z.array(z.enum(PLATFORMS)).optional(),
  aspectRatio: z.string().optional(),
  sendWhatsappStatus: z.boolean().optional(),
  ...instagramFeatureShape,
});

export const addImageSchema = z.object({
  imageUrl: z.string().url(),
  minioKey: z.string().optional(),
  order: z.number().int().min(0).max(9).optional(),
  source: z.enum(['NANOBANA', 'UPLOAD', 'URL']).optional(),
  prompt: z.string().optional(),
});
