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
import { createPostSchema, scheduleSchema, addImageSchema, campaignSchema } from './post.schemas';
import { schedulePost } from '../services/scheduler.service';
import { rememberContacts, usernamesFromPost } from '../services/ig-contacts.service';

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

/**
 * POST /api/posts/campaign — plano de divulgacao.
 *
 * Recebe N imagens ja com legenda e horario e cria N posts agendados.
 * A tela calcula as datas (ver campaign.ts) e gera as legendas com IA;
 * aqui so persistimos e enfileiramos.
 *
 * Cada post e criado e agendado individualmente: se um item falhar, os
 * outros seguem, e a resposta diz quais deram certo. Abortar a campanha
 * inteira por causa de uma imagem seria pior para quem esta publicando.
 */
router.post('/campaign', validate(campaignSchema), async (req: AuthRequest, res: Response) => {
  try {
    const userId = await resolveOwnerId(req.userId!);
    const { items, ...shared } = req.body;

    const created: Array<{ id: string; scheduledAt: string }> = [];
    const failed: Array<{ imageUrl: string; error: string }> = [];

    for (const item of items) {
      try {
        const when = new Date(item.scheduledAt);
        const post = await prisma.post.create({
          data: {
            ...shared,
            userId,
            imageUrl: item.imageUrl,
            caption: item.caption || null,
            hashtags: item.hashtags || [],
            imageSource: 'UPLOAD',
            source: 'WEB',
            scheduledAt: when,
            status: 'SCHEDULED',
          },
        });
        await schedulePost(post.id, when);
        created.push({ id: post.id, scheduledAt: when.toISOString() });
      } catch (err: any) {
        failed.push({ imageUrl: item.imageUrl, error: err?.message || 'Falha ao criar post' });
      }
    }

    // Alimenta a agenda de @ com quem foi marcado na campanha inteira.
    void rememberContacts(userId, usernamesFromPost(shared)).catch(() => {});

    res.status(created.length ? 201 : 500).json({
      success: created.length > 0,
      data: { created: created.length, failed: failed.length, posts: created, errors: failed },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Falha ao criar a campanha' });
  }
});

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
