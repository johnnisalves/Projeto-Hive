import { Router, Response } from 'express';
import { z } from 'zod';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate';
import { prisma } from '../config/database';
import { resolveOwnerId } from '../helpers/resolveOwnerId';
import {
  createPost,
  listPosts,
  getPost,
  updatePost,
  deletePost,
  publishPost,
  schedulePostController,
  addImageToPost,
  removeImageFromPost,
} from '../controllers/post.controller';

const router = Router();

const postImageSchema = z.object({
  imageUrl: z.string().url(),
  minioKey: z.string().optional(),
  order: z.number().int().min(0).max(9).optional(),
  source: z.enum(['NANOBANA', 'UPLOAD', 'URL']).optional(),
  prompt: z.string().optional(),
});

const createPostSchema = z.object({
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
  platforms: z.array(z.enum(['INSTAGRAM', 'FACEBOOK', 'LINKEDIN', 'X'])).optional(),
});

const scheduleSchema = z.object({
  scheduledAt: z.string().datetime(),
});

const addImageSchema = z.object({
  imageUrl: z.string().url(),
  minioKey: z.string().optional(),
  order: z.number().int().min(0).max(9).optional(),
  source: z.enum(['NANOBANA', 'UPLOAD', 'URL']).optional(),
  prompt: z.string().optional(),
});

router.use(authMiddleware);

router.post('/', validate(createPostSchema), createPost);
router.get('/', listPosts);
router.get('/:id', getPost);
router.put('/:id', updatePost);
router.delete('/:id', deletePost);
router.post('/:id/publish', publishPost);
router.post('/:id/schedule', validate(scheduleSchema), schedulePostController);
router.post('/:id/images', validate(addImageSchema), addImageToPost);
router.delete('/:id/images/:imageId', removeImageFromPost);

// #2 Fila de aprovacao: define o estado de aprovacao do post (workflow de equipe)
const approvalSchema = z.object({ approvalState: z.enum(['none', 'pending', 'approved', 'rejected']) });
router.put('/:id/approval', validate(approvalSchema), async (req: AuthRequest, res: Response) => {
  try {
    const ownerId = await resolveOwnerId(req.userId!);
    const post = await prisma.post.findFirst({ where: { id: req.params.id, userId: ownerId } });
    if (!post) { res.status(404).json({ success: false, error: 'Post nao encontrado' }); return; }
    const updated = await prisma.post.update({ where: { id: post.id }, data: { approvalState: req.body.approvalState } as any });
    res.json({ success: true, data: updated });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Falha ao atualizar aprovacao' });
  }
});

// #9 Evergreen: marca/desmarca o post para republicacao recorrente
const evergreenSchema = z.object({
  isEvergreen: z.boolean(),
  evergreenIntervalDays: z.number().int().min(1).max(365).optional(),
});
router.put('/:id/evergreen', validate(evergreenSchema), async (req: AuthRequest, res: Response) => {
  try {
    const ownerId = await resolveOwnerId(req.userId!);
    const post = await prisma.post.findFirst({ where: { id: req.params.id, userId: ownerId } });
    if (!post) { res.status(404).json({ success: false, error: 'Post nao encontrado' }); return; }
    const data: any = { isEvergreen: req.body.isEvergreen };
    if (req.body.evergreenIntervalDays) data.evergreenIntervalDays = req.body.evergreenIntervalDays;
    const updated = await prisma.post.update({ where: { id: post.id }, data });
    res.json({ success: true, data: updated });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Falha ao atualizar evergreen' });
  }
});

export default router;
