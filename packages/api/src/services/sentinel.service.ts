/**
 * Sentinela: o que acontece DEPOIS de publicar.
 *
 * Duas coisas que um social media humano faria e nenhuma ferramenta de
 * agendamento faz:
 *
 * 1. CRISE — as 23h de sabado um post azeda (preco errado, reclamacao
 *    virando bola de neve). O humano para de postar promocao. A ferramenta
 *    continua despejando a grade em cima do incendio.
 * 2. PROVA SOCIAL — o elogio espontaneo morre esquecido nos comentarios,
 *    quando e o conteudo que mais converte para negocio local.
 */

import { elogiosDoNicho } from './niche.service';

export interface ComentarioObservado {
  id: string;
  texto: string;
  criadoEm: Date;
  /** 'positivo' | 'negativo' | 'neutro' — vem da classificacao do inbox. */
  sentimento?: string;
}

// --- Deteccao de crise ---

/** Janela curta de propósito: crise se mede em minutos, nao em dias. */
export const JANELA_CRISE_MIN = 90;
/** Abaixo disso, e uma pessoa mal-humorada, nao uma crise. */
export const MINIMO_COMENTARIOS = 5;
/** Proporcao de negativos que caracteriza incendio. */
export const PROPORCAO_CRISE = 0.5;

export function naJanela(c: ComentarioObservado, agora: Date, minutos = JANELA_CRISE_MIN): boolean {
  return agora.getTime() - new Date(c.criadoEm).getTime() <= minutos * 60_000;
}

/**
 * Tem crise acontecendo?
 *
 * Exige VOLUME e PROPORCAO ao mesmo tempo. So proporcao dispararia com dois
 * comentarios ruins num post morto; so volume dispararia num post que
 * viralizou bem e naturalmente atraiu alguns criticos.
 */
export function detectarCrise(
  comentarios: ComentarioObservado[],
  agora = new Date(),
): { crise: boolean; negativos: number; total: number; proporcao: number; motivo?: string } {
  const recentes = (comentarios || []).filter((c) => naJanela(c, agora));
  const negativos = recentes.filter((c) => c.sentimento === 'negativo').length;
  const total = recentes.length;
  const proporcao = total > 0 ? negativos / total : 0;

  if (total < MINIMO_COMENTARIOS) {
    return { crise: false, negativos, total, proporcao };
  }
  if (proporcao < PROPORCAO_CRISE) {
    return { crise: false, negativos, total, proporcao };
  }

  return {
    crise: true,
    negativos,
    total,
    proporcao,
    motivo: `${negativos} de ${total} comentários na última hora e meia são negativos.`,
  };
}

/**
 * O que pausar quando a crise e detectada.
 *
 * NAO pausa tudo: conteudo de "educar" seguir no ar e inofensivo, e travar
 * a conta inteira por um comentario ruim seria pior que o problema. O que
 * nao pode sair no meio de um incendio e promocao — soa como se a marca
 * estivesse ignorando a reclamacao.
 */
export const PILARES_SENSIVEIS = ['vender'];

export function devePausar(pilar: string | null | undefined): boolean {
  // Post sem pilar definido tambem pausa: nao da para garantir que nao e
  // promocao, e errar para o lado cauteloso e barato aqui.
  return !pilar || PILARES_SENSIVEIS.includes(pilar);
}

// --- Prova social ---

/**
 * Sinais de elogio de verdade.
 *
 * O texto e COMPARADO SEM ACENTO (ver `semAcento`). Escrever as alternativas
 * acentuadas aqui nao resolveria: o usuario escreve "otimo", "ótimo" e
 * "OTIMO", e listar cada variante deixaria buracos. Normalizar os dois lados
 * cobre todas de uma vez.
 *
 * Tambem nao usa \b: em JavaScript ele enxerga so [A-Za-z0-9_], entao uma
 * palavra logo apos caractere acentuado nunca casaria.
 */
/**
 * Monta o detector de elogio a partir do RAMO da empresa.
 *
 * O padrao antigo era fixo e cheio de termo de comida ("delicioso"): numa
 * clinica ou num escritorio nunca casava, e a fabrica de prova social
 * ficava muda. Agora cada ramo traz os proprios termos por cima dos gerais.
 */
function regexDeElogio(nicho?: string | null): RegExp {
  const termos = elogiosDoNicho(nicho).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`(?:^|[^\\p{L}])(${termos.join('|')})`, 'iu');
}

/** Tira acento para comparar, mantendo a letra. */
function semAcento(s: string): string {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Coisas que parecem elogio mas nao servem como depoimento publico. */
const DESCARTAR = /(?:^|[^\p{L}])(kkk+|rs+|haha|❤️?$|👏$)/iu;

export const MIN_PALAVRAS_DEPOIMENTO = 3;
export const MAX_CARACTERES_DEPOIMENTO = 140;

/**
 * Esse comentario vira arte de depoimento?
 *
 * "top" e elogio mas nao e depoimento — numa arte, fica ridiculo. Exigimos
 * uma frase minima, senao a fabrica de prova social produz constrangimento.
 */
export function elegivelComoDepoimento(c: ComentarioObservado, nicho?: string | null): boolean {
  const bruto = (c.texto || '').trim();
  if (!bruto) return false;
  if (bruto.length > MAX_CARACTERES_DEPOIMENTO * 2) return false;
  if (DESCARTAR.test(bruto)) return false;
  if (c.sentimento === 'negativo') return false;

  // Avalia o texto JA LIMPO, que e o que vai para a arte. Julgar o texto
  // cru deixava passar comentarios que, depois de tirar @ e hashtag,
  // ficavam com uma palavra so — ou perdiam o proprio elogio, se ele
  // estava numa hashtag (#melhorpizzaria).
  const t = prepararDepoimento(bruto);
  if (!t) return false;

  const palavras = (t.match(/\S+/g) || []).length;
  if (palavras < MIN_PALAVRAS_DEPOIMENTO) return false;

  return regexDeElogio(nicho).test(semAcento(t));
}

/**
 * Limpa o comentario para caber na arte.
 *
 * Nunca reescreve o texto: um depoimento com palavra trocada e depoimento
 * falso, e o autor pode ver o post. So tira @, hashtag e corta no fim de
 * frase quando passa do limite.
 */
export function prepararDepoimento(texto: string): string {
  const limpo = (texto || '')
    .replace(/[@#][\p{L}0-9_.]+/gu, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (limpo.length <= MAX_CARACTERES_DEPOIMENTO) return limpo;

  // Corta no ultimo fim de frase que couber; sem isso o depoimento termina
  // no meio de uma palavra com reticencias, o que fica pior que nao ter.
  const cortado = limpo.slice(0, MAX_CARACTERES_DEPOIMENTO);
  const fim = Math.max(cortado.lastIndexOf('.'), cortado.lastIndexOf('!'), cortado.lastIndexOf('?'));
  if (fim > MAX_CARACTERES_DEPOIMENTO * 0.5) return cortado.slice(0, fim + 1);

  const espaco = cortado.lastIndexOf(' ');
  return `${cortado.slice(0, espaco > 0 ? espaco : MAX_CARACTERES_DEPOIMENTO)}...`;
}

/**
 * Ranqueia os melhores elogios da semana.
 *
 * Depoimento mais longo tende a ser mais especifico ("a melhor pizza de
 * Petrolina, massa fina do jeito certo") e converte mais que "muito bom".
 */
export function melhoresDepoimentos(
  comentarios: ComentarioObservado[],
  quantos = 3,
  nicho?: string | null,
): ComentarioObservado[] {
  return (comentarios || [])
    .filter((c) => elegivelComoDepoimento(c, nicho))
    .sort((a, b) => (b.texto || '').length - (a.texto || '').length)
    .slice(0, quantos);
}

// --- Verificacao pos-publicacao ---

/**
 * O post que dissemos ter publicado esta mesmo no ar?
 *
 * Falha silenciosa e o pior tipo: o painel diz PUBLISHED, o cliente abre o
 * perfil e nao ve nada, e a agencia descobre pelo WhatsApp do cliente.
 */
export async function confirmarNoAr(instagramId: string, token: string): Promise<boolean | null> {
  if (!instagramId) return null;
  const base = token.startsWith('EAA')
    ? 'https://graph.facebook.com/v21.0'
    : 'https://graph.instagram.com/v21.0';
  try {
    const r = await fetch(`${base}/${instagramId}?fields=id,permalink&access_token=${token}`);
    const j = (await r.json()) as any;
    if (j?.error) return false;
    return Boolean(j?.id);
  } catch {
    // Rede caiu: nao sabemos. Devolver false aqui geraria alarme falso.
    return null;
  }
}
