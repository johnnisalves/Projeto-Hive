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
import { createPostSchema, scheduleSchema, addImageSchema } from './post.schemas';

const router = Router();

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
    const post = await prisma.post.findFirst({ where: { id: String(req.params.id), userId: ownerId } });
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
    const post = await prisma.post.findFirst({ where: { id: String(req.params.id), userId: ownerId } });
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
