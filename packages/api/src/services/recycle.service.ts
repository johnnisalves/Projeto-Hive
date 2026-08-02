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

/** Os melhores candidatos, do mais forte para o mais fraco. */
export function ranquear(posts: PostAvaliado[], hoje = new Date(), limite = 10): PostAvaliado[] {
  return posts
    .filter((p) => elegivel(p, hoje))
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

  return await Promise.all(posts.map(async (p) => {
    let likes = 0;
    let comments = 0;
    if (account && p.instagramId) {
      try {
        const r = await fetch(`${base}/${p.instagramId}?fields=like_count,comments_count&access_token=${account.accessToken}`);
        const j = (await r.json()) as any;
        if (!j?.error) {
          likes = j.like_count ?? 0;
          comments = j.comments_count ?? 0;
        }
      } catch { /* post apagado no Instagram ou sem permissao: fica zero */ }
    }
    return {
      id: p.id,
      caption: p.caption,
      imageUrl: p.imageUrl,
      publishedAt: p.publishedAt,
      recycledAt: p.recycledAt,
      likes,
      comments,
    };
  }));
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
