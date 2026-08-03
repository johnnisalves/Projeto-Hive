/**
 * Nota prevista de engajamento: evitar o erro ANTES de publicar.
 *
 * A diferenca para o que o mercado faz: a nota sai do historico da PROPRIA
 * conta, nao de "melhores praticas" genericas. Carrossel performar melhor
 * que Reels e verdade em algumas contas e mentira em outras — dizer o
 * contrario do que os numeros do usuario mostram destroi a confianca na
 * ferramenta inteira.
 */

import { chamadasDoNicho } from './niche.service';

export interface HistoricoPost {
  caption: string | null;
  publishMode: string;
  mediaType: string;
  publishedAt: Date;
  /** Curtidas + comentarios. Zero significa "sem dado", nao "sem engajamento". */
  engajamento: number;
}

export interface PostParaAvaliar {
  caption: string;
  hashtags: string[];
  publishMode: string;
  mediaType: string;
  scheduledAt: Date;
}

export interface Sinal {
  texto: string;
  /** Quanto mexe na nota, de -25 a +25. */
  impacto: number;
}

/**
 * Historico minimo para arriscar uma previsao.
 *
 * Abaixo disso a "media da conta" e ruido: tres posts com um viral no meio
 * fariam a nota condenar tudo que nao for viral. Preferimos dizer que ainda
 * nao da a inventar um numero.
 */
export const MINIMO_HISTORICO = 8;

/** So conta post que TEM metrica. Zero por falta de coleta viraria media falsa. */
function comMetrica(historico: HistoricoPost[]): HistoricoPost[] {
  return (historico || []).filter((h) => h.engajamento > 0);
}

export function mediaGeral(historico: HistoricoPost[]): number {
  const uteis = comMetrica(historico);
  if (uteis.length === 0) return 0;
  return uteis.reduce((s, h) => s + h.engajamento, 0) / uteis.length;
}

/** Media por formato (REELS, FEED, STORIES) — a comparacao que mais importa. */
export function mediaPorFormato(historico: HistoricoPost[]): Record<string, { media: number; posts: number }> {
  const acc: Record<string, { soma: number; posts: number }> = {};
  for (const h of comMetrica(historico)) {
    const k = h.publishMode || 'FEED';
    acc[k] = acc[k] || { soma: 0, posts: 0 };
    acc[k].soma += h.engajamento;
    acc[k].posts++;
  }
  const out: Record<string, { media: number; posts: number }> = {};
  for (const [k, v] of Object.entries(acc)) out[k] = { media: v.soma / v.posts, posts: v.posts };
  return out;
}

export function mediaPorHora(historico: HistoricoPost[]): Record<number, { media: number; posts: number }> {
  const acc: Record<number, { soma: number; posts: number }> = {};
  for (const h of comMetrica(historico)) {
    const hora = new Date(h.publishedAt).getHours();
    acc[hora] = acc[hora] || { soma: 0, posts: 0 };
    acc[hora].soma += h.engajamento;
    acc[hora].posts++;
  }
  const out: Record<number, { media: number; posts: number }> = {};
  for (const [k, v] of Object.entries(acc)) out[Number(k)] = { media: v.soma / v.posts, posts: v.posts };
  return out;
}

export function temPergunta(caption: string): boolean {
  return /\?/.test(caption || '');
}

/**
 * Chamada para acao.
 *
 * Sem \b nas alternativas acentuadas: em JavaScript \b usa [A-Za-z0-9_], e
 * "comenta" logo apos um acento nao casaria. Foi um bug real neste projeto.
 */
export function temChamada(caption: string, nicho?: string | null): boolean {
  // Normaliza o ACENTO antes de comparar. Sem isso "peça" (a forma que a
  // pessoa realmente escreve) nao casava com "peca", e a nota PENALIZAVA
  // uma legenda que tem chamada para acao — o erro mais irritante possivel
  // numa feature que existe para dar conselho.
  const t = (caption || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
  // Os termos vem do RAMO da empresa: "marque sua consulta" e chamada numa
  // clinica e nao existe numa pizzaria. As alternativas ficam SEM acento de
  // proposito, porque o texto ja chegou normalizado.
  const termos = chamadasDoNicho(nicho).map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`(?:^|[^\\p{L}])(${termos.join('|')})`, 'u').test(t);
}

export function palavras(caption: string): number {
  return ((caption || '').trim().match(/\S+/g) || []).length;
}

/**
 * A nota, e o porque dela.
 *
 * Nota sem motivo e inutil: o usuario nao aprende nada e nao sabe o que
 * mudar. Cada sinal devolve o texto que explica o ajuste.
 */
export function preverNota(post: PostParaAvaliar, historico: HistoricoPost[]): {
  nota: number | null;
  motivos: Sinal[];
  base: string;
} {
  const uteis = comMetrica(historico);

  if (uteis.length < MINIMO_HISTORICO) {
    return {
      nota: null,
      motivos: [],
      base: `Preciso de pelo menos ${MINIMO_HISTORICO} posts com métrica para dar uma nota confiável. `
        + `Tenho ${uteis.length} até agora.`,
    };
  }

  const geral = mediaGeral(uteis);
  const motivos: Sinal[] = [];
  let nota = 60;

  // Formato: so opina com amostra suficiente. Um unico Reels que viralizou
  // faria a nota mandar publicar so Reels para sempre.
  const porFormato = mediaPorFormato(uteis);
  const desteFormato = porFormato[post.publishMode];
  if (desteFormato && desteFormato.posts >= 3) {
    const razao = desteFormato.media / geral;
    if (razao >= 1.2) {
      const impacto = Math.min(20, Math.round((razao - 1) * 40));
      nota += impacto;
      motivos.push({ texto: `${post.publishMode} rende ${Math.round((razao - 1) * 100)}% acima da média nesta conta.`, impacto });
    } else if (razao <= 0.8) {
      const impacto = -Math.min(20, Math.round((1 - razao) * 40));
      nota += impacto;
      motivos.push({ texto: `${post.publishMode} rende ${Math.round((1 - razao) * 100)}% abaixo da média nesta conta.`, impacto });
    }
  }

  const hora = post.scheduledAt.getHours();
  const porHora = mediaPorHora(uteis);
  const destaHora = porHora[hora];
  if (destaHora && destaHora.posts >= 2) {
    const razao = destaHora.media / geral;
    if (razao >= 1.2) {
      nota += 10;
      motivos.push({ texto: `Às ${hora}h seus posts rendem acima da média.`, impacto: 10 });
    } else if (razao <= 0.7) {
      nota -= 12;
      motivos.push({ texto: `Às ${hora}h seus posts costumam render menos. Considere outro horário.`, impacto: -12 });
    }
  }

  if (temPergunta(post.caption)) {
    nota += 8;
    motivos.push({ texto: 'A pergunta na legenda puxa comentário, que é o que o algoritmo mais premia.', impacto: 8 });
  }

  if (temChamada(post.caption)) {
    nota += 7;
    motivos.push({ texto: 'Tem chamada para ação.', impacto: 7 });
  } else {
    nota -= 8;
    motivos.push({ texto: 'Falta uma chamada para ação — diga o que a pessoa deve fazer depois de ler.', impacto: -8 });
  }

  const p = palavras(post.caption);
  if (p < 5) {
    nota -= 10;
    motivos.push({ texto: 'Legenda muito curta para o algoritmo entender o assunto do post.', impacto: -10 });
  } else if (p > 150) {
    nota -= 6;
    motivos.push({ texto: 'Legenda longa demais: o corte do "mais" esconde o essencial.', impacto: -6 });
  }

  const tags = (post.hashtags || []).length;
  if (tags === 0) {
    nota -= 6;
    motivos.push({ texto: 'Sem hashtag nenhuma, o post só alcança quem já te segue.', impacto: -6 });
  } else if (tags > 25) {
    nota -= 8;
    motivos.push({ texto: 'Hashtag demais parece spam e o alcance cai.', impacto: -8 });
  }

  // O corte nas pontas nao e cosmetico: nota 0 ou 100 promete certeza que
  // uma previsao estatistica nao tem.
  nota = Math.max(5, Math.min(95, Math.round(nota)));

  return {
    nota,
    motivos: motivos.sort((a, b) => Math.abs(b.impacto) - Math.abs(a.impacto)),
    base: `Comparado com ${uteis.length} posts seus que têm métrica.`,
  };
}
