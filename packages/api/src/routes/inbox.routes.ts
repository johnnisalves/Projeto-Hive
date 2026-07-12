import { Router, Response } from 'express';
import { z } from 'zod';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate';
import { resolveOwnerId } from '../helpers/resolveOwnerId';
import { getInbox, replyToComment } from '../services/inbox.service';

const router = Router();

router.use(authMiddleware);

// GET /api/inbox — comentarios recentes das publicacoes
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const ownerId = await resolveOwnerId(req.userId!);
    const data = await getInbox(ownerId);
    res.json({ success: true, data });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Falha ao carregar inbox' });
  }
});

// POST /api/inbox/reply — responde um comentario
const replySchema = z.object({ commentId: z.string().min(1), message: z.string().min(1).max(2200) });
router.post('/reply', validate(replySchema), async (req: AuthRequest, res: Response) => {
  try {
    const ownerId = await resolveOwnerId(req.userId!);
    const data = await replyToComment(ownerId, req.body.commentId, req.body.message);
    res.json({ success: true, data });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Falha ao responder' });
  }
});

export default router;
