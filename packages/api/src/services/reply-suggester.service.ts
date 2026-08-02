import { prisma } from '../config/database';
import { callText } from './caption.service';

/**
 * Rascunho de resposta para comentario, no tom da marca.
 *
 * A resposta NUNCA e enviada sozinha. Isto gera texto; publicar continua
 * sendo um clique humano. Resposta automatica em rede social erra em
 * publico, e o estrago e maior que o tempo economizado.
 */

/** Classifica a intencao para a resposta nao sair genérica. */
export type Intencao = 'preco' | 'duvida' | 'elogio' | 'reclamacao' | 'interesse' | 'outro';

/**
 * Detecta a intencao por palavra-chave antes de chamar a IA.
 *
 * POR QUE ANTES: economiza chamada nos casos obvios e, principalmente,
 * garante que "quanto custa" sempre caia na regra de preco — a IA sozinha
 * as vezes trata como duvida generica e responde sem chamar para a venda.
 */
export function detectarIntencao(texto: string): Intencao {
  const t = (texto || '').toLowerCase();

  if (/\b(pre[çc]o|quanto custa|quanto (?:e|é|fica|sai)|valor|or[çc]amento|quanto)\b/.test(t)) return 'preco';
  if (/\b(p[ée]ssimo|horr[íi]vel|ruim|demorou|n[ãa]o gostei|decep|reclama|problema|defeito)\b/.test(t)) return 'reclamacao';
  // Sem \b no fim dos radicais: "compr" precisa casar dentro de "comprar",
  // "comprando", "compro". Com a borda, "como faço para comprar?" caia como
  // duvida generica e a resposta nao chamava para a venda.
  if (/\b(quero|tenho interesse|como fa[çc]o|onde compro|me chama)|compr(?:a|o|ar|ando)|dispon[íi]ve/.test(t)) return 'interesse';
  if (/\b(amei|adorei|lindo|linda|maravilh|top|perfeito|show|parab[ée]ns|melhor)\b/.test(t)) return 'elogio';
  if (/\?|\b(como|qual|quando|onde|tem|voc[êe]s fazem)\b/.test(t)) return 'duvida';
  return 'outro';
}

/** Orientacao especifica por intencao — o que a resposta precisa fazer. */
const ORIENTACAO: Record<Intencao, string> = {
  preco: 'A pessoa perguntou preço. Não invente valor nenhum. Agradeça, diga que vai passar os detalhes no direct e convide a chamar.',
  duvida: 'A pessoa tem uma dúvida. Responda de forma útil e curta, sem inventar informação que você não tem.',
  elogio: 'A pessoa elogiou. Agradeça com naturalidade e calor humano, sem parecer resposta automática.',
  reclamacao: 'A pessoa reclamou. Reconheça o incômodo com empatia, sem justificar nem discutir, e chame para resolver no direct.',
  interesse: 'A pessoa demonstrou interesse em comprar. Confirme a disponibilidade e facilite o próximo passo, chamando para o direct.',
  outro: 'Responda de forma simpática e breve, mantendo a conversa aberta.',
};

export interface SugestaoResposta {
  texto: string;
  intencao: Intencao;
  /** true quando a IA nao respondeu e caimos num texto seguro. */
  fallback: boolean;
}

/**
 * Gera o rascunho.
 *
 * Se a IA falhar, devolvemos um texto neutro e seguro em vez de erro: a
 * tela fica utilizavel, e o usuario edita. Erro aqui nao pode travar o
 * atendimento.
 */
export async function sugerirResposta(
  userId: string,
  params: { comentario: string; autor?: string; brandId?: string },
): Promise<SugestaoResposta> {
  const intencao = detectarIntencao(params.comentario);

  let marca = '';
  if (params.brandId) {
    const b = await prisma.brand.findFirst({ where: { id: params.brandId, userId } });
    if (b) {
      marca = [
        `Nome do negócio: ${b.name}`,
        b.description ? `Sobre: ${b.description}` : '',
        b.voiceTone ? `Tom de voz: ${b.voiceTone}` : '',
        b.products?.length ? `Produtos: ${b.products.join(', ')}` : '',
        b.phone ? `Contato: ${b.phone}` : '',
      ].filter(Boolean).join('\n');
    }
  }

  const prompt = [
    'Você responde comentários do Instagram de um negócio brasileiro.',
    marca && `\nDADOS DO NEGÓCIO:\n${marca}`,
    `\nCOMENTÁRIO${params.autor ? ` de @${params.autor}` : ''}:\n"${params.comentario}"`,
    `\nORIENTAÇÃO: ${ORIENTACAO[intencao]}`,
    '\nREGRAS:',
    '- No máximo 2 frases curtas.',
    '- Português do Brasil, falado, sem formalidade de e-mail.',
    '- No máximo 1 emoji, e só se combinar.',
    '- Nunca invente preço, prazo, endereço ou informação que não está acima.',
    '- Não use hashtag nem assinatura.',
    '\nResponda SOMENTE com o texto da resposta, sem aspas e sem explicação.',
  ].filter(Boolean).join('\n');

  try {
    const bruto = await callText(prompt);
    const texto = (bruto || '')
      .trim()
      .replace(/^["'`]+|["'`]+$/g, '')   // o modelo as vezes devolve entre aspas
      .split('\n')[0]                     // e as vezes explica na linha seguinte
      .trim();

    if (texto.length >= 3) return { texto, intencao, fallback: false };
  } catch {
    // cai no fallback abaixo
  }

  return { texto: respostaSegura(intencao), intencao, fallback: true };
}

/** Texto neutro para quando a IA nao responde. Nunca promete nada. */
function respostaSegura(intencao: Intencao): string {
  switch (intencao) {
    case 'preco': return 'Oi! Te passo os valores no direct, pode chamar lá 😊';
    case 'reclamacao': return 'Sinto muito por isso. Me chama no direct que a gente resolve.';
    case 'elogio': return 'Muito obrigado! Ficamos felizes demais 😊';
    case 'interesse': return 'Que bom! Me chama no direct que te ajudo.';
    default: return 'Oi! Obrigado pela mensagem, me chama no direct que te respondo certinho.';
  }
}
