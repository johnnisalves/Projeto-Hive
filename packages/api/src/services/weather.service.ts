/**
 * Gatilho de clima: "choveu, postou".
 *
 * E o reflexo do funcionario esperto — olhar pela janela e mudar o post do
 * dia. Para comercio local, timing contextual converte mais que qualquer
 * calendario planejado com um mes de antecedencia.
 *
 * Usa a Open-Meteo: API publica, gratuita e SEM chave. Nao adiciona segredo
 * novo ao deploy nem cria mais um cadastro para o usuario esquecer.
 */

const GEO = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST = 'https://api.open-meteo.com/v1/forecast';

export interface HoraPrevista {
  /** ISO local, como a Open-Meteo devolve. */
  hora: string;
  chuvaProb: number;
  temperatura: number;
}

export type Condicao = 'chuva' | 'frio' | 'calor' | null;

/** Limiares. Frouxos demais e o gatilho vira spam; apertados demais nunca dispara. */
export const PROB_CHUVA = 60;
export const TEMP_FRIA = 19;
export const TEMP_QUENTE = 32;

/**
 * Olha so a JANELA QUE IMPORTA para o comercio: a noite (18h-23h), quando o
 * cliente decide se sai de casa ou pede delivery. Chuva as 4 da manha nao
 * muda o faturamento de ninguem e viraria post inutil.
 */
export const JANELA_INICIO = 18;
export const JANELA_FIM = 23;

function horaDoDia(iso: string): number {
  // A Open-Meteo devolve "2026-08-02T19:00" ja no fuso pedido. Ler o numero
  // direto da string evita o Date reinterpretar como UTC e deslocar 3 horas
  // — o que faria a janela da noite cair na tarde.
  const m = iso.match(/T(\d{2}):/);
  return m ? Number(m[1]) : -1;
}

export function naJanelaDaNoite(iso: string): boolean {
  const h = horaDoDia(iso);
  return h >= JANELA_INICIO && h <= JANELA_FIM;
}

/**
 * O que a previsao da noite recomenda postar.
 *
 * A ordem e proposital: chuva ganha de frio e de calor, porque e a que mais
 * muda o comportamento de sair de casa.
 */
export function avaliarPrevisao(horas: HoraPrevista[]): { condicao: Condicao; detalhe: string } {
  const noite = (horas || []).filter((h) => naJanelaDaNoite(h.hora));
  if (noite.length === 0) return { condicao: null, detalhe: '' };

  const chuvaMax = Math.max(...noite.map((h) => h.chuvaProb ?? 0));
  if (chuvaMax >= PROB_CHUVA) {
    return { condicao: 'chuva', detalhe: `${Math.round(chuvaMax)}% de chance de chuva hoje à noite` };
  }

  const temps = noite.map((h) => h.temperatura).filter((t) => typeof t === 'number');
  if (temps.length === 0) return { condicao: null, detalhe: '' };

  const min = Math.min(...temps);
  if (min <= TEMP_FRIA) return { condicao: 'frio', detalhe: `${Math.round(min)}°C hoje à noite` };

  const max = Math.max(...temps);
  if (max >= TEMP_QUENTE) return { condicao: 'calor', detalhe: `${Math.round(max)}°C hoje à noite` };

  return { condicao: null, detalhe: '' };
}

/**
 * Trava de frequencia.
 *
 * Em semana de chuva o gatilho dispararia todo dia e o perfil viraria um
 * disco riscado — o seguidor cansa e o alcance cai. Uma vez a cada tres
 * dias por condicao mantem a graca da oportunidade.
 */
export const DIAS_ENTRE_DISPAROS = 3;

export function podeDisparar(ultimoDisparo: Date | null | undefined, agora = new Date()): boolean {
  if (!ultimoDisparo) return true;
  return agora.getTime() - new Date(ultimoDisparo).getTime() >= DIAS_ENTRE_DISPAROS * 86_400_000;
}

/** Sugestao de pauta por condicao. Vira o prompt do post de oportunidade. */
export function pautaPara(condicao: Condicao, cidade: string): string | null {
  if (condicao === 'chuva') {
    return `Post de oportunidade: hoje à noite tem previsão de chuva em ${cidade}. `
      + 'Escreva algo curto e convidativo ligando o clima ao pedido em casa, sem clichê de "dia chuvoso".';
  }
  if (condicao === 'frio') {
    return `Post de oportunidade: a noite vai esfriar em ${cidade}. `
      + 'Ligue o frio ao que a marca vende de mais aconchegante.';
  }
  if (condicao === 'calor') {
    return `Post de oportunidade: a noite vai ser quente em ${cidade}. `
      + 'Ligue o calor ao que a marca tem de mais refrescante.';
  }
  return null;
}

/** Acha a cidade. A Open-Meteo nao exige chave, entao isso e so um fetch. */
export async function coordenadasDe(cidade: string): Promise<{ lat: number; lon: number; nome: string } | null> {
  const url = `${GEO}?name=${encodeURIComponent(cidade)}&count=1&language=pt&format=json&country=BR`;
  try {
    const r = await fetch(url);
    const j = (await r.json()) as any;
    const p = j?.results?.[0];
    if (!p) return null;
    return { lat: p.latitude, lon: p.longitude, nome: p.name };
  } catch {
    return null;
  }
}

/** Previsao horaria de hoje para a cidade da marca. */
export async function previsaoDeHoje(cidade: string): Promise<{ horas: HoraPrevista[]; nome: string } | null> {
  const c = await coordenadasDe(cidade);
  if (!c) return null;

  const url = `${FORECAST}?latitude=${c.lat}&longitude=${c.lon}`
    + '&hourly=precipitation_probability,temperature_2m'
    + '&timezone=America%2FSao_Paulo&forecast_days=1';

  try {
    const r = await fetch(url);
    const j = (await r.json()) as any;
    const tempos: string[] = j?.hourly?.time || [];
    const probs: number[] = j?.hourly?.precipitation_probability || [];
    const temps: number[] = j?.hourly?.temperature_2m || [];

    return {
      nome: c.nome,
      horas: tempos.map((hora, i) => ({
        hora,
        chuvaProb: probs[i] ?? 0,
        temperatura: temps[i] ?? 0,
      })),
    };
  } catch {
    return null;
  }
}
