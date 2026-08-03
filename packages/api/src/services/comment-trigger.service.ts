import { prisma } from '../config/database';

/**
 * "Comente EU QUERO que eu te chamo" — a mecanica de venda numero 1 do
 * Instagram brasileiro, embutida no proprio agendador.
 *
 * Usa Private Replies, endpoint OFICIAL da Graph API: um comentario pode
 * receber UMA resposta privada, e so dentro de 7 dias. Nao ha segunda
 * chance, entao o registro de quem ja foi respondido e obrigatorio — uma
 * tentativa repetida queima a unica bala daquele comentario.
 */

/**
 * Tira acento e caixa para comparar.
 *
 * Sem isso, "cardápio" nao casaria com o gatilho "cardapio" — e o seguidor
 * que digitou certo ficaria sem resposta.
 */
export function normalizarPalavra(bruta: string): string {
  return (bruta || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function escaparRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * O comentario contem a palavra-gatilho?
 *
 * Compara por PALAVRA INTEIRA, nao por trecho: o gatilho "quero" nao pode
 * disparar em "requerimento". Como a normalizacao ja tirou os acentos, o
 * \b do JavaScript funciona aqui — em texto acentuado ele falharia, porque
 * \b enxerga so [A-Za-z0-9_].
 */
export function casaGatilho(comentario: string, palavra: string): boolean {
  const texto = normalizarPalavra(comentario);
  const alvo = normalizarPalavra(palavra);
  if (!texto || !alvo) return false;
  return new RegExp(`(?:^|[^a-z0-9])${escaparRegex(alvo)}(?:[^a-z0-9]|$)`).test(texto);
}

export interface Gatilho {
  id: string;
  palavra: string;
  resposta: string;
  postId?: string | null;
  ativo: boolean;
}

/**
 * Escolhe qual gatilho responde quando mais de um casa.
 *
 * Vence o mais especifico: primeiro o que e daquele post (em vez do gatilho
 * geral da conta), depois o de palavra mais longa. Sem essa ordem, um
 * gatilho generico como "quero" roubaria os comentarios de "quero o
 * cardapio completo", que tem resposta melhor.
 */
export function escolherGatilho(comentario: string, gatilhos: Gatilho[], postId?: string | null): Gatilho | null {
  const candidatos = gatilhos
    .filter((g) => g.ativo)
    .filter((g) => !g.postId || g.postId === postId)
    .filter((g) => casaGatilho(comentario, g.palavra));

  if (candidatos.length === 0) return null;

  return candidatos.sort((a, b) => {
    const especifico = (g: Gatilho) => (g.postId ? 1 : 0);
    if (especifico(b) !== especifico(a)) return especifico(b) - especifico(a);
    return normalizarPalavra(b.palavra).length - normalizarPalavra(a.palavra).length;
  })[0];
}

/**
 * Troca as marcacoes da resposta pelos dados de quem comentou.
 * "Oi {nome}!" vira "Oi @jussara!".
 */
export function montarResposta(modelo: string, username?: string | null): string {
  return (modelo || '').replace(/\{nome\}/gi, username ? `@${username}` : 'tudo bem').trim();
}

/**
 * A resposta privada tem prazo: 7 dias a contar do comentario.
 *
 * Passou disso, a API recusa. Checar antes evita gastar chamada e, mais
 * importante, evita marcar o comentario como respondido sem ter respondido.
 */
export const PRAZO_RESPOSTA_DIAS = 7;

export function dentroDoPrazo(comentadoEm: Date, agora = new Date()): boolean {
  return agora.getTime() - new Date(comentadoEm).getTime() <= PRAZO_RESPOSTA_DIAS * 86_400_000;
}

/**
 * Manda a resposta privada pelo endpoint oficial.
 *
 * Exige token do Login do Facebook: com token do Login do Instagram (IGAA)
 * o endpoint nao existe, e a falha seria silenciosa para o usuario.
 */
export async function enviarRespostaPrivada(
  commentId: string,
  mensagem: string,
  token: string,
): Promise<{ ok: boolean; erro?: string }> {
  if (!token.startsWith('EAA')) {
    return { ok: false, erro: 'A resposta automatica exige conta conectada via Login do Facebook.' };
  }

  try {
    const r = await fetch(`https://graph.facebook.com/v21.0/${commentId}/private_replies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: mensagem, access_token: token }),
    });
    const data = (await r.json()) as any;
    if (data?.error) return { ok: false, erro: data.error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, erro: (err as Error).message };
  }
}

/**
 * Processa um comentario recebido pelo webhook.
 *
 * A ordem importa: registramos o comentario como tratado ANTES de chamar a
 * API. Se o webhook reentregar o mesmo evento (o Meta reentrega), a segunda
 * passada para no unique do banco em vez de queimar a unica resposta
 * privada permitida daquele comentario.
 */
export async function processarComentario(params: {
  userId: string;
  commentId: string;
  texto: string;
  postId?: string | null;
  username?: string | null;
  token: string;
}): Promise<{ respondido: boolean; motivo?: string }> {
  const gatilhos = await prisma.commentTrigger.findMany({ where: { userId: params.userId, ativo: true } });
  const escolhido = escolherGatilho(params.texto, gatilhos as any, params.postId);
  if (!escolhido) return { respondido: false, motivo: 'nenhum gatilho casou' };

  try {
    await prisma.triggerLog.create({ data: { commentId: params.commentId, triggerId: escolhido.id } });
  } catch {
    return { respondido: false, motivo: 'comentario ja respondido' };
  }

  const r = await enviarRespostaPrivada(
    params.commentId,
    montarResposta(escolhido.resposta, params.username),
    params.token,
  );

  if (r.ok) {
    await prisma.commentTrigger.update({
      where: { id: escolhido.id },
      data: { disparos: { increment: 1 } },
    }).catch(() => {});
    return { respondido: true };
  }

  // Falhou de verdade: libera o comentario para uma nova tentativa, senao
  // uma queda momentanea do Meta perderia o lead para sempre.
  await prisma.triggerLog.deleteMany({ where: { commentId: params.commentId } }).catch(() => {});
  return { respondido: false, motivo: r.erro };
}
