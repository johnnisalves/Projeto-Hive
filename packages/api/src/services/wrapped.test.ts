import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  podeGerar,
  abreviar,
  nomeDoMes,
  montarCartoes,
  montar,
  montarHtml,
  MIN_POSTS,
  MIN_INTERACOES,
  MAX_CARTOES,
} from './wrapped.service';

/**
 * Esta peca vai PARA O FEED do cliente. Um numero feio ou uma comparacao
 * negativa aqui nao e um bug de relatorio: e a marca se sabotando em
 * publico.
 */

const mes = (over: Partial<any> = {}) => ({
  posts: 22,
  curtidas: 1840,
  comentarios: 96,
  alcance: 17400,
  seguidoresGanhos: 214,
  postsMesAnterior: 15,
  ...over,
});

describe('podeGerar', () => {
  test('mes bom gera peca', () => {
    assert.ok(podeGerar(mes()).pode);
  });

  // "1 post neste mes" chamaria atencao justamente para o que a marca nao
  // fez. Melhor nao publicar nada.
  test('mes fraco em posts nao vira peca', () => {
    const r = podeGerar(mes({ posts: MIN_POSTS - 1 }));
    assert.ok(!r.pode);
    assert.match(r.motivo!, /faltou/);
  });

  test('mes sem interacao nao vira peca', () => {
    const r = podeGerar(mes({ curtidas: 5, comentarios: 2 }));
    assert.ok(!r.pode);
    assert.match(r.motivo!, /pouca interação/);
  });

  test('no limiar exato ja gera', () => {
    assert.ok(podeGerar({ posts: MIN_POSTS, curtidas: MIN_INTERACOES, comentarios: 0 }).pode);
  });

  test('mes zerado nao quebra', () => {
    assert.ok(!podeGerar({ posts: 0, curtidas: 0, comentarios: 0 }).pode);
  });
});

describe('abreviar', () => {
  // "12437" nao cabe na arte; "12,4 mil" cabe e le melhor.
  test('encolhe numero grande', () => {
    assert.equal(abreviar(12437), '12,4 mil');
    assert.equal(abreviar(1_500_000), '1,5 mi');
  });

  test('numero redondo nao fica com virgula zero', () => {
    assert.equal(abreviar(2000), '2 mil');
    assert.equal(abreviar(3_000_000), '3 mi');
  });

  test('numero pequeno sai inteiro', () => {
    assert.equal(abreviar(847), '847');
    assert.equal(abreviar(0), '0');
  });

  test('usa virgula, nao ponto — e uma peca em portugues', () => {
    assert.ok(!abreviar(12437).includes('.'));
  });
});

describe('nomeDoMes', () => {
  test('traduz o mes', () => {
    assert.equal(nomeDoMes(1), 'janeiro');
    assert.equal(nomeDoMes(12), 'dezembro');
  });

  test('mes fora da faixa nao quebra a arte', () => {
    assert.equal(nomeDoMes(0), 'janeiro');
    assert.equal(nomeDoMes(13), 'dezembro');
  });
});

describe('montarCartoes', () => {
  // Uma arte com oito numeros nao e comemoracao, e planilha — e ninguem
  // para o scroll para ler planilha.
  test('nunca passa do limite de cartoes', () => {
    assert.ok(montarCartoes(mes()).length <= MAX_CARTOES);
  });

  test('o primeiro cartao e o destaque', () => {
    const c = montarCartoes(mes());
    assert.equal(c[0].destaque, true);
    assert.ok(!c.slice(1).some((x) => x.destaque));
  });

  test('alcance ganha o destaque quando existe', () => {
    assert.match(montarCartoes(mes()).find((c) => c.destaque)!.rotulo, /alcançadas/);
  });

  test('sem alcance, o destaque cai para outro numero', () => {
    const c = montarCartoes(mes({ alcance: 0, seguidoresGanhos: 0 }));
    assert.ok(c[0].destaque);
    assert.ok(!c.some((x) => /alcançadas/.test(x.rotulo)));
  });

  // Estampar "-30% vs. o mes passado" numa peca de comemoracao seria
  // autossabotagem publica.
  test('queda de posts NUNCA vira cartao', () => {
    const c = montarCartoes(mes({ posts: 8, postsMesAnterior: 20 }));
    assert.ok(!c.some((x) => x.numero.startsWith('-')));
    assert.ok(!c.some((x) => /mês passado/.test(x.rotulo)));
  });

  test('crescimento pequeno tambem fica de fora', () => {
    // +7% nao impressiona ninguem e ocupa um cartao que vale mais.
    const c = montarCartoes(mes({ posts: 16, postsMesAnterior: 15, alcance: 0, seguidoresGanhos: 0 }));
    assert.ok(!c.some((x) => /mês passado/.test(x.rotulo)));
  });

  test('crescimento forte entra', () => {
    const c = montarCartoes(mes({ posts: 30, postsMesAnterior: 15, alcance: 0, seguidoresGanhos: 0 }));
    assert.ok(c.some((x) => /mês passado/.test(x.rotulo)));
  });

  test('nenhum cartao sai com numero zerado', () => {
    const c = montarCartoes(mes({ alcance: 0, seguidoresGanhos: 0, comentarios: 0 }));
    assert.ok(!c.some((x) => x.numero === '0' || x.numero === '+0'));
  });

  test('mes minimo ainda gera cartao', () => {
    const c = montarCartoes({ posts: 4, curtidas: 20, comentarios: 0 });
    assert.ok(c.length >= 2);
  });
});

describe('montar', () => {
  test('titulo traz mes e marca', () => {
    const r = montar(mes(), 'Essenza', 8, 2026);
    assert.equal(r.titulo, 'agosto na Essenza');
    assert.equal(r.subtitulo, '2026');
  });

  // Uma retrospectiva sem pedido de interacao desperdica o unico post do
  // mes que a audiencia realmente quer comentar.
  test('a legenda ja vem com chamada para comentar', () => {
    const r = montar(mes(), 'Essenza', 8, 2026);
    assert.match(r.legendaSugerida, /Conta aqui/);
    assert.match(r.legendaSugerida, /Agosto/);
  });

  test('a legenda cita o numero principal', () => {
    const r = montar(mes(), 'Essenza', 8, 2026);
    assert.ok(r.legendaSugerida.includes(r.cartoes[0].numero));
  });
});

describe('montarHtml', () => {
  const r = montar(mes(), 'Essenza', 8, 2026);

  test('sai no formato de feed que mais ocupa a tela', () => {
    const h = montarHtml(r, '#E84393');
    assert.ok(h.includes('width:1080px'));
    assert.ok(h.includes('height:1350px'));
  });

  test('cor invalida cai no padrao em vez de quebrar o CSS', () => {
    const h = montarHtml(r, 'javascript:alert(1)');
    assert.ok(!h.includes('javascript:'));
    assert.ok(h.includes('#7c3aed'));
  });

  // Nome de marca com aspas ou tag quebraria a arte inteira.
  test('escapa o texto da marca', () => {
    const perigosa = montar(mes(), '<script>alert(1)</script>', 8, 2026);
    const h = montarHtml(perigosa, '#E84393');
    assert.ok(!h.includes('<script>'));
    assert.ok(h.includes('&lt;script&gt;'));
  });

  test('URL de logo maliciosa nao consegue fechar a tag', () => {
    const h = montarHtml(r, '#E84393', '"><img onerror=alert(1)>');
    // O que importa nao e a palavra "onerror" sumir — e ela virar texto
    // inerte dentro do atributo, sem conseguir escapar dele.
    assert.ok(h.includes('&quot;&gt;&lt;img'));
    assert.ok(!h.includes('"><img'));
  });

  test('sem logo, a arte continua valida', () => {
    assert.ok(!montarHtml(r, '#E84393', null).includes('<img'));
  });

  test('todos os cartoes aparecem na arte', () => {
    const h = montarHtml(r, '#E84393');
    for (const c of r.cartoes) assert.ok(h.includes(c.numero), `faltou o cartao ${c.numero}`);
  });
});
