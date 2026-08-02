import { Pilar } from './autopilot.service';

/**
 * Equilibrio dos pilares de conteudo.
 *
 * Perfil que so vende cansa e perde alcance; perfil que so ensina nao paga
 * a conta. Aqui medimos a mistura real contra a desejada e apontamos o
 * desvio antes que ele vire queda de resultado.
 *
 * Logica pura, testada em pillars.test.ts.
 */

/**
 * Infere o pilar pela legenda, para posts que nao nasceram no piloto
 * automatico e por isso nao tem o campo preenchido.
 *
 * A ordem importa: venda vence as outras. Um post que ensina algo E chama
 * para comprar e, na pratica, um post de venda — e classificar como
 * "educar" faria a analise dizer que a conta vende pouco quando nao vende.
 */
export function classificarPilar(caption?: string | null): Pilar {
  const t = (caption || '').toLowerCase();
  if (!t.trim()) return 'engajar';

  // Fronteira escrita a mao em vez de \b: no JavaScript, \b usa \w, que NAO
  // inclui letra acentuada. Por isso \bú nunca casa e "Últimas unidades"
  // escapava. Em portugues isso atinge qualquer termo iniciado por acento,
  // entao usamos "inicio da string ou caractere que nao e letra", com a
  // flag u para o \p{L} valer.
  const vender = /(?:^|[^\p{L}])(?:compr|promo|desconto|oferta|pre[çc]o|link na bio|garanta|aproveite|[úu]ltimas unidades|frete|pedido|encomend|or[çc]amento|vaga)/u;
  const educar = /(?:^|[^\p{L}])(?:dica|como|passo a passo|aprenda|voc[êe] sabia|saiba|entenda|erro|mito|guia|tutorial|por que|diferen[çc]a entre)/u;

  if (vender.test(t)) return 'vender';
  if (educar.test(t)) return 'educar';
  return 'engajar';
}

export interface Equilibrio {
  atual: Record<Pilar, number>;
  /** Percentual real de cada pilar. */
  percentual: Record<Pilar, number>;
  /** Percentual desejado, derivado dos pesos da marca. */
  alvo: Record<Pilar, number>;
  /** Diferenca em pontos percentuais: positivo = acima do alvo. */
  desvio: Record<Pilar, number>;
  total: number;
  /** Aviso quando algum pilar desvia demais. Vazio = equilibrado. */
  alertas: string[];
}

/** Desvio a partir do qual vale avisar, em pontos percentuais. */
export const TOLERANCIA = 15;

const NOMES: Record<Pilar, string> = { vender: 'venda', educar: 'conteúdo educativo', engajar: 'engajamento' };

/**
 * Compara a mistura real com a desejada.
 *
 * Os pesos viram percentual aqui: assim o usuario pode escrever 3/4/3 ou
 * 30/40/30 e o resultado e o mesmo.
 */
export function analisarEquilibrio(
  posts: Array<{ pilar?: string | null; caption?: string | null }>,
  mix: Record<Pilar, number>,
): Equilibrio {
  const atual: Record<Pilar, number> = { vender: 0, educar: 0, engajar: 0 };
  for (const p of posts) {
    const pilar = (p.pilar as Pilar) || classificarPilar(p.caption);
    if (pilar in atual) atual[pilar]++;
  }

  const total = posts.length;
  const somaMix = Math.max(1, mix.vender + mix.educar + mix.engajar);

  const alvo: Record<Pilar, number> = {
    vender: Math.round((mix.vender / somaMix) * 100),
    educar: Math.round((mix.educar / somaMix) * 100),
    engajar: Math.round((mix.engajar / somaMix) * 100),
  };

  const percentual: Record<Pilar, number> = {
    vender: total ? Math.round((atual.vender / total) * 100) : 0,
    educar: total ? Math.round((atual.educar / total) * 100) : 0,
    engajar: total ? Math.round((atual.engajar / total) * 100) : 0,
  };

  const desvio: Record<Pilar, number> = {
    vender: percentual.vender - alvo.vender,
    educar: percentual.educar - alvo.educar,
    engajar: percentual.engajar - alvo.engajar,
  };

  const alertas: string[] = [];
  // Poucos posts nao dizem nada: 2 posts sempre "desviam" muito, e alertar
  // ali seria ruido que treina o usuario a ignorar o aviso.
  if (total >= 5) {
    for (const p of ['vender', 'educar', 'engajar'] as Pilar[]) {
      if (desvio[p] > TOLERANCIA) {
        alertas.push(`Você está postando ${desvio[p]} pontos acima do planejado em ${NOMES[p]}.`);
      } else if (desvio[p] < -TOLERANCIA) {
        alertas.push(`Está faltando ${Math.abs(desvio[p])} pontos de ${NOMES[p]} no seu mix.`);
      }
    }
  }

  return { atual, percentual, alvo, desvio, total, alertas };
}
