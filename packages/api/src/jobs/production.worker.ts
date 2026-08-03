import { Worker, Queue } from 'bullmq';
import { redis } from '../config/redis';
import { prisma } from '../config/database';
import { oQueFalta, temaDoPost, PostParaProduzir } from '../services/production.service';
import { generateCaption } from '../services/caption.service';
import { generateImage } from '../services/nanobana.service';
import { promptDaMarca, registrarDecisao } from '../services/brand-brain.service';
import { nichoDe } from '../services/niche.service';

/**
 * Producao de conteudo: rascunho vazio vira post pronto.
 *
 * UM JOB POR POST, nunca um job para os 30. Um lote que falha no post 17
 * perde os 16 anteriores, nao mostra progresso e reprocessa tudo na
 * tentativa seguinte — gastando de novo o credito ja gasto.
 *
 * CONCORRENCIA 1 de proposito. Geracao de imagem e cara e lenta; 30 em
 * paralelo derrubariam o limite do provedor e a metade delas voltaria como
 * erro de rate limit, queimando as chamadas sem produzir nada.
 */

export const filaProducao = new Queue('producao-queue', { connection: redis });

interface DadosDoJob {
  postId: string;
  userId: string;
}

export async function enfileirarProducao(itens: DadosDoJob[]): Promise<number> {
  if (itens.length === 0) return 0;
  await filaProducao.addBulk(itens.map((d) => ({
    name: 'produzir',
    data: d,
    opts: {
      // O id do post e a chave do job: clicar duas vezes em "produzir" nao
      // gera o mesmo post duas vezes nem cobra duas vezes.
      jobId: `produzir-${d.postId}`,
      attempts: 2,
      backoff: { type: 'exponential', delay: 20_000 },
      removeOnComplete: 200,
      removeOnFail: 100,
    },
  })));
  return itens.length;
}

export const productionWorker = new Worker<DadosDoJob>(
  'producao-queue',
  async (job) => {
    const { postId, userId } = job.data;

    const post = await prisma.post.findFirst({
      where: { id: postId, userId },
      include: { brand: true },
    });
    if (!post) return { pulado: 'post nao encontrado' };

    const falta = oQueFalta(post as unknown as PostParaProduzir);
    // Alguem pode ter escrito a legenda a mao enquanto o job esperava na
    // fila. Reconferir aqui evita sobrescrever trabalho humano.
    if (falta === null) return { pulado: 'ja estava pronto' };

    const tema = temaDoPost(post as unknown as PostParaProduzir);
    if (!tema) return { pulado: 'sem tema' };

    const atualizacao: Record<string, unknown> = {};

    // ---- Arte primeiro ----
    // A legenda fica melhor quando a IA ve a imagem (generateCaption aceita
    // imageUrl e descreve o que esta na arte). Gerar na ordem inversa
    // desperdicaria esse ganho.
    if (falta === 'arte' || falta === 'ambos') {
      const contexto = nichoDe(post.brand?.nicho).contextoIA;
      const { imageUrl, minioKey } = await generateImage({
        prompt: [tema, contexto, post.brand?.artDirection].filter(Boolean).join('. '),
        aspectRatio: (post.aspectRatio as '1:1' | '9:16' | '4:5') || '4:5',
      });
      atualizacao.imageUrl = imageUrl;
      atualizacao.videoMinioKey = minioKey;
    }

    // ---- Legenda ----
    if (falta === 'legenda' || falta === 'ambos') {
      // As regras que a marca ensinou entram aqui: e o que faz a legenda
      // sair no tom do cliente em vez de generica.
      const regras = await promptDaMarca(post.brandId);
      const r = await generateCaption({
        topic: [tema, regras].filter(Boolean).join('\n\n'),
        brandId: post.brandId || undefined,
        platform: (post.platforms || [])[0],
        imageUrl: (atualizacao.imageUrl as string) || post.imageUrl || undefined,
        mode: (post.pilar as any) || undefined,
      });
      atualizacao.caption = r.caption;
      if (r.hashtags?.length) atualizacao.hashtags = r.hashtags;
    }

    await prisma.post.update({ where: { id: post.id }, data: atualizacao });

    await registrarDecisao({
      userId,
      brandId: post.brandId,
      postId: post.id,
      ator: 'producao',
      acao: falta === 'ambos' ? 'Escrevi a legenda e gerei a arte de um post'
        : falta === 'arte' ? 'Gerei a arte de um post'
          : 'Escrevi a legenda de um post',
      justificativa: `Tema: ${tema.slice(0, 80)}`,
    });

    return { produzido: falta };
  },
  {
    connection: redis,
    // Uma de cada vez: ver o comentario no topo.
    concurrency: 1,
    // Teto de seguranca no provedor de IA, mesmo com concorrencia 1: 30
    // jobs por minuto e mais que suficiente e nao estoura ninguem.
    limiter: { max: 30, duration: 60_000 },
  },
);
