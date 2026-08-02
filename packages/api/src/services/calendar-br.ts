/**
 * Calendario comercial brasileiro.
 *
 * E a materia-prima do piloto automatico: sem datas, "gerar o mes" viraria
 * 30 posts genericos. Com elas, o conteudo encosta no que o publico ja esta
 * pensando naquela semana.
 *
 * Logica pura, sem banco e sem rede, para poder ser testada (calendar-br.test.ts).
 */

export interface DataComemorativa {
  /** 1-12 */
  mes: number;
  /** dia fixo do mes; ausente quando a data e movel */
  dia?: number;
  nome: string;
  /** Peso comercial: 3 = data forte de venda, 1 = data de conteudo leve */
  peso: 1 | 2 | 3;
  /** Ramos que mais aproveitam. Vazio = serve para qualquer negocio. */
  ramos?: string[];
}

/**
 * Datas fixas. A lista prioriza o que move venda no Brasil, nao efemeride
 * de calendario — "Dia do Cliente" vale mais para uma pizzaria do que
 * "Dia da Filosofia".
 */
export const DATAS_FIXAS: DataComemorativa[] = [
  { mes: 1, dia: 1, nome: 'Ano Novo', peso: 2 },
  { mes: 1, dia: 6, nome: 'Dia de Reis', peso: 1 },
  { mes: 2, dia: 14, nome: 'Dia de São Valentim (internacional)', peso: 1 },
  { mes: 3, dia: 8, nome: 'Dia Internacional da Mulher', peso: 3 },
  { mes: 3, dia: 15, nome: 'Dia do Consumidor', peso: 3 },
  { mes: 4, dia: 1, nome: 'Dia da Mentira', peso: 1 },
  { mes: 4, dia: 22, nome: 'Descobrimento do Brasil', peso: 1 },
  { mes: 5, dia: 1, nome: 'Dia do Trabalhador', peso: 2 },
  { mes: 6, dia: 12, nome: 'Dia dos Namorados', peso: 3 },
  { mes: 6, dia: 24, nome: 'São João / Festa Junina', peso: 3 },
  { mes: 7, dia: 20, nome: 'Dia do Amigo', peso: 2 },
  { mes: 8, dia: 11, nome: 'Dia do Estudante', peso: 1 },
  { mes: 8, dia: 25, nome: 'Dia do Soldado', peso: 1 },
  { mes: 9, dia: 7, nome: 'Independência do Brasil', peso: 1 },
  { mes: 9, dia: 15, nome: 'Dia do Cliente', peso: 3 },
  { mes: 9, dia: 21, nome: 'Início da Primavera', peso: 1 },
  { mes: 10, dia: 12, nome: 'Dia das Crianças', peso: 3 },
  { mes: 10, dia: 15, nome: 'Dia do Professor', peso: 2 },
  { mes: 10, dia: 31, nome: 'Halloween', peso: 2 },
  { mes: 11, dia: 2, nome: 'Finados', peso: 1 },
  { mes: 11, dia: 15, nome: 'Proclamação da República', peso: 1 },
  { mes: 11, dia: 20, nome: 'Dia da Consciência Negra', peso: 2 },
  { mes: 12, dia: 25, nome: 'Natal', peso: 3 },
  { mes: 12, dia: 31, nome: 'Réveillon', peso: 3 },
  // Datas de ramo
  { mes: 7, dia: 10, nome: 'Dia da Pizza', peso: 3, ramos: ['pizzaria', 'restaurante', 'alimentacao'] },
  { mes: 3, dia: 21, nome: 'Dia do Café', peso: 2, ramos: ['cafeteria', 'restaurante', 'alimentacao'] },
  { mes: 9, dia: 4, nome: 'Dia do Frete Grátis', peso: 2, ramos: ['ecommerce', 'loja'] },
  { mes: 5, dia: 13, nome: 'Dia do Automóvel', peso: 2, ramos: ['automotivo'] },
];

/** Domingo = 0. Datas moveis que dependem do calendario do ano. */
function nEsimoDiaDaSemana(ano: number, mes: number, diaSemana: number, n: number): Date {
  const primeiro = new Date(ano, mes - 1, 1);
  const deslocamento = (diaSemana - primeiro.getDay() + 7) % 7;
  return new Date(ano, mes - 1, 1 + deslocamento + (n - 1) * 7);
}

/**
 * Datas moveis do ano.
 *
 * Dia das Maes (2o domingo de maio) e dos Pais (2o domingo de agosto) sao
 * as duas maiores datas de venda do varejo brasileiro depois do Natal —
 * errar o dia delas custa caro. Black Friday e a ultima sexta de novembro.
 */
export function datasMoveis(ano: number): Array<DataComemorativa & { dia: number }> {
  const maes = nEsimoDiaDaSemana(ano, 5, 0, 2);
  const pais = nEsimoDiaDaSemana(ano, 8, 0, 2);

  // Black Friday: a sexta seguinte a 4a quinta de novembro (Thanksgiving).
  const quintaAcao = nEsimoDiaDaSemana(ano, 11, 4, 4);
  const blackFriday = new Date(quintaAcao);
  blackFriday.setDate(quintaAcao.getDate() + 1);

  const cyberMonday = new Date(blackFriday);
  cyberMonday.setDate(blackFriday.getDate() + 3);

  return [
    { mes: 5, dia: maes.getDate(), nome: 'Dia das Mães', peso: 3 },
    { mes: 8, dia: pais.getDate(), nome: 'Dia dos Pais', peso: 3 },
    { mes: 11, dia: blackFriday.getDate(), nome: 'Black Friday', peso: 3 },
    // O mes vem da data calculada, nao fixo em novembro: quando a Black
    // Friday cai em 29/11 (2024, 2030...), a Cyber Monday atravessa para
    // dezembro. Fixando 11 aqui, ela virava "2 de novembro" — mes errado e
    // data no passado.
    { mes: cyberMonday.getMonth() + 1, dia: cyberMonday.getDate(), nome: 'Cyber Monday', peso: 2 },
  ];
}

/**
 * Datas de um mes, ja filtradas pelo ramo do negocio.
 *
 * Uma data de ramo ("Dia da Pizza") so entra se bater com o ramo informado;
 * caso contrario poluiria o calendario de quem vende outra coisa.
 */
export function datasDoMes(ano: number, mes: number, ramo?: string): Array<DataComemorativa & { dia: number }> {
  const ramoNorm = (ramo || '').toLowerCase().trim();

  const fixas = DATAS_FIXAS
    .filter((d): d is DataComemorativa & { dia: number } => d.mes === mes && d.dia !== undefined)
    .filter((d) => !d.ramos || (ramoNorm && d.ramos.some((r) => ramoNorm.includes(r) || r.includes(ramoNorm))));

  const moveis = datasMoveis(ano).filter((d) => d.mes === mes);

  return [...fixas, ...moveis].sort((a, b) => a.dia - b.dia);
}
