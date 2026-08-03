import { prisma } from '../config/database';

/**
 * Cerebro da marca: a IA aprende com cada correcao do cliente.
 *
 * Toda vez que alguem edita uma legenda gerada ou reprova um post, existe
 * ali uma regra implicita ("essa marca nao usa emoji", "essa marca fala
 * voce, nao vc"). Este servico extrai essas regras e as injeta em toda
 * geracao futura.
 *
 * POR QUE DETERMINISTICO ANTES DE IA: as observacoes abaixo saem de contar
 * emoji e medir tamanho — custam zero e nunca alucinam. So o que sobra vai
 * para o modelo. Uma regra inventada e pior que nenhuma regra, porque
 * contamina todas as legendas seguintes da marca.
 */

const EMOJI = /\p{Extended_Pictographic}/gu;

function contarEmoji(t: string): number {
  return (t.match(EMOJI) || []).length;
}

function contarTags(t: string): number {
  return (t.match(/#[\p{L}0-9_]+/gu) || []).length;
}

function palavras(t: string): number {
  return (t.trim().match(/\S+/g) || []).length;
}

/**
 * Regras que dao para deduzir sem IA, comparando o que a IA escreveu com o
 * que a pessoa deixou publicar.
 *
 * Cada uma so dispara com sinal FORTE. Um limiar frouxo geraria regra a cada
 * edicao minima, e o prompt encheria de ruido ate a qualidade cair.
 */
export function diferencasObservaveis(original: string, editado: string): string[] {
  const o = original || '';
  const e = editado || '';
  if (!o.trim() || !e.trim()) return [];

  const regras: string[] = [];

  // Emoji: so vira regra se a pessoa apagou TODOS, e havia varios. Tirar
  // um emoji de tres e ajuste de gosto, nao padrao da marca.
  const emojiO = contarEmoji(o);
  const emojiE = contarEmoji(e);
  if (emojiO >= 2 && emojiE === 0) regras.push('Nao usar emoji nas legendas.');
  else if (emojiO === 0 && emojiE >= 2) regras.push('Usar emoji nas legendas.');

  if (contarTags(o) >= 3 && contarTags(e) === 0) {
    regras.push('Nao colocar hashtag na legenda.');
  }

  // Tamanho: 40% e o ponto em que a mudanca deixa de ser ajuste de frase e
  // vira preferencia de formato.
  const po = palavras(o);
  const pe = palavras(e);
  if (po >= 15 && pe <= po * 0.6) regras.push('Preferir legendas curtas e diretas.');
  else if (po >= 8 && pe >= po * 1.6) regras.push('Preferir legendas mais longas, com contexto.');

  const gritos = (t: string) => (t.match(/\b[A-ZÁÂÃÉÊÍÓÔÕÚÇ]{4,}\b/g) || []).length;
  if (gritos(o) >= 2 && gritos(e) === 0) regras.push('Nao escrever palavras em caixa alta.');

  const exclamacoes = (t: string) => (t.match(/!/g) || []).length;
  if (exclamacoes(o) >= 3 && exclamacoes(e) <= 1) regras.push('Usar poucas exclamacoes; tom mais sobrio.');

  // Abreviacao: qual das duas formas a marca usa de fato.
  const temAbrev = /\b(vc|pra|ta|to|q|blz)\b/i;
  if (temAbrev.test(o) && !temAbrev.test(e)) regras.push('Escrever por extenso, sem abreviacao de internet.');
  if (!temAbrev.test(o) && temAbrev.test(e)) regras.push('Pode usar linguagem informal e abreviada.');

  return regras;
}

export interface RegraContada {
  regra: string;
  peso: number;
}

/**
 * Junta observacoes repetidas numa regra so, somando o peso.
 *
 * O peso e o que separa padrao de acaso: uma marca que apagou emoji sete
 * vezes esta dizendo algo; uma que apagou uma vez, talvez nao.
 */
export function consolidarRegras(existentes: RegraContada[], novas: string[]): RegraContada[] {
  const mapa = new Map<string, RegraContada>();
  for (const r of existentes) mapa.set(r.regra.toLowerCase(), { ...r });

  for (const nova of novas) {
    const chave = nova.toLowerCase();
    const atual = mapa.get(chave);
    if (atual) atual.peso += 1;
    else mapa.set(chave, { regra: nova, peso: 1 });
  }

  return Array.from(mapa.values()).sort((a, b) => b.peso - a.peso);
}

/**
 * Regras contraditorias nao podem coexistir no prompt: "nao usar emoji" e
 * "usar emoji" juntas fazem o modelo escolher no chute, e a marca fica
 * inconsistente. Vence a mais observada.
 */
const OPOSTAS: Array<[string, string]> = [
  ['nao usar emoji nas legendas.', 'usar emoji nas legendas.'],
  ['preferir legendas curtas e diretas.', 'preferir legendas mais longas, com contexto.'],
  ['escrever por extenso, sem abreviacao de internet.', 'pode usar linguagem informal e abreviada.'],
];

export function resolverContradicoes(regras: RegraContada[]): RegraContada[] {
  const porChave = new Map(regras.map((r) => [r.regra.toLowerCase(), r]));

  for (const [a, b] of OPOSTAS) {
    const ra = porChave.get(a);
    const rb = porChave.get(b);
    if (!ra || !rb) continue;
    // Empate mantem a mais recente na ordem recebida (a que veio primeiro,
    // ja ordenada por peso) e descarta a outra.
    porChave.delete(ra.peso >= rb.peso ? b : a);
  }

  return regras.filter((r) => porChave.has(r.regra.toLowerCase()));
}

export const MAX_REGRAS_NO_PROMPT = 12;

/**
 * Monta o trecho que entra em todo prompt de geracao da marca.
 *
 * O corte em 12 nao e estetico: prompt gigante dilui a instrucao principal
 * e o modelo passa a ignorar tudo por igual. Entram as mais observadas.
 */
export function regrasParaPrompt(regras: RegraContada[], max = MAX_REGRAS_NO_PROMPT): string {
  const escolhidas = resolverContradicoes([...regras].sort((a, b) => b.peso - a.peso)).slice(0, max);
  if (escolhidas.length === 0) return '';
  return `Regras aprendidas com as correcoes desta marca (siga todas):\n${escolhidas
    .map((r) => `- ${r.regra}`)
    .join('\n')}`;
}

// --- Autonomia ---

/**
 * O post pode ir ao ar sem aprovacao?
 *
 * E como se delega a um funcionario de verdade: comeca supervisionado e
 * ganha alcada por area. O padrao (lista vazia) e pedir aprovacao de tudo —
 * publicar sozinho precisa ser escolha explicita, nunca o default.
 */
export function podePublicarSozinho(pilar: string | null | undefined, pilaresLiberados: string[]): boolean {
  if (!pilar) return false;
  return (pilaresLiberados || []).includes(pilar);
}

/**
 * O que fazer com um post que ninguem aprovou e cuja hora chegou.
 *
 * Grade travada por cliente ausente e o motivo numero 1 de churn; publicar
 * promocao sem aprovacao e o motivo numero 1 de briga. A saida e depender
 * do pilar, nao de uma regra unica.
 */
export function decidirSemAprovacao(
  pilar: string | null | undefined,
  pilaresLiberados: string[],
): 'publicar' | 'adiar' {
  return podePublicarSozinho(pilar, pilaresLiberados) ? 'publicar' : 'adiar';
}

// --- Acesso ao banco ---

/** Aprende com uma edicao e devolve quantas regras novas entraram. */
export async function aprenderComEdicao(brandId: string, original: string, editado: string): Promise<number> {
  const observadas = diferencasObservaveis(original, editado);
  if (observadas.length === 0) return 0;

  let novas = 0;
  for (const regra of observadas) {
    const existente = await prisma.brandRule.findFirst({ where: { brandId, regra } });
    if (existente) {
      await prisma.brandRule.update({ where: { id: existente.id }, data: { peso: { increment: 1 } } });
    } else {
      await prisma.brandRule.create({ data: { brandId, regra, origem: 'edicao' } });
      novas++;
    }
  }
  return novas;
}

/** Trecho de estilo pronto para colar no prompt de geracao. */
export async function promptDaMarca(brandId?: string | null): Promise<string> {
  if (!brandId) return '';
  const regras = await prisma.brandRule
    .findMany({ where: { brandId, ativa: true }, orderBy: { peso: 'desc' }, take: 30 })
    .catch(() => []);
  return regrasParaPrompt(regras.map((r) => ({ regra: r.regra, peso: r.peso })));
}

/** Registra uma decisao automatica no diario de bordo. */
export async function registrarDecisao(params: {
  userId: string;
  ator: string;
  acao: string;
  justificativa?: string;
  postId?: string | null;
  brandId?: string | null;
}): Promise<void> {
  // O diario nunca pode derrubar a acao que ele esta registrando.
  await prisma.agentLog.create({ data: { ...params } }).catch(() => {});
}
