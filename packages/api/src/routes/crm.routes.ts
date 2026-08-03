import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../config/database';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate';
import { resolveOwnerId } from '../helpers/resolveOwnerId';
import {
  ETAPAS, ROTULOS, podeMover, exigeValor, resumoDoFunil, receitaPorPost, esquecidos, Etapa,
} from '../services/crm.service';

const router = Router();
router.use(authMiddleware);

/** GET /api/crm — o funil inteiro, com resumo e leads esquecidos. */
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const ownerId = await resolveOwnerId(req.userId!);
    const brandId = req.query.brandId ? String(req.query.brandId) : undefined;

    const leads = await prisma.lead.findMany({
      where: { userId: ownerId, ...(brandId ? { brandId } : {}) },
      orderBy: { updatedAt: 'desc' },
      take: 300,
    });

    const paraServico = leads.map((l) => ({
      etapa: l.etapa as Etapa,
      valorCentavos: l.valorCentavos,
      postId: l.postId,
      criadoEm: l.createdAt,
      fechadoEm: l.fechadoEm,
      atualizadoEm: l.updatedAt,
    }));

    res.json({
      success: true,
      data: {
        items: leads.map((l) => ({
          id: l.id,
          etapa: l.etapa,
          contato: l.contato,
          origem: l.origem,
          mensagem: l.mensagem,
          valorCentavos: l.valorCentavos,
          observacao: l.observacao,
          postId: l.postId,
          atualizadoEm: l.updatedAt,
        })),
        resumo: resumoDoFunil(paraServico),
        porPost: receitaPorPost(paraServico).slice(0, 10),
        esquecidos: esquecidos(paraServico).length,
        etapas: ETAPAS.map((e) => ({ chave: e, rotulo: ROTULOS[e] })),
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Falha ao carregar o funil' });
  }
});

const criarSchema = z.object({
  contato: z.string().max(120).optional(),
  mensagem: z.string().max(2000).optional(),
  origem: z.string().max(30).optional(),
  postId: z.string().optional(),
  brandId: z.string().optional(),
});

router.post('/', validate(criarSchema), async (req: AuthRequest, res: Response) => {
  try {
    const ownerId = await resolveOwnerId(req.userId!);
    const lead = await prisma.lead.create({
      data: {
        userId: ownerId,
        contato: req.body.contato || null,
        mensagem: req.body.mensagem || null,
        origem: (req.body.origem || 'DIRECT').toUpperCase(),
        postId: req.body.postId || null,
        brandId: req.body.brandId || null,
      },
    });
    res.json({ success: true, data: lead });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Falha ao criar lead' });
  }
});

/**
 * PATCH /api/crm/:id — move o lead de etapa.
 *
 * Fechar EXIGE valor. Um lead "fechado" sem valor destroi o unico numero
 * que o funil existe para produzir, e depois ninguem lembra quanto foi.
 */
const moverSchema = z.object({
  etapa: z.enum(ETAPAS),
  valorCentavos: z.number().int().min(0).optional(),
  observacao: z.string().max(500).optional(),
});

router.patch('/:id', validate(moverSchema), async (req: AuthRequest, res: Response) => {
  try {
    const ownerId = await resolveOwnerId(req.userId!);
    const lead = await prisma.lead.findFirst({ where: { id: String(req.params.id), userId: ownerId } });
    if (!lead) { res.status(404).json({ success: false, error: 'Lead não encontrado' }); return; }

    const nova = req.body.etapa as Etapa;
    if (!podeMover(lead.etapa as Etapa, nova)) {
      res.status(400).json({ success: false, error: 'Esse lead já está nessa etapa.' });
      return;
    }

    // O valor pode vir agora ou ja estar no lead de uma passagem anterior.
    const valor = req.body.valorCentavos ?? lead.valorCentavos;
    if (exigeValor(nova) && (valor === null || valor === undefined)) {
      res.status(400).json({ success: false, error: 'Informe o valor da venda para marcar como fechado.' });
      return;
    }

    const atualizado = await prisma.lead.update({
      where: { id: lead.id },
      data: {
        etapa: nova,
        valorCentavos: valor ?? null,
        observacao: req.body.observacao ?? lead.observacao,
        // Reabrir um lead limpa a data de fechamento, senao o relatorio
        // contaria uma venda que voltou a ser negociacao.
        fechadoEm: nova === 'fechado' ? new Date() : null,
      },
    });

    res.json({ success: true, data: atualizado });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Falha ao mover o lead' });
  }
});

router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const ownerId = await resolveOwnerId(req.userId!);
    await prisma.lead.deleteMany({ where: { id: String(req.params.id), userId: ownerId } });
    res.json({ success: true, data: { deleted: true } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Falha ao remover' });
  }
});

export default router;
