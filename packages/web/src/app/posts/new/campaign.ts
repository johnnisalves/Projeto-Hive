/**
 * Planejamento de campanha: varias imagens viram varios posts agendados.
 *
 * Logica pura, sem React e sem rede, para poder ser testada direto no Node
 * (ver campaign.test.ts). Errar data ou horario aqui significa post saindo
 * na madrugada ou no passado — coisa que so apareceria em producao.
 */

export type Cadence = 1 | 2 | 3 | 6;

/**
 * Horarios por ritmo, em hora cheia local.
 *
 * Sao as janelas de maior movimento no Brasil. Quanto mais posts por dia,
 * mais espalhados — publicar 6 vezes em 3 horas queima o alcance.
 */
export const CADENCE_SLOTS: Record<Cadence, number[]> = {
  1: [12],
  2: [9, 18],
  3: [9, 12, 18],
  6: [8, 10, 12, 15, 18, 21],
};

export const CADENCE_LABEL: Record<Cadence, string> = {
  1: '1 por dia',
  2: '2 por dia',
  3: '3 por dia',
  6: '6 por dia',
};

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
  const slots = CADENCE_SLOTS[perDay];
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
