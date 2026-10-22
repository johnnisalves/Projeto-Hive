import { Router, Response } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate';
import { prisma } from '../config/database';
import { gerarTokenPessoal, hashTokenPessoal, prefixoVisivel } from '../services/api-token.service';

const router = Router();
router.use(authMiddleware);

const db = () => prisma as any;

// Gerenciar tokens exige login de verdade: um token vazado nao pode criar
// outros tokens nem revogar os do dono.
router.use((req: AuthRequest, res: Response, next) => {
  if (req.authVia !== 'jwt') {
    res.status(403).json({ success: false, error: 'Entre pelo site para gerenciar tokens de API' });
    return;
  }
  next();
});

const CAMPOS = { id: true, name: true, prefix: true, createdAt: true, lastUsedAt: true, revokedAt: true };

// GET /api/api-tokens — lista sem o segredo
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const items = await db().apiToken.findMany({
      where: { userId: req.userId },
      select: CAMPOS,
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: { items } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Falha ao listar tokens' });
  }
});

const criarSchema = z.object({ name: z.string().trim().min(1).max(60) });

// POST /api/api-tokens — o token so aparece nesta resposta
router.post('/', validate(criarSchema), async (req: AuthRequest, res: Response) => {
  try {
    const token = gerarTokenPessoal();
    const criado = await db().apiToken.create({
      data: {
        id: crypto.randomUUID(),
        name: req.body.name,
        prefix: prefixoVisivel(token),
        tokenHash: hashTokenPessoal(token),
        userId: req.userId,
      },
      select: CAMPOS,
    });
    res.status(201).json({ success: true, data: { ...criado, token } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Falha ao gerar token' });
  }
});

// DELETE /api/api-tokens/:id — revoga (deixa de valer na hora)
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const r = await db().apiToken.updateMany({
      where: { id: String(req.params.id), userId: req.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (r.count === 0) {
      res.status(404).json({ success: false, error: 'Token nao encontrado' });
      return;
    }
    res.json({ success: true, data: { revoked: true } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Falha ao revogar token' });
  }
});

export default router;
