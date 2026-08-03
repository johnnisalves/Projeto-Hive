import { Worker, Queue } from 'bullmq';
import { redis } from '../config/redis';
import { prisma } from '../config/database';
import { detectarCrise, devePausar, pareceNegativo, ComentarioObservado } from '../services/sentinel.service';
import { contaDaMarca, enderecoDaConta } from '../services/account-resolver.service';
import { registrarDecisao } from '../services/brand-brain.service';

/**
 * Sentinela: para de despejar promocao no meio de um incendio.
 *
 * As 23h de sabado um post azeda — preco errado, reclamacao virando bola de
 * neve — e o social media humano para de postar oferta. A ferramenta, ate
 * aqui, continuava. A logica de deteccao existia e tinha teste desde que
 * foi escrita, mas NENHUM worker a chamava: era codigo que nunca rodou.
 *
 * A varredura e de 20 em 20 minutos. Mais rapido que isso gasta cota da
 * Graph API sem ganho: crise nao vira e desvira em cinco minutos, e a
 * janela de analise ja e de uma hora e meia.
 */

const filaSentinela = new Queue('sentinel-queue', { connection: redis });

const MINUTO = 60 * 1000;
const INTERVALO = 20 * MINUTO;

/** Quantos comentarios recentes analisar por marca. */
const LIMITE_MIDIAS = 5;

export async function initSentinelJob() {
  const antigos = await filaSentinela.getRepeatableJobs();
  for (const j of antigos) {
    try { await filaSentinela.removeRepeatableByKey(j.key); } catch { /* ignore */ }
  }
  await filaSentinela.add('varrer', {}, { repeat: { every: INTERVALO } });
}

/** Comentarios recentes da conta desta marca, ja com sentimento. */
async function comentariosRecentes(userId: string, brandId: string | null): Promise<ComentarioObservado[]> {
  const { conta } = await contaDaMarca(userId, brandId);
  if (!conta) return [];

  const { base, uid } = enderecoDaConta(conta);
  try {
    const r = await fetch(
      `${base}/${uid}/media?fields=id,comments{id,text,timestamp}&limit=${LIMITE_MIDIAS}&access_token=${conta.accessToken}`,
    );
    const j = (await r.json()) as any;
    if (j?.error) return [];

    const saida: ComentarioObservado[] = [];
    for (const m of j.data || []) {
      for (const c of m?.comments?.data || []) {
        if (!c?.id || !c?.text) continue;
        saida.push({
          id: c.id,
          texto: c.text,
          criadoEm: new Date(c.timestamp || Date.now()),
          sentimento: pareceNegativo(c.text) ? 'negativo' : 'neutro',
        });
      }
    }
    return saida;
  } catch {
    return [];
  }
}

/**
 * Pausa o que nao pode sair durante uma crise.
 *
 * NAO pausa tudo: conteudo de "educar" seguir no ar e inofensivo, e travar
 * a conta inteira por um comentario ruim seria pior que o problema. O que
 * nao pode sair no meio de um incendio e promocao — soa como marca
 * ignorando a reclamacao.
 *
 * Os posts voltam para DRAFT com a data preservada: o usuario reagenda com
 * um clique quando a poeira baixar. Apagar seria irreversivel.
 */
async function pausarSensiveis(userId: string, brandId: string | null): Promise<number> {
  const agendados = await prisma.post.findMany({
    where: {
      userId,
      ...(brandId ? { brandId } : {}),
      status: 'SCHEDULED',
      scheduledAt: { gte: new Date(), lte: new Date(Date.now() + 12 * 60 * MINUTO) },
    },
    select: { id: true, pilar: true },
  });

  const paraPausar = agendados.filter((p) => devePausar(p.pilar));
  if (paraPausar.length === 0) return 0;

  await prisma.post.updateMany({
    where: { id: { in: paraPausar.map((p) => p.id) } },
    data: { status: 'DRAFT', lastError: 'Pausado pela sentinela: pico de comentários negativos.' },
  });
  return paraPausar.length;
}

export const sentinelWorker = new Worker(
  'sentinel-queue',
  async () => {
    const marcas = await prisma.brand.findMany({ select: { id: true, name: true, userId: true } });

    for (const marca of marcas) {
      try {
        const comentarios = await comentariosRecentes(marca.userId, marca.id);
        const r = detectarCrise(comentarios);
        if (!r.crise) continue;

        // Uma crise so gera um alerta: sem esta trava, cada varredura
        // repetiria o aviso de 20 em 20 minutos e o usuario aprenderia a
        // ignorar a sentinela.
        const chave = `SENTINELA_${marca.id}`;
        const ultimo = await prisma.setting.findUnique({
          where: { userId_key: { userId: marca.userId, key: chave } },
        }).catch(() => null);

        const seisHoras = 6 * 60 * MINUTO;
        if (ultimo?.value && Date.now() - Number(ultimo.value) < seisHoras) continue;

        const pausados = await pausarSensiveis(marca.userId, marca.id);

        await prisma.setting.upsert({
          where: { userId_key: { userId: marca.userId, key: chave } },
          create: { userId: marca.userId, key: chave, value: String(Date.now()) },
          update: { value: String(Date.now()) },
        }).catch(() => {});

        await registrarDecisao({
          userId: marca.userId,
          brandId: marca.id,
          ator: 'sentinela',
          acao: pausados > 0
            ? `Pausei ${pausados} post${pausados > 1 ? 's' : ''} de venda de ${marca.name}`
            : `Detectei um pico de comentários negativos em ${marca.name}`,
          justificativa: `${r.motivo} Conteúdo de educar e engajar segue no ar; só oferta foi pausada.`,
        });

        console.warn(`[Sentinela] ${marca.name}: ${r.motivo} ${pausados} post(s) pausado(s).`);
      } catch (err) {
        // Uma marca com problema nao pode parar a varredura das outras.
        console.error(`[Sentinela] Falha ao analisar ${marca.name}:`, (err as Error).message);
      }
    }
  },
  { connection: redis },
);
