/**
 * Retrospectiva mensal: as metricas do mes viram um post que a marca QUER
 * publicar.
 *
 * O relatorio em PDF e para a agencia provar servico. Isto e outra coisa:
 * e conteudo. Negocio local adora exibir numero, e a peca nasce feita para
 * ser postada — a plataforma passa a gerar o proprio conteudo viral usando
 * dados que ja tem.
 *
 * A REGRA QUE MANDA: um "Wrapped" com "3 posts, 12 curtidas" e vexame, nao
 * marketing. Mes fraco nao gera peca nenhuma.
 */

export interface DadosDoMes {
  posts: number;
  curtidas: number;
  comentarios: number;
  alcance?: number;
  seguidoresGanhos?: number;
  melhorPost?: { caption: string; curtidas: number; comentarios: number } | null;
  melhorHora?: number | null;
  postsMesAnterior?: number;
}

export interface Cartao {
  numero: string;
  rotulo: string;
  /** O cartao principal, que vira o destaque visual da peca. */
  destaque?: boolean;
}

/**
 * Minimos para a peca existir.
 *
 * Sao baixos de proposito (nao exigimos viral), mas exigem que haja
 * ALGUMA coisa para comemorar. Publicar "1 post neste mes" chamaria
 * atencao justamente para o que a marca nao fez.
 */
export const MIN_POSTS = 4;
export const MIN_INTERACOES = 20;

export function podeGerar(d: DadosDoMes): { pode: boolean; motivo?: string } {
  if ((d.posts || 0) < MIN_POSTS) {
    return { pode: false, motivo: `Com menos de ${MIN_POSTS} posts no mês, a retrospectiva chamaria atenção para o que faltou.` };
  }
  const interacoes = (d.curtidas || 0) + (d.comentarios || 0);
  if (interacoes < MIN_INTERACOES) {
    return { pode: false, motivo: 'O mês teve pouca interação registrada. Melhor esperar um mês mais forte.' };
  }
  return { pode: true };
}

/** Abrevia numero grande: "12.4 mil" cabe na arte, "12437" nao. */
export function abreviar(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace('.0', '').replace('.', ',')} mi`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace('.0', '').replace('.', ',')} mil`;
  return String(Math.round(n));
}

export function nomeDoMes(mes: number): string {
  const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  return MESES[Math.max(0, Math.min(11, mes - 1))];
}

/**
 * Escolhe o que entra na peca.
 *
 * NAO mostra tudo que temos: quatro cartoes no maximo. Uma arte com oito
 * numeros nao e comemoracao, e planilha — e ninguem para o scroll para ler
 * planilha. Entra o que for mais impressionante para AQUELA conta.
 */
export const MAX_CARTOES = 4;

export function montarCartoes(d: DadosDoMes): Cartao[] {
  const candidatos: Array<Cartao & { peso: number }> = [];

  const interacoes = (d.curtidas || 0) + (d.comentarios || 0);
  candidatos.push({ numero: abreviar(interacoes), rotulo: 'curtidas e comentários', peso: 50 });
  candidatos.push({ numero: String(d.posts), rotulo: 'publicações no mês', peso: 30 });

  if (d.alcance && d.alcance > 0) {
    candidatos.push({ numero: abreviar(d.alcance), rotulo: 'pessoas alcançadas', peso: 90 });
  }

  if (d.seguidoresGanhos && d.seguidoresGanhos > 0) {
    candidatos.push({ numero: `+${abreviar(d.seguidoresGanhos)}`, rotulo: 'seguidores novos', peso: 80 });
  }

  // Crescimento so entra quando E crescimento. Estampar "-30% vs. o mes
  // passado" numa peca de comemoracao seria autossabotagem.
  if (d.postsMesAnterior && d.postsMesAnterior > 0 && d.posts > d.postsMesAnterior) {
    const pct = Math.round(((d.posts - d.postsMesAnterior) / d.postsMesAnterior) * 100);
    if (pct >= 20) candidatos.push({ numero: `+${pct}%`, rotulo: 'mais posts que no mês passado', peso: 60 });
  }

  if (d.comentarios && d.comentarios >= 10) {
    candidatos.push({ numero: abreviar(d.comentarios), rotulo: 'conversas nos comentários', peso: 40 });
  }

  const escolhidos = candidatos.sort((a, b) => b.peso - a.peso).slice(0, MAX_CARTOES);
  return escolhidos.map(({ peso, ...c }, i) => ({ ...c, ...(i === 0 ? { destaque: true } : {}) }));
}

export interface Retrospectiva {
  titulo: string;
  subtitulo: string;
  cartoes: Cartao[];
  legendaSugerida: string;
}

export function montar(d: DadosDoMes, marca: string, mes: number, ano: number): Retrospectiva {
  const cartoes = montarCartoes(d);
  const nomeMes = nomeDoMes(mes);
  const principal = cartoes[0];

  // A legenda ja sai pronta para postar, com CTA. Uma retrospectiva sem
  // pedido de interacao desperdica o unico post do mes que a audiencia
  // realmente quer comentar.
  const legendaSugerida = [
    `${nomeMes.charAt(0).toUpperCase()}${nomeMes.slice(1)} foi assim por aqui 💜`,
    '',
    `${principal.numero} ${principal.rotulo} — e cada uma delas veio de você.`,
    '',
    'Obrigado por acompanhar a gente. Conta aqui o que você quer ver mais no próximo mês!',
  ].join('\n');

  return {
    titulo: `${nomeMes} na ${marca}`,
    subtitulo: `${ano}`,
    cartoes,
    legendaSugerida,
  };
}

/** Escapa texto do usuario antes de injetar no HTML da arte. */
function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

/**
 * O HTML da arte, 1080x1350 (formato de feed que mais ocupa a tela).
 *
 * Vai para o mesmo renderer com Chromium que ja gera o PDF.
 */
export function montarHtml(r: Retrospectiva, cor: string, logoUrl?: string | null): string {
  const corSegura = /^#[0-9a-f]{6}$/i.test(cor) ? cor : '#7c3aed';
  const [principal, ...resto] = r.cartoes;

  return `
<div style="width:1080px;height:1350px;background:linear-gradient(160deg,${corSegura} 0%,#111 100%);
            font-family:Inter,system-ui,sans-serif;color:#fff;padding:80px;box-sizing:border-box;
            display:flex;flex-direction:column;justify-content:space-between">
  <div>
    ${logoUrl ? `<img src="${esc(logoUrl)}" style="height:70px;max-width:320px;object-fit:contain;margin-bottom:40px" />` : ''}
    <p style="font-size:30px;opacity:.75;margin:0">${esc(r.subtitulo)}</p>
    <h1 style="font-size:76px;font-weight:800;margin:8px 0 0;line-height:1.05">${esc(r.titulo)}</h1>
  </div>

  <div>
    <div style="margin-bottom:56px">
      <div style="font-size:150px;font-weight:900;line-height:1">${esc(principal.numero)}</div>
      <div style="font-size:34px;opacity:.85;margin-top:4px">${esc(principal.rotulo)}</div>
    </div>

    <div style="display:flex;gap:28px">
      ${resto.map((c) => `
        <div style="flex:1;background:rgba(255,255,255,.12);border-radius:24px;padding:28px">
          <div style="font-size:52px;font-weight:800;line-height:1">${esc(c.numero)}</div>
          <div style="font-size:20px;opacity:.8;margin-top:6px;line-height:1.25">${esc(c.rotulo)}</div>
        </div>`).join('')}
    </div>
  </div>

  <p style="font-size:20px;opacity:.5;margin:0">feito com DisparaAI</p>
</div>`;
}

const RENDERER_URL = process.env.RENDERER_URL || 'http://renderer:3003';

/**
 * Transforma o HTML na imagem final.
 *
 * O timeout e generoso (30s) porque o Chromium precisa baixar a fonte antes
 * de desenhar; cortar antes disso entregaria a arte com fonte errada, o que
 * e pior que demorar.
 */
export async function renderizar(html: string): Promise<string> {
  const res = await fetch(`${RENDERER_URL}/render`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ html, width: 1080, height: 1350 }),
    signal: AbortSignal.timeout(30000),
  });
  const data = (await res.json()) as any;
  if (!res.ok || !data?.image) throw new Error(data?.error || 'Não consegui gerar a imagem');
  return data.image;
}
