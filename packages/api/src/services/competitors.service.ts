import { prisma } from '../config/database';
import { contaDaMarca } from './account-resolver.service';

/**
 * Radar de concorrentes.
 *
 * Usa business_discovery, o mesmo endpoint que ja usamos para confirmar
 * perfil. Ele devolve dados publicos de contas Business/Creator: numero de
 * seguidores, quantidade de posts e as midias recentes com curtidas.
 *
 * LIMITES DO META, nao nossos:
 *  - exige token do Login do Facebook (EAA);
 *  - so enxerga conta Business/Creator PUBLICA. Perfil pessoal ou privado
 *    nunca aparece — e nao ha como contornar.
 */

/** Teto de perfis por conta. Cada check e uma chamada ao Meta. */
export const MAX_CONCORRENTES = 5;

export interface Metricas {
  username: string;
  displayName?: string;
  followers?: number;
  mediaCount?: number;
  postsLast30: number;
  avgLikes: number;
}

/**
 * Quantos posts nos ultimos 30 dias e a media de curtidas.
 *
 * A frequencia diz mais que o total de posts: uma conta com 800 publicacoes
 * historicas mas parada ha meses nao e concorrente ativo.
 */
export function analisarMidias(midias: Array<{ timestamp?: string; like_count?: number }>, agora = new Date()): {
  postsLast30: number; avgLikes: number;
} {
  const limite = agora.getTime() - 30 * 86_400_000;
  const recentes = midias.filter((m) => m.timestamp && new Date(m.timestamp).getTime() >= limite);

  const comCurtidas = midias.filter((m) => typeof m.like_count === 'number');
  const soma = comCurtidas.reduce((acc, m) => acc + (m.like_count || 0), 0);

  return {
    postsLast30: recentes.length,
    // Media sobre o que TEM curtida: contar post sem dado como zero
    // derrubaria a media e faria o concorrente parecer fraco.
    avgLikes: comCurtidas.length ? Math.round(soma / comCurtidas.length) : 0,
  };
}

/** Variacao absoluta entre dois checks. null quando nao ha base. */
export function delta(atual?: number | null, anterior?: number | null): number | null {
  if (atual == null || anterior == null) return null;
  return atual - anterior;
}

/** Busca os dados publicos de um perfil. */
export async function consultarPerfil(userId: string, username: string, brandId?: string | null): Promise<Metricas> {
  // O business_discovery e assinado pela conta da MARCA que acompanha o
  // concorrente: assim a cota de chamadas de cada cliente e a dele.
  const { conta: account } = await contaDaMarca(userId, brandId);
  if (!account) throw new Error('Nenhuma conta do Instagram conectada.');
  if (!account.accessToken.startsWith('EAA')) {
    throw new Error('O radar exige conta conectada via Login do Facebook.');
  }

  const alvo = username.trim().replace(/^@/, '').toLowerCase();
  const campos = `business_discovery.username(${encodeURIComponent(alvo)})`
    + `{username,name,followers_count,media_count,media.limit(25){timestamp,like_count,comments_count}}`;

  const res = await fetch(
    `https://graph.facebook.com/v21.0/${account.instagramUserId}?fields=${campos}&access_token=${account.accessToken}`,
  );
  const data = (await res.json()) as any;

  if (data?.error) throw new Error(data.error.message);
  const bd = data?.business_discovery;
  if (!bd?.username) {
    throw new Error('Perfil não encontrado. O Meta só expõe contas Business/Creator públicas.');
  }

  const { postsLast30, avgLikes } = analisarMidias(bd.media?.data || []);
  return {
    username: bd.username,
    displayName: bd.name,
    followers: bd.followers_count,
    mediaCount: bd.media_count,
    postsLast30,
    avgLikes,
  };
}

/**
 * Atualiza um concorrente, guardando os valores antigos para a variacao.
 *
 * Erro nao apaga o registro nem os numeros anteriores: guardamos em
 * lastError e a tela mostra o ultimo dado bom com o aviso. Perder o
 * historico por uma falha de rede seria pior que ficar desatualizado.
 */
export async function atualizarConcorrente(userId: string, id: string) {
  const c = await prisma.competitor.findFirst({ where: { id, userId } });
  if (!c) throw new Error('Concorrente nao encontrado');

  try {
    // O concorrente ja sabe de qual marca ele e; a consulta usa a conta
    // dessa marca em vez da conta padrao do dono.
    const m = await consultarPerfil(userId, c.username, c.brandId);
    return await prisma.competitor.update({
      where: { id: c.id },
      data: {
        displayName: m.displayName,
        prevFollowers: c.followers,
        prevMediaCount: c.mediaCount,
        followers: m.followers,
        mediaCount: m.mediaCount,
        postsLast30: m.postsLast30,
        avgLikes: m.avgLikes,
        lastCheckedAt: new Date(),
        lastError: null,
      },
    });
  } catch (err) {
    return await prisma.competitor.update({
      where: { id: c.id },
      data: { lastError: (err as Error).message.slice(0, 300), lastCheckedAt: new Date() },
    });
  }
}
