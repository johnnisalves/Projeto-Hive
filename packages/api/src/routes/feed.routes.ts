import { Router, Response } from 'express';
import { prisma } from '../config/database';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware';
import { resolveOwnerId } from '../helpers/resolveOwnerId';
import { previsaoDeHoje, avaliarPrevisao, pautaPara, podeDisparar } from '../services/weather.service';

/**
 * Preview do feed e gatilhos de contexto local.
 */

const router = Router();
router.use(authMiddleware);

/**
 * GET /api/feed/grid — como o perfil vai ficar.
 *
 * Mistura o que ja esta publicado (buscado no Instagram) com o que esta
 * agendado, na ordem em que aparecera no feed. E o recurso que todo social
 * media pede antes de trocar de ferramenta.
 *
 * Os agendados vem PRIMEIRO porque o Instagram poe o mais novo no topo — e
 * o post de amanha vai empurrar o de hoje para baixo.
 */
router.get('/grid', async (req: AuthRequest, res: Response) => {
  try {
    const ownerId = await resolveOwnerId(req.userId!);
    const brandId = req.query.brandId ? String(req.query.brandId) : undefined;

    const agendados = await prisma.post.findMany({
      where: {
        userId: ownerId,
        status: { in: ['SCHEDULED', 'DRAFT'] },
        scheduledAt: { not: null },
        ...(brandId ? { brandId } : {}),
      },
      orderBy: { scheduledAt: 'desc' },
      take: 18,
      select: { id: true, imageUrl: true, caption: true, scheduledAt: true, publishMode: true, status: true },
    });

    // Publicados: tentamos o Instagram para pegar TAMBEM o que foi postado
    // fora do DisparaAI — sem isso o grid mentiria, mostrando buracos onde
    // na verdade tem post.
    let publicados: any[] = [];
    let aviso: string | undefined;

    const conta = await prisma.instagramToken.findFirst({
      where: { userId: ownerId },
      orderBy: { isDefault: 'desc' },
    });

    if (conta) {
      const base = conta.accessToken.startsWith('EAA')
        ? 'https://graph.facebook.com/v21.0'
        : 'https://graph.instagram.com/v21.0';
      // No Login do Instagram o proprio id nao serve como caminho; o alias
      // "me" e o que funciona nos dois modos.
      const uid = conta.accessToken.startsWith('EAA') ? conta.instagramUserId : 'me';
      try {
        const r = await fetch(
          `${base}/${uid}/media?fields=id,media_type,media_url,thumbnail_url,permalink,timestamp,caption&limit=18&access_token=${conta.accessToken}`,
        );
        const j = (await r.json()) as any;
        if (j?.error) aviso = j.error.message;
        else {
          publicados = (j.data || []).map((m: any) => ({
            id: m.id,
            imageUrl: m.thumbnail_url || m.media_url,
            caption: (m.caption || '').slice(0, 80),
            permalink: m.permalink,
            timestamp: m.timestamp,
            publicado: true,
          }));
        }
      } catch (e: any) {
        aviso = e?.message;
      }
    } else {
      aviso = 'Conecte uma conta do Instagram para ver os posts já publicados no grid.';
    }

    // Se o Instagram nao respondeu, cai para o que temos no banco: um grid
    // parcial e mais util que um grid vazio.
    if (publicados.length === 0) {
      const doBanco = await prisma.post.findMany({
        where: { userId: ownerId, status: 'PUBLISHED', ...(brandId ? { brandId } : {}) },
        orderBy: { publishedAt: 'desc' },
        take: 18,
        select: { id: true, imageUrl: true, caption: true, publishedAt: true },
      });
      publicados = doBanco.map((p) => ({
        id: p.id,
        imageUrl: p.imageUrl,
        caption: (p.caption || '').slice(0, 80),
        timestamp: p.publishedAt,
        publicado: true,
      }));
    }

    res.json({
      success: true,
      data: {
        agendados: agendados.map((p) => ({
          id: p.id,
          imageUrl: p.imageUrl,
          caption: (p.caption || '').slice(0, 80),
          scheduledAt: p.scheduledAt,
          publishMode: p.publishMode,
          publicado: false,
        })),
        publicados,
        aviso,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Falha ao montar o grid' });
  }
});

/**
 * GET /api/feed/clima?brandId=... — a previsao recomenda algum post hoje?
 *
 * So consulta; nao publica nada sozinho. Quem decide e o usuario, e a trava
 * de frequencia impede o perfil de virar disco riscado em semana de chuva.
 */
router.get('/clima', async (req: AuthRequest, res: Response) => {
  try {
    const ownerId = await resolveOwnerId(req.userId!);
    const brand = await prisma.brand.findFirst({
      where: { id: String(req.query.brandId || ''), userId: ownerId },
    });

    const cidade = brand?.cidade || brand?.pixCity;
    if (!cidade) {
      res.json({
        success: true,
        data: { condicao: null, motivo: 'Cadastre a cidade da marca em Empresas para ativar o gatilho de clima.' },
      });
      return;
    }

    const previsao = await previsaoDeHoje(cidade);
    if (!previsao) {
      res.json({ success: true, data: { condicao: null, motivo: `Não encontrei a previsão para ${cidade}.` } });
      return;
    }

    const { condicao, detalhe } = avaliarPrevisao(previsao.horas);

    // A trava mora num Setting por marca e condicao: assim chuva e frio tem
    // contadores separados e um nao bloqueia o outro.
    const chave = `CLIMA_${brand!.id}_${condicao || 'nenhum'}`;
    const ultimo = condicao
      ? await prisma.setting.findUnique({ where: { userId_key: { userId: ownerId, key: chave } } }).catch(() => null)
      : null;
    const liberado = condicao ? podeDisparar(ultimo?.value ? new Date(Number(ultimo.value)) : null) : false;

    res.json({
      success: true,
      data: {
        cidade: previsao.nome,
        condicao,
        detalhe,
        liberado,
        pauta: liberado ? pautaPara(condicao, previsao.nome) : null,
        motivo: condicao && !liberado ? 'Você já postou sobre isso nos últimos dias.' : undefined,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Falha ao consultar o clima' });
  }
});

/** POST /api/feed/clima/usado — marca que a pauta virou post, ligando a trava. */
router.post('/clima/usado', async (req: AuthRequest, res: Response) => {
  try {
    const ownerId = await resolveOwnerId(req.userId!);
    const chave = `CLIMA_${String(req.body?.brandId)}_${String(req.body?.condicao)}`;
    await prisma.setting.upsert({
      where: { userId_key: { userId: ownerId, key: chave } },
      create: { userId: ownerId, key: chave, value: String(Date.now()) },
      update: { value: String(Date.now()) },
    });
    res.json({ success: true, data: { ok: true } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Falha ao registrar' });
  }
});

export default router;
