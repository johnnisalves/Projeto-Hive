import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../config/database';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate';
import { resolveOwnerId } from '../helpers/resolveOwnerId';
import {
  gerarCodigoCupom,
  gerarCodigoCurto,
  montarLinkWhatsapp,
  motivoRecusa,
  consolidarReceita,
  calcularRoi,
  registrarClique,
  linkDoPost,
  ORIGENS_DE_SOCIAL,
} from '../services/attribution.service';
import { gerarPixCopiaECola } from '../services/pix.service';

/**
 * Atribuicao: ligar post a dinheiro no caixa.
 *
 * O redirect (/r/:code) e o resgate de cupom sao PUBLICOS — quem clica no
 * post e quem esta no balcao nao tem login. Todo o resto exige autenticacao.
 */

const router = Router();

// ---------------------------------------------------------------------------
// Publico
// ---------------------------------------------------------------------------

/**
 * GET /api/vendas/r/:code — redirect que conta o clique.
 *
 * Nunca pode falhar para quem clicou: se a contagem der errado, a pessoa
 * ainda assim vai para o destino. Perder um clique de metrica e aceitavel;
 * perder um cliente nao.
 */
router.get('/r/:code', async (req: Request, res: Response) => {
  const destino = await registrarClique(String(req.params.code)).catch(() => null);
  if (!destino) { res.status(404).send('Link não encontrado'); return; }
  res.redirect(302, destino);
});

/** GET /api/vendas/cupom/:code — o que o balcao ve antes de resgatar. */
router.get('/cupom/:code', async (req: Request, res: Response) => {
  const code = String(req.params.code).toUpperCase();
  const cupom = await prisma.coupon.findFirst({ where: { code } }).catch(() => null);
  if (!cupom) { res.status(404).json({ success: false, error: 'Cupom não encontrado' }); return; }

  const recusa = motivoRecusa(
    { expiresAt: cupom.expiresAt, maxUsos: cupom.maxUsos, usos: cupom.usos, ativo: cupom.ativo },
  );
  res.json({
    success: true,
    data: { code: cupom.code, descricao: cupom.descricao, usos: cupom.usos, maxUsos: cupom.maxUsos, recusa },
  });
});

/**
 * POST /api/vendas/cupom/:code/resgatar — o caixa registra a venda.
 *
 * A checagem e o incremento ficam numa transacao: sem isso, dois caixas
 * resgatando ao mesmo tempo passariam os dois do limite.
 */
router.post('/cupom/:code/resgatar', async (req: Request, res: Response) => {
  const code = String(req.params.code).toUpperCase();
  const valorCentavos = Math.max(0, Math.round(Number(req.body?.valorCentavos) || 0));

  try {
    const r = await prisma.$transaction(async (tx) => {
      const cupom = await tx.coupon.findFirst({ where: { code } });
      if (!cupom) return { erro: 'Cupom não encontrado' };

      const recusa = motivoRecusa(
        { expiresAt: cupom.expiresAt, maxUsos: cupom.maxUsos, usos: cupom.usos, ativo: cupom.ativo },
      );
      if (recusa) return { erro: recusa };

      await tx.couponRedemption.create({
        data: { couponId: cupom.id, valorCentavos, observacao: String(req.body?.observacao || '').slice(0, 200) || null },
      });
      await tx.coupon.update({ where: { id: cupom.id }, data: { usos: { increment: 1 } } });
      return { ok: true, usos: cupom.usos + 1 };
    });

    if (r.erro) { res.status(400).json({ success: false, error: r.erro }); return; }
    res.json({ success: true, data: r });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Falha ao resgatar' });
  }
});

// ---------------------------------------------------------------------------
// Autenticado
// ---------------------------------------------------------------------------
router.use(authMiddleware);

const cupomSchema = z.object({
  descricao: z.string().max(120).optional(),
  postId: z.string().optional(),
  brandId: z.string().optional(),
  maxUsos: z.number().int().min(0).optional(),
  diasValidade: z.number().int().min(1).max(365).optional(),
});

/** POST /api/vendas/cupons — cria o cupom de um post. */
router.post('/cupons', validate(cupomSchema), async (req: AuthRequest, res: Response) => {
  try {
    const ownerId = await resolveOwnerId(req.userId!);
    const brand = req.body.brandId
      ? await prisma.brand.findFirst({ where: { id: req.body.brandId, userId: ownerId } })
      : null;

    const expiresAt = req.body.diasValidade
      ? new Date(Date.now() + req.body.diasValidade * 86_400_000)
      : null;

    // Codigo repetido e possivel (o sufixo e sorteado): tentamos algumas
    // vezes em vez de devolver erro na cara do usuario.
    for (let i = 0; i < 5; i++) {
      try {
        const cupom = await prisma.coupon.create({
          data: {
            code: gerarCodigoCupom(brand?.name || 'PROMO'),
            descricao: req.body.descricao || null,
            postId: req.body.postId || null,
            brandId: req.body.brandId || null,
            maxUsos: req.body.maxUsos ?? null,
            expiresAt,
            userId: ownerId,
          },
        });
        res.json({ success: true, data: cupom });
        return;
      } catch { /* codigo repetido: sorteia outro */ }
    }
    res.status(500).json({ success: false, error: 'Não consegui gerar um código. Tente de novo.' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Falha ao criar cupom' });
  }
});

/** GET /api/vendas/cupons — lista com o que cada um já rendeu. */
router.get('/cupons', async (req: AuthRequest, res: Response) => {
  try {
    const ownerId = await resolveOwnerId(req.userId!);
    const cupons = await prisma.coupon.findMany({
      where: { userId: ownerId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { resgates: { select: { valorCentavos: true } } },
    });

    res.json({
      success: true,
      data: cupons.map((c) => ({
        id: c.id,
        code: c.code,
        descricao: c.descricao,
        usos: c.usos,
        maxUsos: c.maxUsos,
        ativo: c.ativo,
        expiresAt: c.expiresAt,
        postId: c.postId,
        receitaCentavos: c.resgates.reduce((s, r) => s + r.valorCentavos, 0),
      })),
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Falha ao listar cupons' });
  }
});

router.patch('/cupons/:id', async (req: AuthRequest, res: Response) => {
  try {
    const ownerId = await resolveOwnerId(req.userId!);
    const r = await prisma.coupon.updateMany({
      where: { id: String(req.params.id), userId: ownerId },
      data: { ativo: Boolean(req.body?.ativo) },
    });
    if (r.count === 0) { res.status(404).json({ success: false, error: 'Cupom não encontrado' }); return; }
    res.json({ success: true, data: { ativo: Boolean(req.body?.ativo) } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Falha ao atualizar' });
  }
});

/**
 * POST /api/vendas/balcao — modo balcao: origem da venda em dois toques.
 * E o degrau zero da atribuicao: funciona em qualquer comercio no dia seguinte.
 */
const balcaoSchema = z.object({
  origem: z.string().min(2).max(30),
  valorCentavos: z.number().int().min(0).optional(),
  brandId: z.string().optional(),
});

router.post('/balcao', validate(balcaoSchema), async (req: AuthRequest, res: Response) => {
  try {
    const ownerId = await resolveOwnerId(req.userId!);
    const v = await prisma.saleOrigin.create({
      data: {
        origem: String(req.body.origem).toUpperCase(),
        valorCentavos: req.body.valorCentavos ?? null,
        brandId: req.body.brandId || null,
        userId: ownerId,
      },
    });
    res.json({ success: true, data: v });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Falha ao registrar venda' });
  }
});

/**
 * GET /api/vendas/resumo?dias=30 — o numero que responde "isso me da cliente?".
 */
router.get('/resumo', async (req: AuthRequest, res: Response) => {
  try {
    const ownerId = await resolveOwnerId(req.userId!);
    const dias = Math.min(365, Math.max(1, Number(req.query.dias) || 30));
    const desde = new Date(Date.now() - dias * 86_400_000);
    const brandId = req.query.brandId ? String(req.query.brandId) : undefined;

    const [cupons, balcao, links, brand] = await Promise.all([
      prisma.couponRedemption.findMany({
        where: { createdAt: { gte: desde }, coupon: { userId: ownerId, ...(brandId ? { brandId } : {}) } },
        select: { valorCentavos: true },
      }),
      prisma.saleOrigin.findMany({
        where: { userId: ownerId, createdAt: { gte: desde }, ...(brandId ? { brandId } : {}) },
        select: { valorCentavos: true, origem: true },
      }),
      prisma.shortLink.findMany({
        where: { userId: ownerId, ...(brandId ? { brandId } : {}) },
        select: { code: true, clicks: true, postId: true },
        orderBy: { clicks: 'desc' },
        take: 20,
      }),
      brandId ? prisma.brand.findFirst({ where: { id: brandId, userId: ownerId } }) : null,
    ]);

    const receita = consolidarReceita({ cupons, balcao });
    const cliques = links.reduce((s, l) => s + l.clicks, 0);

    res.json({
      success: true,
      data: {
        dias,
        ...receita,
        cliques,
        topLinks: links.slice(0, 10),
        roi: calcularRoi(receita.totalCentavos, brand?.feeCentavos),
        feeCentavos: brand?.feeCentavos ?? null,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Falha ao montar resumo' });
  }
});

/**
 * POST /api/vendas/link-do-post — botao "Pedir no Zap" rastreavel.
 *
 * Devolve o link curto que conta o clique e leva ao WhatsApp da marca com a
 * mensagem ja preenchida carregando o codigo do post.
 */
router.post('/link-do-post', async (req: AuthRequest, res: Response) => {
  try {
    const ownerId = await resolveOwnerId(req.userId!);
    const postId = String(req.body?.postId || '');
    if (!postId) { res.status(400).json({ success: false, error: 'Informe o post' }); return; }

    const post = await prisma.post.findFirst({ where: { id: postId, userId: ownerId }, include: { brand: true } });
    if (!post) { res.status(404).json({ success: false, error: 'Post não encontrado' }); return; }

    const telefone = post.brand?.whatsappPhone || '';
    if (!telefone) {
      res.status(400).json({
        success: false,
        error: 'Cadastre o WhatsApp da marca em Empresas para gerar o botão de pedido.',
      });
      return;
    }

    const codigo = gerarCodigoCurto(6);
    const destino = montarLinkWhatsapp(
      telefone,
      String(req.body?.mensagem || 'Oi! Vi no Instagram e quero pedir'),
      codigo,
    );
    if (!destino) {
      res.status(400).json({ success: false, error: 'O WhatsApp da marca está em formato inválido. Use DDD + número.' });
      return;
    }

    const link = await linkDoPost(ownerId, postId, destino);
    const base = process.env.PUBLIC_URL || 'https://disparaai.digitalcrm.com.br';
    res.json({ success: true, data: { code: link.code, url: `${base}/api/vendas/r/${link.code}`, destino } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Falha ao gerar link' });
  }
});

/**
 * POST /api/vendas/pix — codigo copia e cola da marca.
 * Gerado aqui pela spec EMV: sem banco, sem PSP, sem chave de API.
 */
router.post('/pix', async (req: AuthRequest, res: Response) => {
  try {
    const ownerId = await resolveOwnerId(req.userId!);
    const brand = await prisma.brand.findFirst({ where: { id: String(req.body?.brandId || ''), userId: ownerId } });
    if (!brand) { res.status(404).json({ success: false, error: 'Marca não encontrada' }); return; }
    if (!brand.pixKey) {
      res.status(400).json({ success: false, error: 'Cadastre a chave PIX da marca em Empresas.' });
      return;
    }

    const payload = gerarPixCopiaECola({
      chave: brand.pixKey,
      nome: brand.name,
      cidade: brand.pixCity || brand.cidade || 'BRASIL',
      valor: Number(req.body?.valor) || null,
      txid: req.body?.txid || null,
    });
    res.json({ success: true, data: { payload } });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err?.message || 'Falha ao gerar PIX' });
  }
});

/** GET /api/vendas/origens — as opcoes do modo balcao. */
router.get('/origens', (_req: AuthRequest, res: Response) => {
  res.json({
    success: true,
    data: {
      // A ordem e a da tela: as de social primeiro, porque sao as mais
      // tocadas e as que alimentam o ROI.
      opcoes: [...ORIGENS_DE_SOCIAL, 'PASSOU_NA_FRENTE', 'INDICACAO', 'OUTRO'],
      contamNoRoi: ORIGENS_DE_SOCIAL,
    },
  });
});

export default router;
