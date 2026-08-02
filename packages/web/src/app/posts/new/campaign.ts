/**
 * Planejamento de campanha: varias imagens viram varios posts agendados.
 *
 * Logica pura, sem React e sem rede, para poder ser testada direto no Node
 * (ver campaign.test.ts). Errar data ou horario aqui significa post saindo
 * na madrugada ou no passado — coisa que so apareceria em producao.
 */

export type Cadence = number;

/** Limite da barra. Acima disso vira spam e os horarios se atropelam. */
export const MAX_CADENCE = 8;

/**
 * Horarios escolhidos a mao para os ritmos comuns, em hora cheia local.
 * Sao as janelas de maior movimento no Brasil, e ficam bem distribuidas.
 */
const CURATED: Record<number, number[]> = {
  1: [12],
  2: [9, 18],
  3: [9, 12, 18],
  4: [9, 12, 15, 19],
  5: [8, 11, 14, 17, 20],
  6: [8, 10, 12, 15, 18, 21],
};

/**
 * Horarios de um ritmo qualquer.
 *
 * Para 7 ou 8 por dia nao ha curadoria: espalhamos igualmente entre 8h e
 * 21h. Publicar varias vezes seguidas na mesma faixa queima o alcance —
 * o Instagram mostra os posts para grupos parecidos de seguidores.
 */
export function slotsFor(perDay: number): number[] {
  const n = Math.max(1, Math.min(Math.round(perDay), MAX_CADENCE));
  if (CURATED[n]) return CURATED[n];

  const inicio = 8;
  const fim = 21;
  const passo = (fim - inicio) / (n - 1);
  const horas = Array.from({ length: n }, (_, i) => Math.round(inicio + i * passo));
  // Arredondar pode gerar hora repetida; sem isso o dia perderia um slot.
  return Array.from(new Set(horas)).sort((a, b) => a - b);
}

export function cadenceLabel(perDay: number): string {
  return perDay === 1 ? '1 por dia' : `${perDay} por dia`;
}

/**
 * Ritmo recomendado para a quantidade de imagens.
 *
 * O criterio e presenca sem cansar: publicar demais no mesmo dia derruba o
 * alcance dos proprios posts, porque eles competem entre si pelo mesmo
 * publico. Ate uma semana de conteudo, 1 por dia; acima disso subimos o
 * ritmo para a campanha nao se arrastar por mais de duas semanas.
 */
export function recommendCadence(count: number): { perDay: number; why: string } {
  if (count <= 7) {
    return { perDay: 1, why: 'Uma por dia mantém presença diária sem os posts competirem entre si.' };
  }
  if (count <= 16) {
    return { perDay: 2, why: 'Duas por dia cobrem tudo em cerca de uma semana, com folga entre elas.' };
  }
  if (count <= 30) {
    return { perDay: 3, why: 'Três por dia evitam que a campanha se arraste por mais de duas semanas.' };
  }
  return { perDay: 4, why: 'São muitas imagens: quatro por dia mantêm a campanha em prazo razoável.' };
}

/**
 * Monta as datas de publicacao.
 *
 * @param count quantas imagens (= quantos posts)
 * @param perDay ritmo escolhido
 * @param from momento de referencia; o padrao e agora
 *
 * Regra principal: nunca devolver horario no passado. Se o slot das 9h ja
 * passou, a campanha comeca no proximo slot livre — hoje mesmo se houver,
 * senao amanha.
 */
export function buildCampaignSchedule(count: number, perDay: Cadence, from: Date = new Date()): Date[] {
  const slots = slotsFor(perDay);
  const dates: Date[] = [];

  // Comeca no dia de `from`, zerado, e caminha dia a dia.
  const day = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  let dayOffset = 0;

  while (dates.length < count) {
    for (const hour of slots) {
      if (dates.length >= count) break;
      const when = new Date(day);
      when.setDate(day.getDate() + dayOffset);
      when.setHours(hour, 0, 0, 0);
      // Slot que ja passou nao serve: o agendador publicaria na hora.
      if (when.getTime() <= from.getTime()) continue;
      dates.push(when);
    }
    dayOffset++;
    // Trava de seguranca: 365 dias cobrem qualquer campanha real e evitam
    // loop infinito se `slots` vier vazio por engano.
    if (dayOffset > 365) break;
  }

  return dates;
}

/** Quantos dias a campanha vai durar, para mostrar no resumo. */
export function campaignSpanDays(dates: Date[]): number {
  if (dates.length === 0) return 0;
  const first = dates[0];
  const last = dates[dates.length - 1];
  const dayOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((dayOf(last) - dayOf(first)) / 86_400_000) + 1;
}

/** "seg, 04/08 às 09:00" — formato curto para a grade de revisao. */
export function formatSlot(d: Date): string {
  const dia = d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return `${dia} às ${hora}`;
}

/** Valor para <input type="datetime-local">, que nao aceita ISO com fuso. */
export function toDatetimeLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
