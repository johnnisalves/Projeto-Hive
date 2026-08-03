/**
 * Importacao de planilha: N posts agendados de uma vez.
 *
 * Remove a objecao que trava migracao de ferramenta ("tenho 200 posts
 * prontos no Excel, nao vou recriar um por um").
 *
 * TUDO AQUI E CONFERIDO ANTES DE GRAVAR NADA. Uma planilha de 200 linhas
 * com a linha 137 quebrada nao pode criar 136 posts e parar no meio: o
 * usuario ficaria com metade da campanha no ar e sem saber o que faltou.
 */

export interface LinhaImportada {
  linha: number;
  data: Date | null;
  legenda: string;
  imagem: string | null;
  hashtags: string[];
  erro?: string;
}

/**
 * Separa CSV respeitando aspas.
 *
 * Legenda com virgula e a regra, nao a excecao ("Chegou a pizza nova, vem
 * provar"). Um split(',') seco espatifaria a legenda em varias colunas e
 * desalinharia a planilha inteira a partir dali.
 */
export function separarLinhaCsv(linha: string, separador = ','): string[] {
  const campos: string[] = [];
  let atual = '';
  let dentroDeAspas = false;

  for (let i = 0; i < linha.length; i++) {
    const c = linha[i];
    if (c === '"') {
      // Aspas duplas dentro de campo entre aspas representam uma aspa literal.
      if (dentroDeAspas && linha[i + 1] === '"') { atual += '"'; i++; }
      else dentroDeAspas = !dentroDeAspas;
      continue;
    }
    if (c === separador && !dentroDeAspas) { campos.push(atual); atual = ''; continue; }
    atual += c;
  }
  campos.push(atual);
  return campos.map((c) => c.trim());
}

/**
 * Descobre o separador olhando o cabecalho.
 *
 * O Excel em portugues salva CSV com PONTO E VIRGULA, nao virgula — e essa
 * e a origem mais comum de "importei e veio tudo numa coluna so".
 */
export function detectarSeparador(cabecalho: string): string {
  const pontoEVirgula = (cabecalho.match(/;/g) || []).length;
  const virgula = (cabecalho.match(/,/g) || []).length;
  const tab = (cabecalho.match(/\t/g) || []).length;
  if (tab > pontoEVirgula && tab > virgula) return '\t';
  return pontoEVirgula > virgula ? ';' : ',';
}

function normalizar(s: string): string {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** Aceita os nomes de coluna que a pessoa realmente escreve. */
const APELIDOS: Record<string, string[]> = {
  data: ['data', 'data e hora', 'datahora', 'quando', 'agendamento', 'date'],
  legenda: ['legenda', 'texto', 'caption', 'descricao', 'conteudo', 'post'],
  imagem: ['imagem', 'foto', 'midia', 'media', 'url', 'link da imagem', 'image'],
  hashtags: ['hashtags', 'tags', 'hashtag'],
};

export function mapearColunas(cabecalho: string[]): Record<string, number> {
  const mapa: Record<string, number> = {};
  cabecalho.forEach((nome, i) => {
    const n = normalizar(nome);
    for (const [campo, nomes] of Object.entries(APELIDOS)) {
      if (mapa[campo] === undefined && nomes.includes(n)) mapa[campo] = i;
    }
  });
  return mapa;
}

/**
 * Data no jeito brasileiro.
 *
 * "03/08/2026" e 3 de AGOSTO, nunca 8 de marco. O construtor `new Date()`
 * do JavaScript le esse formato como mes/dia (padrao americano) e agendaria
 * a campanha inteira nos meses errados — silenciosamente, porque as duas
 * leituras dao datas validas.
 */
export function lerDataBr(bruto: string): Date | null {
  const t = (bruto || '').trim();
  if (!t) return null;

  // ISO (2026-08-03 ou 2026-08-03T14:30) e inequivoco: aceita direto.
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2}))?/);
  if (iso) {
    const d = new Date(+iso[1], +iso[2] - 1, +iso[3], +(iso[4] || 9), +(iso[5] || 0));
    return isNaN(d.getTime()) ? null : d;
  }

  const br = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})(?:[T ,]+(\d{1,2})[:h](\d{2}))?/);
  if (!br) return null;

  const dia = +br[1];
  const mes = +br[2];
  let ano = +br[3];
  if (ano < 100) ano += 2000;
  // Hora omitida vira 9h: agendar para meia-noite mandaria o post para a
  // madrugada, quando ninguem ve.
  const hora = br[4] !== undefined ? +br[4] : 9;
  const minuto = br[5] !== undefined ? +br[5] : 0;

  if (mes < 1 || mes > 12 || dia < 1 || dia > 31 || hora > 23 || minuto > 59) return null;

  const d = new Date(ano, mes - 1, dia, hora, minuto);
  // Data que "rolou" (31/02 virando 03/03) e erro de digitacao, nao data
  // valida: recusar aqui evita agendar num dia que o usuario nao escolheu.
  if (d.getDate() !== dia || d.getMonth() !== mes - 1) return null;
  return d;
}

export function lerHashtags(bruto: string): string[] {
  return (bruto || '')
    .split(/[\s,;]+/)
    .map((h) => h.replace(/^#/, '').trim())
    .filter(Boolean)
    .slice(0, 30);
}

export const MAX_LINHAS = 500;

/**
 * Le a planilha inteira e devolve linha a linha, com o erro de cada uma.
 *
 * NUNCA para no primeiro erro: o usuario precisa ver TODOS os problemas de
 * uma vez para corrigir a planilha numa passada so, em vez de descobrir um
 * por vez em dez tentativas.
 */
export function lerPlanilha(texto: string, agora = new Date()): {
  linhas: LinhaImportada[];
  validas: number;
  invalidas: number;
  erroGeral?: string;
} {
  const cruas = (texto || '').split(/\r?\n/).filter((l) => l.trim());
  if (cruas.length < 2) {
    return { linhas: [], validas: 0, invalidas: 0, erroGeral: 'A planilha precisa do cabeçalho e pelo menos uma linha.' };
  }

  const separador = detectarSeparador(cruas[0]);
  const colunas = mapearColunas(separarLinhaCsv(cruas[0], separador));

  if (colunas.data === undefined || colunas.legenda === undefined) {
    return {
      linhas: [], validas: 0, invalidas: 0,
      erroGeral: 'Não achei as colunas obrigatórias. A planilha precisa ter "data" e "legenda" no cabeçalho.',
    };
  }

  const linhas: LinhaImportada[] = [];
  const vistas = new Set<string>();

  for (let i = 1; i < cruas.length && linhas.length < MAX_LINHAS; i++) {
    const campos = separarLinhaCsv(cruas[i], separador);
    const legenda = (campos[colunas.legenda] || '').trim();
    const data = lerDataBr(campos[colunas.data] || '');
    const imagem = colunas.imagem !== undefined ? (campos[colunas.imagem] || '').trim() || null : null;
    const hashtags = colunas.hashtags !== undefined ? lerHashtags(campos[colunas.hashtags] || '') : [];

    let erro: string | undefined;
    if (!legenda) erro = 'Sem legenda';
    else if (!data) erro = 'Data inválida — use 03/08/2026 14:30';
    else if (data.getTime() < agora.getTime()) erro = 'Data no passado';
    else if (imagem && !/^https?:\/\//i.test(imagem)) erro = 'A imagem precisa ser um endereço http(s)';

    // Duas linhas no mesmo minuto virariam dois posts empilhados; o
    // Instagram trata isso como spam e uma das publicacoes falha.
    if (!erro && data) {
      const chave = String(Math.floor(data.getTime() / 60_000));
      if (vistas.has(chave)) erro = 'Já existe outra linha para esse mesmo horário';
      else vistas.add(chave);
    }

    linhas.push({ linha: i + 1, data, legenda, imagem, hashtags, erro });
  }

  return {
    linhas,
    validas: linhas.filter((l) => !l.erro).length,
    invalidas: linhas.filter((l) => l.erro).length,
  };
}
