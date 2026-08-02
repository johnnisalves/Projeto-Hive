import { Router, Response } from 'express';
import { z } from 'zod';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate';
import { resolveOwnerId } from '../helpers/resolveOwnerId';
import { prisma } from '../config/database';
import {
  consultarPerfil, atualizarConcorrente, delta, MAX_CONCORRENTES,
} from '../services/competitors.service';

const router = Router();
router.use(authMiddleware);

/** Acrescenta a variacao calculada, para a tela nao ter que fazer conta. */
function comVariacao(c: any) {
  return {
    ...c,
    deltaFollowers: delta(c.followers, c.prevFollowers),
    deltaMedia: delta(c.mediaCount, c.prevMediaCount),
  };
}

/** GET /api/competitors — lista os perfis acompanhados. */
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const userId = await resolveOwnerId(req.userId!);
    const items = await prisma.competitor.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ success: true, data: { items: items.map(comVariacao), max: MAX_CONCORRENTES } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Falha ao listar' });
  }
});

/** POST /api/competitors — acrescenta um perfil e ja busca os dados. */
const novoSchema = z.object({
  username: z.string().min(2).max(30),
  brandId: z.string().uuid().optional(),
});

router.post('/', validate(novoSchema), async (req: AuthRequest, res: Response) => {
  try {
    const userId = await resolveOwnerId(req.userId!);
    const username = req.body.username.trim().replace(/^@/, '').toLowerCase();

    const total = await prisma.competitor.count({ where: { userId } });
    if (total >= MAX_CONCORRENTES) {
      res.status(400).json({ success: false, error: `Limite de ${MAX_CONCORRENTES} perfis. Remova um para adicionar outro.` });
      return;
    }

    // Consulta ANTES de gravar: assim um @ inexistente nao entra na lista
    // e o usuario ve o erro na hora, em vez de um card vazio para sempre.
    const m = await consultarPerfil(userId, username);

    const c = await prisma.competitor.create({
      data: {
        userId,
        username: m.username,
        displayName: m.displayName,
        followers: m.followers,
        mediaCount: m.mediaCount,
        postsLast30: m.postsLast30,
        avgLikes: m.avgLikes,
        lastCheckedAt: new Date(),
        brandId: req.body.brandId || null,
      },
    });
    res.status(201).json({ success: true, data: comVariacao(c) });
  } catch (err: any) {
    // Erro de unicidade quando o perfil ja esta na lista.
    if (err?.code === 'P2002') {
      res.status(400).json({ success: false, error: 'Esse perfil já está no seu radar.' });
      return;
    }
    res.status(400).json({ success: false, error: err?.message || 'Falha ao adicionar' });
  }
});

/** POST /api/competitors/:id/refresh — atualiza os numeros. */
router.post('/:id/refresh', async (req: AuthRequest, res: Response) => {
  try {
    const userId = await resolveOwnerId(req.userId!);
    const c = await atualizarConcorrente(userId, String(req.params.id));
    res.json({ success: true, data: comVariacao(c) });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Falha ao atualizar' });
  }
});

/** DELETE /api/competitors/:id */
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const userId = await resolveOwnerId(req.userId!);
    await prisma.competitor.deleteMany({ where: { id: String(req.params.id), userId } });
    res.json({ success: true, data: { deleted: true } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Falha ao remover' });
  }
});

export default router;
