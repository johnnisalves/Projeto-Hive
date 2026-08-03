import { prisma } from '../config/database';

/**
 * Qual conta de Instagram usar para ESTA marca.
 *
 * O PROBLEMA QUE ISTO RESOLVE: ate aqui, quase todo servico pegava a conta
 * assim — findFirst({ where: { userId }, orderBy: { isDefault: 'desc' } }).
 * Ou seja, "a conta padrao do dono", sem saber de qual cliente se trata.
 *
 * Numa agencia com 40 clientes isso nao e feature faltando, e DADO ERRADO:
 * o relatorio mensal do cliente B saia com as curtidas do cliente A, o
 * inbox mostrava as mensagens de outra conta, a reciclagem rankeava pelo
 * engajamento errado. Um relatorio com os numeros do cliente errado e pior
 * que nenhum relatorio — a agencia descobre na reuniao.
 *
 * A REGRA CENTRAL: quando ha ambiguidade, RECUSAR e melhor que adivinhar.
 * Uma tela vazia dizendo "conecte o Instagram desta marca" e honesta. Uma
 * tela cheia com os numeros de outro cliente e uma mentira silenciosa.
 */

export interface ContaCandidata {
  id: string;
  accessToken: string;
  instagramUserId: string;
  username?: string | null;
  pageId?: string | null;
  isDefault: boolean;
  brandId?: string | null;
}

export type MotivoSemConta =
  | 'nenhuma_conta'
  | 'marca_sem_conta'
  | 'ambiguo';

export interface Resolucao {
  conta: ContaCandidata | null;
  motivo?: MotivoSemConta;
  /** Explicacao pronta para a tela, em portugues. */
  mensagem?: string;
}

export const MENSAGENS: Record<MotivoSemConta, string> = {
  nenhuma_conta: 'Nenhuma conta do Instagram conectada. Conecte em Configurações.',
  marca_sem_conta: 'Esta empresa ainda não tem uma conta do Instagram vinculada. Vincule em Configurações para ver os dados dela.',
  ambiguo: 'Você tem mais de uma conta do Instagram conectada e esta empresa não está vinculada a nenhuma. Vincule para não misturar os dados dos clientes.',
};

/**
 * A decisao, isolada do banco para poder ser testada.
 *
 * Ordem:
 * 1. Conta vinculada explicitamente a esta marca — sempre ganha.
 * 2. A ponte antiga por pageId (instalacoes que configuraram antes deste
 *    campo existir) — mantida para nao quebrar quem ja funcionava.
 * 3. Conta unica: sem ambiguidade possivel, usa. E o que faz o usuario de
 *    uma marca so continuar funcionando sem configurar nada.
 * 4. Varias contas e nenhuma vinculada: RECUSA. E aqui que estava o bug.
 *
 * Sem `brandId` (telas que nao sao de uma marca especifica), cai direto na
 * conta padrao — nao ha o que confundir.
 */
export function escolherConta(
  contas: ContaCandidata[],
  brandId?: string | null,
  pageIdDaMarca?: string | null,
): Resolucao {
  const lista = contas || [];
  if (lista.length === 0) {
    return { conta: null, motivo: 'nenhuma_conta', mensagem: MENSAGENS.nenhuma_conta };
  }

  if (!brandId) {
    const padrao = lista.find((c) => c.isDefault) || lista[0];
    return { conta: padrao };
  }

  const daMarca = lista.find((c) => c.brandId === brandId);
  if (daMarca) return { conta: daMarca };

  if (pageIdDaMarca) {
    const porPage = lista.find((c) => c.pageId && c.pageId === pageIdDaMarca);
    if (porPage) return { conta: porPage };
  }

  // Conta unica: nao ha como pegar a "errada", entao usar e seguro e
  // mantem funcionando quem tem um cliente so.
  if (lista.length === 1) return { conta: lista[0] };

  return { conta: null, motivo: 'ambiguo', mensagem: MENSAGENS.ambiguo };
}

/** Resolve consultando o banco. */
export async function contaDaMarca(userId: string, brandId?: string | null): Promise<Resolucao> {
  const contas = await prisma.instagramToken.findMany({ where: { userId } }).catch(() => []);

  // A ponte antiga: SocialAccount da marca guarda o pageId, e o
  // InstagramToken casa por ele. Era assim que a publicacao ja roteava.
  let pageIdDaMarca: string | null = null;
  if (brandId) {
    const social = await prisma.socialAccount.findFirst({
      where: { userId, platform: 'INSTAGRAM', brandId },
      select: { pageId: true },
    }).catch(() => null);
    pageIdDaMarca = social?.pageId ?? null;
  }

  return escolherConta(contas as ContaCandidata[], brandId, pageIdDaMarca);
}

/**
 * A mesma regra, para as outras redes (SocialAccount).
 *
 * Facebook, LinkedIn, X, TikTok e Threads tinham cada um o seu getAccount,
 * e quatro deles nem sabiam o que era marca: iam direto para isDefault e
 * depois para "qualquer conta". O post de um cliente saia no LinkedIn de
 * outro sem nenhum erro.
 */
export interface ContaSocial {
  id: string;
  accessToken: string;
  platformUserId: string;
  username?: string | null;
  pageId?: string | null;
  isDefault: boolean;
  brandId?: string | null;
}

export function escolherContaSocial(contas: ContaSocial[], brandId?: string | null): {
  conta: ContaSocial | null;
  motivo?: MotivoSemConta;
  mensagem?: string;
} {
  const lista = contas || [];
  if (lista.length === 0) {
    return { conta: null, motivo: 'nenhuma_conta', mensagem: MENSAGENS.nenhuma_conta };
  }

  if (!brandId) {
    return { conta: lista.find((c) => c.isDefault) || lista[0] };
  }

  const daMarca = lista.find((c) => c.brandId === brandId);
  if (daMarca) return { conta: daMarca };

  // Conta unica: nao ha como pegar a errada.
  if (lista.length === 1) return { conta: lista[0] };

  return { conta: null, motivo: 'ambiguo', mensagem: MENSAGENS.ambiguo };
}

/** Resolve a conta de uma plataforma consultando o banco. */
export async function contaSocialDaMarca(
  userId: string,
  platform: string,
  brandId?: string | null,
  accountId?: string,
) {
  // accountId explicito ainda passa pelo dono: sem userId na condicao, um
  // id de outra empresa publicaria na conta dela.
  if (accountId) {
    const escolhida = await prisma.socialAccount.findFirst({
      where: { id: accountId, userId, platform: platform as any },
    });
    if (escolhida) return { conta: escolhida as unknown as ContaSocial };
  }

  const contas = await prisma.socialAccount.findMany({
    where: { userId, platform: platform as any },
  }).catch(() => []);

  return escolherContaSocial(contas as unknown as ContaSocial[], brandId);
}

/**
 * Base da Graph API e caminho da conta, pelo tipo do token.
 *
 * Prefixo EAA = Login do Facebook (graph.facebook.com, usa o id da conta).
 * Qualquer outro = Login do Instagram (graph.instagram.com, exige o alias
 * "me" — o id proprio nao funciona como caminho ali).
 */
export function enderecoDaConta(conta: ContaCandidata): { base: string; uid: string } {
  const doFacebook = conta.accessToken.startsWith('EAA');
  return {
    base: doFacebook ? 'https://graph.facebook.com/v21.0' : 'https://graph.instagram.com/v21.0',
    uid: doFacebook ? conta.instagramUserId : 'me',
  };
}
