import { Router, Response } from 'express';
import { z } from 'zod';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate';
import { resolveOwnerId } from '../helpers/resolveOwnerId';
import {
  getInbox, replyToComment, getDMs, replyDM,
  setCommentHidden, deleteComment, setCommentsEnabled,
} from '../services/inbox.service';
import { sugerirResposta } from '../services/reply-suggester.service';

const router = Router();

router.use(authMiddleware);

// GET /api/inbox — comentarios recentes das publicacoes
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const ownerId = await resolveOwnerId(req.userId!);
    const data = await getInbox(ownerId, req.query.brandId ? String(req.query.brandId) : null);
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

// GET /api/inbox/dms — mensagens diretas (requer instagram_manage_messages)
/**
 * POST /api/inbox/suggest-reply — rascunho de resposta no tom da marca.
 *
 * Devolve texto para o usuario revisar. NAO envia nada: resposta automatica
 * em rede social erra em publico, e o estrago e maior que o tempo poupado.
 */
const sugestaoSchema = z.object({
  comentario: z.string().min(1).max(2000),
  autor: z.string().max(80).optional(),
  brandId: z.string().uuid().optional(),
});

router.post('/suggest-reply', validate(sugestaoSchema), async (req: AuthRequest, res: Response) => {
  try {
    const userId = await resolveOwnerId(req.userId!);
    const s = await sugerirResposta(userId, req.body);
    res.json({ success: true, data: s });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Falha ao sugerir resposta' });
  }
});

/**
 * POST /api/inbox/hide — oculta ou reexibe um comentario.
 * Ocultar e reversivel e discreto: so quem escreveu continua vendo.
 */
const hideSchema = z.object({ commentId: z.string().min(1), hide: z.boolean() });
router.post('/hide', validate(hideSchema), async (req: AuthRequest, res: Response) => {
  try {
    const userId = await resolveOwnerId(req.userId!);
    await setCommentHidden(userId, req.body.commentId, req.body.hide);
    res.json({ success: true, data: { hidden: req.body.hide } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Falha ao ocultar comentario' });
  }
});

/** DELETE /api/inbox/comment/:id — apaga de vez. Nao tem volta. */
router.delete('/comment/:id', async (req: AuthRequest, res: Response) => {
  try {
    const userId = await resolveOwnerId(req.userId!);
    await deleteComment(userId, String(req.params.id));
    res.json({ success: true, data: { deleted: true } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Falha ao apagar comentario' });
  }
});

/** POST /api/inbox/comments-enabled — liga/desliga comentarios de um post. */
const enabledSchema = z.object({ mediaId: z.string().min(1), enabled: z.boolean() });
router.post('/comments-enabled', validate(enabledSchema), async (req: AuthRequest, res: Response) => {
  try {
    const userId = await resolveOwnerId(req.userId!);
    await setCommentsEnabled(userId, req.body.mediaId, req.body.enabled);
    res.json({ success: true, data: { enabled: req.body.enabled } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Falha ao alterar comentarios' });
  }
});

router.get('/dms', async (req: AuthRequest, res: Response) => {
  try {
    const ownerId = await resolveOwnerId(req.userId!);
    const data = await getDMs(ownerId, req.query.brandId ? String(req.query.brandId) : null);
    res.json({ success: true, data });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Falha ao carregar DMs' });
  }
});

// POST /api/inbox/dm-reply — responde uma DM
const dmReplySchema = z.object({ recipientId: z.string().min(1), message: z.string().min(1).max(1000) });
router.post('/dm-reply', validate(dmReplySchema), async (req: AuthRequest, res: Response) => {
  try {
    const ownerId = await resolveOwnerId(req.userId!);
    const data = await replyDM(ownerId, req.body.recipientId, req.body.message);
    res.json({ success: true, data });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err?.message || 'Falha ao enviar' });
  }
});

export default router;
