/**
 * Calendario de conteudo do mes: briefing -> grade com datas reais.
 *
 * A DECISAO CENTRAL: as DATAS sao calculadas aqui, no codigo. A IA nunca
 * escolhe dia. Ela recebe a lista pronta e so preenche o conteudo de cada
 * uma.
 *
 * Isso elimina de uma vez uma classe inteira de erro: "31 de novembro",
 * "29 de fevereiro" em ano comum, mes com 30 dias virando 31. Pedir data
 * para o modelo e pedir para ele errar em silencio — e um calendario com
 * data invalida so aparece quando o post nao publica.
 */

export type Frequencia = '3x' | '5x' | 'diario' | 'personalizado';

export interface Briefing {
  nicho: string;
  publico?: string;
  plataformas: string[];
  objetivo: string;
  tom: string;
  frequencia: Frequencia;
  /** 0=domingo ... 6=sabado. So vale quando frequencia e 'personalizado'. */
  diasDaSemana?: number[];
  ano: number;
  /** 1 a 12. */
  mes: number;
  pilares?: string[];
}

export const DIAS_POR_FREQUENCIA: Record<Exclude<Frequencia, 'personalizado'>, number[]> = {
  // Segunda, quarta e sexta: o padrao que nao cansa e cobre a semana.
  '3x': [1, 3, 5],
  '5x': [1, 2, 3, 4, 5],
  diario: [0, 1, 2, 3, 4, 5, 6],
};

export function diasEscolhidos(b: Pick<Briefing, 'frequencia' | 'diasDaSemana'>): number[] {
  if (b.frequencia === 'personalizado') {
    // Ordena e tira repetido: a tela pode mandar em qualquer ordem, e um dia
    // repetido geraria dois posts no mesmo dia.
    return Array.from(new Set(b.diasDaSemana || [])).filter((d) => d >= 0 && d <= 6).sort((a, c) => a - c);
  }
  return DIAS_POR_FREQUENCIA[b.frequencia] || DIAS_POR_FREQUENCIA['3x'];
}

/**
 * As datas reais do mes que caem nos dias escolhidos.
 *
 * Usa o truque de `new Date(ano, mes, 0)` para achar o ultimo dia: o mes
 * seguinte no dia 0 e o ultimo dia deste. Funciona para fevereiro
 * bissexto sem tabela nenhuma.
 */
export function montarCronograma(b: Pick<Briefing, 'ano' | 'mes' | 'frequencia' | 'diasDaSemana'>): Date[] {
  const dias = diasEscolhidos(b);
  if (dias.length === 0) return [];

  const ultimo = new Date(b.ano, b.mes, 0).getDate();
  const datas: Date[] = [];
  for (let d = 1; d <= ultimo; d++) {
    const data = new Date(b.ano, b.mes - 1, d);
    if (dias.includes(data.getDay())) datas.push(data);
  }
  return datas;
}

const SEMANA = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

function pad2(n: number): string { return n < 10 ? `0${n}` : String(n); }
export function dataBr(d: Date): string { return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`; }
export function nomeDoMes(mes: number): string { return MESES[Math.max(0, Math.min(11, mes - 1))]; }

/**
 * O prompt.
 *
 * Manda o cronograma PRONTO e exige um post por data, na mesma ordem. O
 * contexto do ramo entra separado (ver niche.service.ts), para uma clinica
 * nao receber sugestao de restaurante.
 */
export function montarPrompt(b: Briefing, cronograma: Date[], contextoDoNicho?: string): string {
  const linhas = cronograma
    .map((d, i) => `  ${i + 1}) ${dataBr(d)} (${SEMANA[d.getDay()]})`)
    .join('\n');

  const pilares = (b.pilares || []).length
    ? `Use EXATAMENTE estes pilares de conteúdo, bem distribuídos no mês: ${(b.pilares || []).join(', ')}.`
    : 'Crie de 4 a 6 pilares de conteúdo coerentes com o negócio e o objetivo, e distribua os posts entre eles.';

  return [
    'Você é um estrategista de conteúdo sênior, especialista em redes sociais para o público brasileiro.',
    'Monte um calendário de conteúdo completo para o mês, com base no briefing abaixo.',
    '',
    'BRIEFING:',
    `- Negócio / tema: ${b.nicho}`,
    `- Público-alvo: ${b.publico || 'não informado'}`,
    `- Objetivo principal: ${b.objetivo}`,
    `- Plataformas disponíveis (use SOMENTE estas): ${b.plataformas.join(', ')}`,
    `- Tom de voz: ${b.tom}`,
    contextoDoNicho ? `- Sobre o ramo: ${contextoDoNicho}` : '',
    `- ${pilares}`,
    '',
    'CRONOGRAMA (gere EXATAMENTE 1 post para CADA data abaixo, na MESMA ordem):',
    linhas,
    '',
    'REGRAS:',
    '- Escreva em português do Brasil, específico para este negócio. Sem clichê genérico.',
    `- Gere EXATAMENTE ${cronograma.length} posts, um por data, na ordem do cronograma.`,
    '- "plataforma" deve ser uma das disponíveis. Varie de forma equilibrada e adequada.',
    '- "formato" é o formato nativo da plataforma (Reel, Carrossel, Stories, Post, Vídeo, Short, Artigo).',
    '- "pilar" deve ser um dos pilares definidos.',
    '- "titulo" curto e chamativo, até 60 caracteres.',
    '- "gancho" é a primeira frase, a que prende a atenção.',
    '- "descricao" explica a ideia do post em 1 ou 2 frases práticas.',
    '- "cta" é a chamada para ação adequada ao objetivo.',
    '- "hashtags" é uma lista de 3 a 6 palavras, SEM o caractere #.',
    '- "horario" é a hora sugerida no formato "HH:MM" (24h), coerente com o público.',
    '',
    'RESPONDA APENAS com um objeto JSON válido, sem markdown e sem texto fora do JSON:',
    '{',
    '  "pilares": [{"nome": "nome do pilar", "descricao": "breve descrição"}],',
    '  "posts": [',
    '    {"plataforma": "INSTAGRAM", "formato": "Reel", "pilar": "nome", "titulo": "...", "gancho": "...", "descricao": "...", "cta": "...", "hashtags": ["palavra"], "horario": "19:00"}',
    '  ]',
    '}',
  ].filter(Boolean).join('\n');
}

// ---------------------------------------------------------------------------
// Leitura da resposta: o modelo erra JSON com frequencia, e desistir na
// primeira tentativa joga fora uma geracao inteira que estava quase boa.
// ---------------------------------------------------------------------------

/** Tira cerca de markdown e texto solto antes/depois do objeto. */
export function isolarObjeto(texto: string): string {
  let t = String(texto || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a > -1 && b > a) t = t.slice(a, b + 1);
  return t;
}

/**
 * Escapa aspas e quebras de linha que o modelo deixou cruas DENTRO de uma
 * string.
 *
 * E o erro mais comum: o modelo escreve `"gancho": "ela disse "sim""` e o
 * JSON.parse morre. Percorremos caractere a caractere decidindo, a cada
 * aspa, se ela fecha a string (o proximo simbolo util e `:`, `,`, `}` ou
 * `]`) ou se e uma aspa literal que precisa de escape.
 */
export function repararStrings(t: string): string {
  let saida = '';
  let dentro = false;

  for (let i = 0; i < t.length; i++) {
    const c = t[i];

    if (!dentro) {
      saida += c;
      if (c === '"') dentro = true;
      continue;
    }

    if (c === '\\') { saida += c + (t[i + 1] || ''); i++; continue; }

    if (c === '"') {
      let j = i + 1;
      while (j < t.length && /\s/.test(t[j])) j++;
      const proximo = t[j];
      if (proximo === undefined || proximo === ':' || proximo === ',' || proximo === '}' || proximo === ']') {
        saida += '"';
        dentro = false;
      } else {
        saida += '\\"';
      }
      continue;
    }

    if (c === '\n') { saida += '\\n'; continue; }
    if (c === '\r') { saida += '\\r'; continue; }
    if (c === '\t') { saida += '\\t'; continue; }
    saida += c;
  }
  return saida;
}

const semVirgulaSobrando = (s: string) => s.replace(/,\s*([}\]])/g, '$1');

/** Escada de reparo: quatro tentativas antes de desistir. */
export function lerJson(texto: string): any {
  const t = isolarObjeto(texto);
  const tentativas = [t, semVirgulaSobrando(t), repararStrings(t), semVirgulaSobrando(repararStrings(t))];
  for (const tentativa of tentativas) {
    try { return JSON.parse(tentativa); } catch { /* proxima */ }
  }
  throw new Error('O modelo não devolveu um JSON válido. Tente gerar de novo.');
}

// ---------------------------------------------------------------------------
// Normalizacao: NADA que vem do modelo e usado como veio.
// ---------------------------------------------------------------------------

export interface PostDoCalendario {
  data: Date;
  plataforma: string;
  formato: string;
  pilar: string;
  titulo: string;
  gancho: string;
  descricao: string;
  cta: string;
  hashtags: string[];
  horario: string;
}

export interface Pilar { nome: string; descricao: string }

const texto = (v: unknown): string => String(v ?? '').replace(/\s+/g, ' ').trim();

/** Hora valida no formato HH:MM. Qualquer coisa fora disso vira 19:00. */
export function normalizarHorario(bruto: unknown): string {
  const t = texto(bruto);
  const m = t.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return '19:00';
  const h = Math.min(23, Math.max(0, parseInt(m[1], 10)));
  const min = Math.min(59, Math.max(0, parseInt(m[2], 10)));
  return `${pad2(h)}:${pad2(min)}`;
}

export function normalizarPost(bruto: any, plataformas: string[], pilares: string[]): Omit<PostDoCalendario, 'data'> {
  const p = bruto || {};

  // Plataforma fora das escolhidas vira a primeira permitida. Publicar num
  // canal que o usuario nao pediu e pior que repetir canal.
  let plataforma = texto(p.plataforma).toUpperCase();
  if (!plataformas.includes(plataforma)) plataforma = plataformas[0] || 'INSTAGRAM';

  // Pilar: casa sem diferenciar caixa; se nao existir, o primeiro.
  let pilar = texto(p.pilar);
  if (pilares.length) {
    const achado = pilares.find((n) => n.toLowerCase() === pilar.toLowerCase());
    pilar = achado || pilares[0];
  }

  const hashtags = (Array.isArray(p.hashtags) ? p.hashtags : [])
    .map((h: unknown) => texto(h).replace(/^#/, ''))
    .filter(Boolean)
    .slice(0, 8);

  return {
    plataforma,
    formato: texto(p.formato) || 'Post',
    pilar: pilar || 'Geral',
    titulo: texto(p.titulo) || 'Post de conteúdo',
    gancho: texto(p.gancho),
    descricao: texto(p.descricao),
    cta: texto(p.cta),
    hashtags,
    horario: normalizarHorario(p.horario),
  };
}

/**
 * Casa a resposta com o cronograma.
 *
 * O numero de posts vem do CRONOGRAMA, nao do modelo: se ele devolver a
 * mais, o excedente e descartado; a menos, o mes fica com menos posts, mas
 * cada um cai numa data real. Nunca inventamos data para completar.
 */
export function normalizar(bruto: any, cronograma: Date[], b: Briefing): { pilares: Pilar[]; posts: PostDoCalendario[] } {
  const d = bruto || {};

  let pilares: Pilar[] = (Array.isArray(d.pilares) ? d.pilares : [])
    .map((p: any, i: number) => ({
      nome: texto(p?.nome || p?.name) || `Pilar ${i + 1}`,
      descricao: texto(p?.descricao || p?.desc),
    }));

  // Pilares informados no briefing mandam: o modelo nao pode renomea-los.
  if ((b.pilares || []).length) {
    pilares = (b.pilares || []).map((nome) => {
      const achado = pilares.find((x) => x.nome.toLowerCase() === nome.toLowerCase());
      return { nome, descricao: achado?.descricao || '' };
    });
  }
  if (!pilares.length) pilares = [{ nome: 'Geral', descricao: '' }];

  const nomes = pilares.map((p) => p.nome);
  const brutos = Array.isArray(d.posts) ? d.posts : [];
  const quantos = Math.min(brutos.length, cronograma.length);

  const posts: PostDoCalendario[] = [];
  for (let i = 0; i < quantos; i++) {
    posts.push({ ...normalizarPost(brutos[i], b.plataformas, nomes), data: cronograma[i] });
  }

  return { pilares, posts };
}

// ---------------------------------------------------------------------------
// Exportacao
// ---------------------------------------------------------------------------

/** Celula de CSV: aspas dobradas e o campo inteiro entre aspas quando precisa. */
export function celulaCsv(v: unknown): string {
  const s = String(v ?? '');
  return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function gerarCsv(posts: PostDoCalendario[]): string {
  const cabecalho = ['Data', 'Horario', 'Plataforma', 'Formato', 'Pilar', 'Titulo', 'Gancho', 'Descricao', 'CTA', 'Hashtags'];
  const linhas = posts.map((p) => [
    dataBr(p.data), p.horario, p.plataforma, p.formato, p.pilar,
    p.titulo, p.gancho, p.descricao, p.cta, p.hashtags.map((h) => `#${h}`).join(' '),
  ].map(celulaCsv).join(','));

  // BOM na frente: sem ele o Excel em portugues abre o arquivo em ANSI e
  // "promoção" vira "promoÃ§Ã£o" na planilha do cliente.
  return `﻿${[cabecalho.join(','), ...linhas].join('\r\n')}`;
}

/** Escapa os caracteres que o formato iCalendar reserva. */
export function escaparIcs(s: string): string {
  return String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * Dobra a linha em 75 octetos, como o RFC 5545 exige.
 *
 * Conta BYTES, nao caracteres: acento ocupa 2 bytes em UTF-8, e dobrar por
 * caractere estoura o limite numa legenda em portugues — alguns clientes de
 * agenda recusam o arquivo inteiro por causa disso.
 */
export function dobrarLinhaIcs(linha: string): string {
  const bytes = Buffer.from(linha, 'utf8');
  if (bytes.length <= 75) return linha;

  const partes: string[] = [];
  let atual = '';
  let tamanho = 0;
  const limite = () => (partes.length === 0 ? 75 : 74); // continuacao gasta 1 byte com o espaco

  for (const ch of linha) {
    const b = Buffer.byteLength(ch, 'utf8');
    if (tamanho + b > limite()) { partes.push(atual); atual = ''; tamanho = 0; }
    atual += ch;
    tamanho += b;
  }
  if (atual) partes.push(atual);

  return partes[0] + partes.slice(1).map((p) => `\r\n ${p}`).join('');
}

function carimbo(d: Date): string {
  return `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}`
    + `T${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}${pad2(d.getUTCSeconds())}Z`;
}

function horaLocal(d: Date, horario: string): string {
  const [h, m] = horario.split(':').map(Number);
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}T${pad2(h)}${pad2(m)}00`;
}

function somarMinutos(horario: string, minutos: number): string {
  const [h, m] = horario.split(':').map(Number);
  const total = (h * 60 + m + minutos) % (24 * 60);
  return `${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`;
}

export function gerarIcs(posts: PostDoCalendario[], nomeDoCalendario: string, agora = new Date()): string {
  const linhas: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//DisparaAI//Calendario de Conteudo//PT-BR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    dobrarLinhaIcs(`X-WR-CALNAME:${escaparIcs(nomeDoCalendario)}`),
  ];

  posts.forEach((p, i) => {
    const titulo = `[${p.plataforma}] ${p.titulo}`;
    const corpo = [
      p.formato && `Formato: ${p.formato}`,
      p.pilar && `Pilar: ${p.pilar}`,
      p.gancho && `\nGancho: ${p.gancho}`,
      p.descricao && `\nIdeia: ${p.descricao}`,
      p.cta && `\nCTA: ${p.cta}`,
      p.hashtags.length ? `\n${p.hashtags.map((h) => `#${h}`).join(' ')}` : '',
    ].filter(Boolean).join('\n');

    linhas.push(
      'BEGIN:VEVENT',
      `UID:disparaai-${p.data.getFullYear()}${pad2(p.data.getMonth() + 1)}${pad2(p.data.getDate())}-${i}@disparaai`,
      `DTSTAMP:${carimbo(agora)}`,
      `DTSTART:${horaLocal(p.data, p.horario)}`,
      `DTEND:${horaLocal(p.data, somarMinutos(p.horario, 30))}`,
      dobrarLinhaIcs(`SUMMARY:${escaparIcs(titulo)}`),
      dobrarLinhaIcs(`DESCRIPTION:${escaparIcs(corpo)}`),
      dobrarLinhaIcs(`CATEGORIES:${escaparIcs(p.pilar)}`),
      'BEGIN:VALARM',
      'TRIGGER:-PT60M',
      'ACTION:DISPLAY',
      dobrarLinhaIcs(`DESCRIPTION:${escaparIcs(`Lembrete: ${titulo}`)}`),
      'END:VALARM',
      'END:VEVENT',
    );
  });

  linhas.push('END:VCALENDAR');
  // CRLF obrigatorio pelo RFC: com \n puro, o Outlook recusa o arquivo.
  return linhas.join('\r\n');
}

/** Nome do arquivo baixado. */
export function nomeDoArquivo(nicho: string, mes: number, ano: number): string {
  const base = (nicho || 'conteudo')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'conteudo';
  return `calendario-${base}-${nomeDoMes(mes)}-${ano}`;
}
