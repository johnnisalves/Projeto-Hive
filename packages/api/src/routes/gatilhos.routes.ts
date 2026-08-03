import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../config/database';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate';
import { resolveOwnerId } from '../helpers/resolveOwnerId';
import { normalizarPalavra } from '../services/comment-trigger.service';
import { regrasParaPrompt } from '../services/brand-brain.service';

/**
 * Automacoes que reagem sozinhas:
 * - gatilhos de comentario ("comente EU QUERO que eu te chamo");
 * - regras que a IA aprendeu observando as correcoes da marca;
 * - diario de bordo das decisoes automaticas.
 */

const router = Router();
router.use(authMiddleware);

// ---------------------------------------------------------------------------
// Gatilhos de comentario
// ---------------------------------------------------------------------------

const gatilhoSchema = z.object({
  palavra: z.string().min(2).max(40),
  resposta: z.string().min(2).max(900),
  postId: z.string().optional(),
  brandId: z.string().optional(),
  responderPublico: z.boolean().optional(),
  respostaPublica: z.string().max(300).optional(),
});

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const ownerId = await resolveOwnerId(req.userId!);
    const items = await prisma.commentTrigger.findMany({
      where: { userId: ownerId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json({ success: true, data: { items } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Falha ao listar gatilhos' });
  }
});

router.post('/', validate(gatilhoSchema), async (req: AuthRequest, res: Response) => {
  try {
    const ownerId = await resolveOwnerId(req.userId!);

    // Duas palavras iguais no mesmo alvo fariam uma delas nunca disparar —
    // e o usuario ficaria editando a errada sem entender por que nao muda.
    const palavra = normalizarPalavra(req.body.palavra);
    const conflito = await prisma.commentTrigger.findFirst({
      where: { userId: ownerId, palavra, postId: req.body.postId || null },
    });
    if (conflito) {
      res.status(400).json({ success: false, error: `Já existe um gatilho para "${palavra}" neste alvo.` });
      return;
    }

    const item = await prisma.commentTrigger.create({
      data: {
        palavra,
        resposta: req.body.resposta,
        postId: req.body.postId || null,
        brandId: req.body.brandId || null,
        responderPublico: req.body.responderPublico ?? false,
        respostaPublica: req.body.respostaPublica || null,
        userId: ownerId,
      },
    });
    res.json({ success: true, data: item });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Falha ao criar gatilho' });
  }
});

router.patch('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const ownerId = await resolveOwnerId(req.userId!);
    const r = await prisma.commentTrigger.updateMany({
      where: { id: String(req.params.id), userId: ownerId },
      data: { ativo: Boolean(req.body?.ativo) },
    });
    if (r.count === 0) { res.status(404).json({ success: false, error: 'Gatilho não encontrado' }); return; }
    res.json({ success: true, data: { ativo: Boolean(req.body?.ativo) } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Falha ao atualizar' });
  }
});

router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const ownerId = await resolveOwnerId(req.userId!);
    await prisma.commentTrigger.deleteMany({ where: { id: String(req.params.id), userId: ownerId } });
    res.json({ success: true, data: { deleted: true } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Falha ao remover' });
  }
});

// ---------------------------------------------------------------------------
// Cerebro da marca
// ---------------------------------------------------------------------------

/**
 * GET /api/gatilhos/regras/:brandId — "o que aprendi sobre sua marca".
 *
 * Mostrar isso nao e enfeite: e o que torna a IA auditavel. Sem a tela, o
 * cliente nao tem como saber por que as legendas mudaram de tom.
 */
router.get('/regras/:brandId', async (req: AuthRequest, res: Response) => {
  try {
    const ownerId = await resolveOwnerId(req.userId!);
    const brand = await prisma.brand.findFirst({ where: { id: String(req.params.brandId), userId: ownerId } });
    if (!brand) { res.status(404).json({ success: false, error: 'Marca não encontrada' }); return; }

    const regras = await prisma.brandRule.findMany({
      where: { brandId: brand.id },
      orderBy: [{ ativa: 'desc' }, { peso: 'desc' }],
      take: 60,
    });

    res.json({
      success: true,
      data: {
        items: regras,
        // O prompt real que sai daqui, para o usuario ver exatamente o que a
        // IA recebe — nao uma versao resumida.
        prompt: regrasParaPrompt(regras.filter((r) => r.ativa).map((r) => ({ regra: r.regra, peso: r.peso }))),
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Falha ao carregar regras' });
  }
});

/** PATCH /api/gatilhos/regras/:id — o usuario liga, desliga ou apaga uma regra. */
router.patch('/regras/item/:id', async (req: AuthRequest, res: Response) => {
  try {
    const ownerId = await resolveOwnerId(req.userId!);
    const regra = await prisma.brandRule.findUnique({ where: { id: String(req.params.id) }, include: { brand: true } });
    if (!regra || regra.brand.userId !== ownerId) {
      res.status(404).json({ success: false, error: 'Regra não encontrada' });
      return;
    }
    await prisma.brandRule.update({ where: { id: regra.id }, data: { ativa: Boolean(req.body?.ativa) } });
    res.json({ success: true, data: { ativa: Boolean(req.body?.ativa) } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Falha ao atualizar regra' });
  }
});

/** POST /api/gatilhos/regras/:brandId — o usuario ensina uma regra na mao. */
router.post('/regras/:brandId', async (req: AuthRequest, res: Response) => {
  try {
    const ownerId = await resolveOwnerId(req.userId!);
    const brand = await prisma.brand.findFirst({ where: { id: String(req.params.brandId), userId: ownerId } });
    if (!brand) { res.status(404).json({ success: false, error: 'Marca não encontrada' }); return; }

    const regra = String(req.body?.regra || '').trim().slice(0, 200);
    if (regra.length < 4) { res.status(400).json({ success: false, error: 'Escreva a regra' }); return; }

    // Regra ensinada a mao entra com peso alto: e instrucao direta do dono,
    // vale mais que padrao inferido de uma unica edicao.
    const item = await prisma.brandRule.create({
      data: { brandId: brand.id, regra, origem: 'manual', peso: 5 },
    });
    res.json({ success: true, data: item });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Falha ao salvar regra' });
  }
});

// ---------------------------------------------------------------------------
// Diario de bordo
// ---------------------------------------------------------------------------

/** GET /api/gatilhos/diario — o que o sistema fez sozinho, e por que. */
router.get('/diario/log', async (req: AuthRequest, res: Response) => {
  try {
    const ownerId = await resolveOwnerId(req.userId!);
    const items = await prisma.agentLog.findMany({
      where: { userId: ownerId, ...(req.query.brandId ? { brandId: String(req.query.brandId) } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 120,
    });
    res.json({ success: true, data: { items } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Falha ao carregar o diário' });
  }
});

export default router;
