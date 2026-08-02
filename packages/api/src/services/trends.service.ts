import { prisma } from '../config/database';
import { searchHashtag } from './instagram.service';

/**
 * Radar de tendencias por hashtag.
 *
 * O LIMITE QUE MANDA AQUI: o Meta permite 30 hashtags DISTINTAS por janela
 * de 7 dias, por conta. Estourar nao devolve erro amigavel — bloqueia a
 * consulta de hashtag da conta inteira ate a janela girar. Por isso a cota
 * e verificada ANTES de qualquer chamada, e nao depois.
 *
 * Consultar de novo uma tag ja consultada na janela NAO gasta cota nova.
 */

export const COTA_SEMANAL = 30;
export const JANELA_DIAS = 7;

export interface Cota {
  usadas: number;
  restantes: number;
  /** Tags ja consultadas na janela: repetir essas e de graca. */
  jaConsultadas: string[];
}

export function normalizarTag(bruta: string): string {
  return (bruta || '').trim().replace(/^#/, '').toLowerCase().replace(/[^a-z0-9_]/g, '');
}

/**
 * Situacao da cota a partir das consultas registradas.
 *
 * Conta DISTINTOS, nao linhas: consultar #pizza cinco vezes na semana gasta
 * uma posicao, nao cinco.
 */
export function calcularCota(
  consultas: Array<{ tag: string; queriedAt: Date }>,
  hoje = new Date(),
): Cota {
  const limite = hoje.getTime() - JANELA_DIAS * 86_400_000;
  const naJanela = consultas.filter((c) => new Date(c.queriedAt).getTime() >= limite);
  const distintas = Array.from(new Set(naJanela.map((c) => c.tag)));

  return {
    usadas: distintas.length,
    restantes: Math.max(0, COTA_SEMANAL - distintas.length),
    jaConsultadas: distintas,
  };
}

/**
 * Separa o que pode ser consultado do que estouraria a cota.
 *
 * Tags ja vistas na janela passam sempre, porque nao custam nada. As novas
 * entram ate o limite; o resto e devolvido como bloqueado, com o motivo,
 * em vez de ser silenciosamente ignorado.
 */
export function separarPorCota(pedidas: string[], cota: Cota): { liberadas: string[]; bloqueadas: string[] } {
  const jaVistas = new Set(cota.jaConsultadas);
  const liberadas: string[] = [];
  const bloqueadas: string[] = [];
  let orcamento = cota.restantes;

  for (const tag of pedidas) {
    if (jaVistas.has(tag)) { liberadas.push(tag); continue; }
    if (orcamento > 0) { liberadas.push(tag); orcamento--; continue; }
    bloqueadas.push(tag);
  }
  return { liberadas, bloqueadas };
}

export interface ResultadoTag {
  tag: string;
  posts: number;
  mediaCurtidas: number;
  topPost?: { permalink?: string; caption?: string; likes?: number };
  erro?: string;
}

/** Consulta as hashtags respeitando a cota. */
export async function consultarTendencias(userId: string, tagsBrutas: string[]): Promise<{
  resultados: ResultadoTag[];
  bloqueadas: string[];
  cota: Cota;
}> {
  const pedidas = Array.from(new Set(tagsBrutas.map(normalizarTag).filter((t) => t.length >= 2)));

  const desde = new Date(Date.now() - JANELA_DIAS * 86_400_000);
  const consultas = await prisma.hashtagQuery.findMany({
    where: { userId, queriedAt: { gte: desde } },
    select: { tag: true, queriedAt: true },
  });

  const cota = calcularCota(consultas);
  const { liberadas, bloqueadas } = separarPorCota(pedidas, cota);

  const resultados: ResultadoTag[] = [];
  for (const tag of liberadas) {
    try {
      const r = await searchHashtag(userId, tag);
      if (!r.disponivel) {
        resultados.push({ tag, posts: 0, mediaCurtidas: 0, erro: r.motivo });
        continue;
      }

      const curtidas = r.items.map((i) => i.likes || 0);
      const media = curtidas.length ? Math.round(curtidas.reduce((a, b) => a + b, 0) / curtidas.length) : 0;
      const melhor = [...r.items].sort((a, b) => (b.likes || 0) - (a.likes || 0))[0];

      resultados.push({
        tag,
        posts: r.items.length,
        mediaCurtidas: media,
        topPost: melhor && { permalink: melhor.permalink, caption: melhor.caption?.slice(0, 140), likes: melhor.likes },
      });

      // Registra so quando a consulta REALMENTE aconteceu: gravar antes
      // gastaria cota por uma chamada que falhou.
      await prisma.hashtagQuery.create({ data: { userId, tag } }).catch(() => {});
    } catch (err) {
      resultados.push({ tag, posts: 0, mediaCurtidas: 0, erro: (err as Error).message });
    }
  }

  // Recalcula depois das gravacoes para a tela mostrar o saldo atual.
  const atualizadas = await prisma.hashtagQuery.findMany({
    where: { userId, queriedAt: { gte: desde } },
    select: { tag: true, queriedAt: true },
  });

  return { resultados, bloqueadas, cota: calcularCota(atualizadas) };
}
