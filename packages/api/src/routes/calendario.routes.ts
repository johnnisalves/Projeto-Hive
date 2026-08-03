import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../config/database';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate';
import { resolveOwnerId } from '../helpers/resolveOwnerId';
import { callText } from '../services/caption.service';
import { schedulePost } from '../services/scheduler.service';
import { nichoDe } from '../services/niche.service';
import {
  montarCronograma, montarPrompt, lerJson, normalizar,
  gerarCsv, gerarIcs, nomeDoArquivo, nomeDoMes,
  Briefing, PostDoCalendario,
} from '../services/content-calendar.service';

/**
 * Calendario de conteudo do mes.
 *
 * O briefing vira uma grade com DATAS REAIS: o cronograma sai daqui, do
 * codigo, e a IA so preenche o conteudo de cada data.
 *
 * A diferenca para uma ferramenta que so planeja: aqui o calendario pode
 * virar posts agendados de verdade, porque o DisparaAI publica.
 */

const router = Router();
router.use(authMiddleware);

const briefingSchema = z.object({
  nicho: z.string().min(5).max(600),
  publico: z.string().max(300).optional(),
  plataformas: z.array(z.string()).min(1).max(6),
  objetivo: z.string().min(2).max(40),
  tom: z.string().min(2).max(60),
  frequencia: z.enum(['3x', '5x', 'diario', 'personalizado']),
  diasDaSemana: z.array(z.number().int().min(0).max(6)).optional(),
  ano: z.number().int().min(2024).max(2100),
  mes: z.number().int().min(1).max(12),
  pilares: z.array(z.string().max(40)).max(8).optional(),
  brandId: z.string().optional(),
});

/**
 * Teto de posts por geracao.
 *
 * Um mes diario da 31; o limite existe para uma requisicao torta nao pedir
 * um ano inteiro de uma vez e estourar o contexto do modelo no meio,
 * devolvendo JSON cortado.
 */
const MAX_POSTS = 40;

/** POST /api/calendario/gerar — o briefing vira a grade do mes. */
router.post('/gerar', validate(briefingSchema), async (req: AuthRequest, res: Response) => {
  try {
    const ownerId = await resolveOwnerId(req.userId!);
    const b = req.body as Briefing & { brandId?: string };

    const cronograma = montarCronograma(b);
    if (cronograma.length === 0) {
      res.status(400).json({ success: false, error: 'Escolha ao menos um dia da semana.' });
      return;
    }
    if (cronograma.length > MAX_POSTS) {
      res.status(400).json({
        success: false,
        error: `Esse ritmo daria ${cronograma.length} posts no mês. Gere no máximo ${MAX_POSTS} por vez.`,
      });
      return;
    }

    // O ramo da marca entra no prompt: uma clinica nao pode receber
    // sugestao de restaurante (ver niche.service.ts).
    let contexto: string | undefined;
    if (b.brandId) {
      const marca = await prisma.brand.findFirst({
        where: { id: b.brandId, userId: ownerId },
        select: { nicho: true, voiceTone: true, tonePrompt: true },
      });
      if (marca) {
        contexto = [nichoDe(marca.nicho).contextoIA, marca.tonePrompt, marca.voiceTone]
          .filter(Boolean).join(' ');
      }
    }

    const prompt = montarPrompt(b, cronograma, contexto);

    // Uma segunda tentativa com aviso explicito. Desistir na primeira joga
    // fora uma geracao inteira que costuma estar quase boa — e o usuario
    // esperou os mesmos segundos de qualquer jeito.
    let bruto: any;
    try {
      bruto = lerJson(await callText(prompt, undefined, ownerId));
    } catch {
      const insistindo = `${prompt}\n\nATENÇÃO: a resposta anterior não era um JSON válido. `
        + 'Responda APENAS com o objeto JSON completo, sem markdown e sem texto fora do JSON.';
      bruto = lerJson(await callText(insistindo, undefined, ownerId));
    }

    const { pilares, posts } = normalizar(bruto, cronograma, b);
    if (posts.length === 0) {
      res.status(502).json({ success: false, error: 'A IA não devolveu nenhum post. Tente gerar de novo.' });
      return;
    }

    res.json({
      success: true,
      data: {
        mes: b.mes, ano: b.ano, periodo: `${nomeDoMes(b.mes)} de ${b.ano}`,
        pilares, posts,
        // Quantas datas o cronograma tinha: se vier menos post que isso, a
        // tela avisa em vez de deixar o usuario contar na mao.
        datasPrevistas: cronograma.length,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Falha ao gerar o calendário' });
  }
});

/** Reidrata as datas que voltaram da tela como texto ISO. */
function comDatas(posts: any[]): PostDoCalendario[] {
  return (posts || [])
    .map((p) => ({ ...p, data: new Date(p.data), hashtags: Array.isArray(p.hashtags) ? p.hashtags : [] }))
    .filter((p) => !isNaN(p.data.getTime()));
}

/** POST /api/calendario/csv — planilha para Excel, Sheets ou Notion. */
router.post('/csv', async (req: AuthRequest, res: Response) => {
  try {
    const posts = comDatas(req.body?.posts);
    if (!posts.length) { res.status(400).json({ success: false, error: 'Nenhum post para exportar' }); return; }

    const nome = nomeDoArquivo(String(req.body?.nicho || ''), Number(req.body?.mes) || 1, Number(req.body?.ano) || 2026);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${nome}.csv"`);
    res.send(gerarCsv(posts));
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Falha ao gerar o CSV' });
  }
});

/** POST /api/calendario/ics — agenda para Google, Apple ou Outlook. */
router.post('/ics', async (req: AuthRequest, res: Response) => {
  try {
    const posts = comDatas(req.body?.posts);
    if (!posts.length) { res.status(400).json({ success: false, error: 'Nenhum post para exportar' }); return; }

    const mes = Number(req.body?.mes) || 1;
    const ano = Number(req.body?.ano) || 2026;
    const nome = nomeDoArquivo(String(req.body?.nicho || ''), mes, ano);

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${nome}.ics"`);
    res.send(gerarIcs(posts, `Conteúdo · ${nomeDoMes(mes)} de ${ano}`));
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Falha ao gerar o ICS' });
  }
});

/**
 * POST /api/calendario/agendar — o calendario vira posts de verdade.
 *
 * E o que a planilha nao faz: cada linha da grade entra na fila como
 * rascunho agendado, na data e hora que a IA sugeriu, ja com legenda,
 * hashtags e a marca certa.
 *
 * Entram como DRAFT, nao SCHEDULED: agendar 20 posts sem arte nenhuma e
 * enfileirar 20 falhas de publicacao. O usuario revisa, poe a imagem e
 * confirma.
 */
router.post('/agendar', async (req: AuthRequest, res: Response) => {
  try {
    const ownerId = await resolveOwnerId(req.userId!);
    const posts = comDatas(req.body?.posts);
    if (!posts.length) { res.status(400).json({ success: false, error: 'Nenhum post para agendar' }); return; }

    const brandId = req.body?.brandId ? String(req.body.brandId) : null;
    if (brandId) {
      const marca = await prisma.brand.findFirst({ where: { id: brandId, userId: ownerId } });
      if (!marca) { res.status(404).json({ success: false, error: 'Empresa não encontrada' }); return; }
    }

    const criados: string[] = [];
    const falhas: Array<{ data: string; erro: string }> = [];

    for (const p of posts) {
      try {
        const [h, m] = p.horario.split(':').map(Number);
        const quando = new Date(p.data);
        quando.setHours(h || 9, m || 0, 0, 0);

        // Data que ja passou entra como rascunho sem agendamento: agendar
        // para o passado faria o worker tentar publicar na hora.
        const noFuturo = quando.getTime() > Date.now();

        const legenda = [p.gancho, p.descricao, p.cta].filter(Boolean).join('\n\n');

        const post = await prisma.post.create({
          data: {
            userId: ownerId,
            brandId,
            caption: legenda || p.titulo,
            hashtags: p.hashtags,
            platforms: [p.plataforma] as any,
            pilar: p.pilar?.toLowerCase().includes('vend') ? 'vender'
              : p.pilar?.toLowerCase().includes('educ') ? 'educar' : 'engajar',
            imageSource: 'NANOBANA',
            source: 'WEB',
            status: 'DRAFT',
            scheduledAt: noFuturo ? quando : null,
          },
        });

        if (noFuturo) await schedulePost(post.id, quando).catch(() => {});
        criados.push(post.id);
      } catch (err: any) {
        falhas.push({ data: p.data.toISOString(), erro: err?.message || 'Falha ao criar' });
      }
    }

    res.json({ success: true, data: { criados: criados.length, falhas } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Falha ao agendar' });
  }
});

export default router;
