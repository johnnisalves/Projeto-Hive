import { prisma } from '../config/database';
import { callText } from './caption.service';

/**
 * Reciclagem inteligente.
 *
 * O evergreen que ja existia republicava o post IGUAL, no intervalo fixo.
 * Isso cansa o seguidor e o alcance cai a cada repeticao. Aqui a diferenca
 * e que a IA REESCREVE a legenda com outro angulo: mesma arte, texto novo.
 *
 * A logica de pontuar e de decidir quem pode ser reciclado e pura, para
 * poder ser testada (recycle.test.ts). Rede e IA ficam nas funcoes de fora.
 */

/** Idade minima antes de reciclar. Menos que isso, o seguidor lembra. */
export const DIAS_MINIMOS = 60;
/** Espera antes de reciclar o MESMO post outra vez. */
export const DIAS_ENTRE_RECICLAGENS = 120;

export interface PostAvaliado {
  id: string;
  caption?: string | null;
  imageUrl?: string | null;
  publishedAt?: Date | null;
  recycledAt?: Date | null;
  likes: number;
  comments: number;
  /**
   * Receita atribuida a este post, em centavos (cupons resgatados, vendas
   * marcadas como vindas dele). Ausente = nao medimos, nao "nao vendeu".
   */
  receitaCentavos?: number;
}

/**
 * Nota do post.
 *
 * Comentario pesa 3x mais que curtida: curtir custa um toque, comentar
 * custa intencao. Post com 50 curtidas e 20 comentarios engaja mais que um
 * com 200 curtidas e 2 comentarios, e a nota precisa refletir isso.
 */
export function pontuacao(likes: number, comments: number): number {
  return Math.max(0, likes) + Math.max(0, comments) * 3;
}

/**
 * O post pode ser reciclado agora?
 *
 * Duas travas: precisa ter idade suficiente desde a publicacao, e nao pode
 * ter sido reciclado ha pouco. Sem a segunda, o mesmo post voltaria toda
 * semana e o perfil viraria repeticao.
 */
export function elegivel(post: PostAvaliado, hoje = new Date()): boolean {
  if (!post.publishedAt) return false;
  if (!post.imageUrl) return false; // sem arte nao ha o que republicar

  const dias = (d: Date) => (hoje.getTime() - d.getTime()) / 86_400_000;

  if (dias(new Date(post.publishedAt)) < DIAS_MINIMOS) return false;
  if (post.recycledAt && dias(new Date(post.recycledAt)) < DIAS_ENTRE_RECICLAGENS) return false;

  return true;
}

/** Como ordenar: pelo que engajou ou pelo que vendeu. */
export type Criterio = 'engajamento' | 'receita';

/**
 * Os melhores candidatos, do mais forte para o mais fraco.
 *
 * O criterio "receita" muda a pergunta de "o que a audiencia curtiu?" para
 * "o que encheu o caixa?" — e sao respostas diferentes com frequencia. Um
 * post engracado ganha em curtida; o post de promocao ganha em pedido.
 *
 * Post sem receita medida NAO e tratado como receita zero na ordenacao por
 * receita: ele cai para o fim, mas atras dos que venderam, nao misturado
 * com eles. Assim quem ainda nao usa cupom nem modo balcao continua vendo
 * uma lista util em vez de uma lista aleatoria.
 */
export function ranquear(
  posts: PostAvaliado[],
  hoje = new Date(),
  limite = 10,
  criterio: Criterio = 'engajamento',
): PostAvaliado[] {
  const elegiveis = posts.filter((p) => elegivel(p, hoje));

  if (criterio === 'receita') {
    const comReceita = elegiveis.filter((p) => (p.receitaCentavos || 0) > 0);
    const semReceita = elegiveis.filter((p) => !(p.receitaCentavos || 0));
    return [
      ...comReceita.sort((a, b) => (b.receitaCentavos || 0) - (a.receitaCentavos || 0)),
      ...semReceita.sort((a, b) => pontuacao(b.likes, b.comments) - pontuacao(a.likes, a.comments)),
    ].slice(0, limite);
  }

  return elegiveis
    .sort((a, b) => pontuacao(b.likes, b.comments) - pontuacao(a.likes, a.comments))
    .slice(0, limite);
}

/** Busca curtidas e comentarios dos posts publicados no Instagram. */
export async function coletarEngajamento(userId: string, brandId?: string): Promise<PostAvaliado[]> {
  const posts = await prisma.post.findMany({
    where: {
      userId,
      ...(brandId ? { brandId } : {}),
      status: 'PUBLISHED',
      instagramId: { not: null },
    },
    orderBy: { publishedAt: 'desc' },
    take: 100,
  });
  if (posts.length === 0) return [];

  const account = await prisma.instagramToken.findFirst({
    where: { userId },
    orderBy: { isDefault: 'desc' },
  });

  // Sem conta conectada seguimos com engajamento zero: o ranking fica pela
  // ordem de publicacao, o que ainda e util, em vez de nao entregar nada.
  const base = account?.accessToken?.startsWith('EAA')
    ? 'https://graph.facebook.com/v21.0'
    : 'https://graph.instagram.com/v21.0';

  /**
   * Uma consulta so para TODAS as midias, em vez de uma por post.
   *
   * O codigo anterior disparava ate 100 chamadas em paralelo a cada
   * abertura da tela de reciclagem: e a forma mais rapida de estourar o
   * rate limit da conta e derrubar a publicacao de todo mundo. A listagem
   * /media devolve like_count e comments_count de uma vez.
   */
  const metricas = new Map<string, { likes: number; comments: number }>();
  if (account) {
    // No Login do Instagram o id da conta nao serve como caminho; "me" e o
    // alias que funciona nos dois modos.
    const uid = account.accessToken.startsWith('EAA') ? account.instagramUserId : 'me';
    try {
      const r = await fetch(
        `${base}/${uid}/media?fields=id,like_count,comments_count&limit=100&access_token=${account.accessToken}`,
      );
      const j = (await r.json()) as any;
      if (j?.error) console.warn('[Reciclagem] Sem metricas:', j.error.message);
      else {
        for (const m of j.data || []) {
          metricas.set(String(m.id), { likes: m.like_count ?? 0, comments: m.comments_count ?? 0 });
        }
      }
    } catch (e: any) {
      console.warn('[Reciclagem] Falha ao buscar metricas:', e?.message);
    }
  }

  // Receita atribuida por post: cupons daquele post que foram resgatados.
  // Uma consulta so, agrupada — nao uma por post, que multiplicaria por 100.
  const receitaPorPost = new Map<string, number>();
  try {
    const resgates = await prisma.couponRedemption.findMany({
      where: { coupon: { userId, ...(brandId ? { brandId } : {}) } },
      select: { valorCentavos: true, coupon: { select: { postId: true } } },
    });
    for (const r of resgates) {
      const pid = r.coupon?.postId;
      if (!pid) continue;
      receitaPorPost.set(pid, (receitaPorPost.get(pid) || 0) + r.valorCentavos);
    }
  } catch { /* tabela ainda nao criada ou sem cupons: segue sem receita */ }

  return posts.map((p) => {
    // Post fora das 100 midias mais recentes, ou apagado no Instagram,
    // fica com zero — que a ordenacao ja trata como "sem dado".
    const m = p.instagramId ? metricas.get(String(p.instagramId)) : undefined;
    return {
      id: p.id,
      caption: p.caption,
      imageUrl: p.imageUrl,
      publishedAt: p.publishedAt,
      recycledAt: p.recycledAt,
      likes: m?.likes ?? 0,
      comments: m?.comments ?? 0,
      receitaCentavos: receitaPorPost.get(p.id) || 0,
    };
  });
}

/**
 * Reescreve a legenda com outro angulo.
 *
 * O ponto e nao parecer repost. Se a IA falhar, devolvemos null em vez de
 * repetir o texto original — republicar identico e exatamente o que esta
 * feature existe para evitar.
 */
export async function reescreverLegenda(original: string, marca?: string): Promise<string | null> {
  const prompt = [
    'Reescreva a legenda de Instagram abaixo com um ÂNGULO DIFERENTE.',
    marca ? `\nNEGÓCIO:\n${marca}` : '',
    `\nLEGENDA ORIGINAL:\n"${original}"`,
    '\nREGRAS:',
    '- Mesmo assunto e mesma oferta, abordagem diferente.',
    '- Se a original começou com pergunta, NÃO comece com pergunta.',
    '- Mantenha o tamanho parecido.',
    '- Português do Brasil, natural.',
    '- Não use hashtag.',
    '- Não escreva "repost", "relembrando" nem nada que denuncie repetição.',
    '\nResponda SOMENTE com a nova legenda.',
  ].filter(Boolean).join('\n');

  try {
    const bruto = await callText(prompt);
    const texto = (bruto || '').trim().replace(/^["'`]+|["'`]+$/g, '').trim();
    // Texto muito curto ou igual ao original nao serve.
    if (texto.length < 10) return null;
    if (texto.toLowerCase() === original.trim().toLowerCase()) return null;
    return texto;
  } catch {
    return null;
  }
}
