import { Router, Response } from 'express';
import { prisma } from '../config/database';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware';
import { resolveOwnerId } from '../helpers/resolveOwnerId';
import {
  podeProduzir, ordenarPorUrgencia, separarPorTeto, progresso, oQueFalta,
  STATUS_PRODUZIVEL, MAX_POR_PEDIDO, PostParaProduzir,
} from '../services/production.service';
import { enfileirarProducao, filaProducao } from '../jobs/production.worker';

/**
 * Producao de conteudo: transforma rascunho vazio em post pronto.
 *
 * E o que faz a promessa do piloto automatico virar verdade — sem isto,
 * "30 posts planejados" significa 30 telas em branco para o usuario
 * preencher.
 */

const router = Router();
router.use(authMiddleware);

/** Rascunhos do dono que ainda precisam de trabalho. */
async function pendentes(ownerId: string, brandId?: string) {
  const posts = await prisma.post.findMany({
    where: {
      userId: ownerId,
      ...(brandId ? { brandId } : {}),
      status: { in: STATUS_PRODUZIVEL as any },
    },
    orderBy: { scheduledAt: 'asc' },
    take: 300,
    select: {
      id: true, caption: true, imageUrl: true, videoUrl: true,
      nanoPrompt: true, scheduledAt: true, status: true, brandId: true,
    },
  });
  return posts as unknown as Array<PostParaProduzir & { brandId: string | null }>;
}

/** GET /api/producao — quanto falta, e o que a fila esta fazendo. */
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const ownerId = await resolveOwnerId(req.userId!);
    const brandId = req.query.brandId ? String(req.query.brandId) : undefined;

    const posts = await pendentes(ownerId, brandId);
    const naFila = posts.filter(podeProduzir);

    const [aguardando, rodando] = await Promise.all([
      filaProducao.getWaitingCount().catch(() => 0),
      filaProducao.getActiveCount().catch(() => 0),
    ]);

    res.json({
      success: true,
      data: {
        ...progresso(posts),
        // Quantos DAO para produzir agora: post sem tema nenhum nao entra,
        // e mostrar ele como "pendente" faria o numero nunca zerar.
        produziveis: naFila.length,
        naFila: aguardando + rodando,
        teto: MAX_POR_PEDIDO,
        items: ordenarPorUrgencia(naFila).slice(0, 20).map((p) => ({
          id: p.id,
          falta: oQueFalta(p),
          scheduledAt: p.scheduledAt,
        })),
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Falha ao ler a produção' });
  }
});

/**
 * POST /api/producao/enfileirar — manda produzir.
 *
 * A ordem e por urgencia: o que publica antes fica pronto antes. Se so
 * metade terminar a tempo, e a metade que voce precisava.
 */
router.post('/enfileirar', async (req: AuthRequest, res: Response) => {
  try {
    const ownerId = await resolveOwnerId(req.userId!);
    const brandId = req.body?.brandId ? String(req.body.brandId) : undefined;
    const ids: string[] | undefined = Array.isArray(req.body?.postIds) ? req.body.postIds : undefined;

    let candidatos = (await pendentes(ownerId, brandId)).filter(podeProduzir);
    if (ids?.length) candidatos = candidatos.filter((p) => ids.includes(p.id));

    if (candidatos.length === 0) {
      res.json({ success: true, data: { enfileirados: 0, sobraram: 0, motivo: 'Nada pendente para produzir.' } });
      return;
    }

    const { entram, sobram } = separarPorTeto(ordenarPorUrgencia(candidatos));
    const enfileirados = await enfileirarProducao(entram.map((p) => ({ postId: p.id, userId: ownerId })));

    res.json({
      success: true,
      data: {
        enfileirados,
        sobraram: sobram.length,
        // Devolver o que ficou de fora e obrigatorio: cortar em silencio
        // faria o usuario achar que tudo entrou e so descobrir depois.
        motivo: sobram.length
          ? `Enfileirei ${enfileirados}. Outros ${sobram.length} ficaram para o próximo lote.`
          : undefined,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Falha ao enfileirar' });
  }
});

export default router;
