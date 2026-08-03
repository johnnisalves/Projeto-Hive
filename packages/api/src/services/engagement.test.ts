import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  mediaGeral,
  mediaPorFormato,
  mediaPorHora,
  temPergunta,
  temChamada,
  preverNota,
  MINIMO_HISTORICO,
} from './engagement.service';

/**
 * O risco aqui nao e crashar: e dar uma nota com cara de ciencia em cima de
 * ruido. Se a nota contradisser os numeros do proprio usuario, ele perde a
 * confianca na ferramenta inteira.
 */

const post = (over: Partial<any> = {}) => ({
  caption: 'Chegou a pizza nova de calabresa, vem provar. Comenta aqui o que achou',
  hashtags: ['pizza', 'petrolina'],
  publishMode: 'FEED',
  mediaType: 'IMAGE',
  scheduledAt: new Date(2026, 7, 3, 19, 0),
  ...over,
});

const hist = (n: number, over: Partial<any> = {}) =>
  Array.from({ length: n }, (_, i) => ({
    caption: 'post',
    publishMode: 'FEED',
    mediaType: 'IMAGE',
    publishedAt: new Date(2026, 6, (i % 28) + 1, 19, 0),
    engajamento: 100,
    ...over,
  }));

describe('mediaGeral', () => {
  test('tira a media do engajamento', () => {
    assert.equal(mediaGeral([...hist(2, { engajamento: 100 }), ...hist(2, { engajamento: 200 })]), 150);
  });

  // Post sem metrica coletada tem engajamento 0. Incluir na media puxaria
  // tudo para baixo e a nota condenaria posts bons.
  test('post sem metrica nao entra na conta', () => {
    assert.equal(mediaGeral([...hist(2, { engajamento: 100 }), ...hist(8, { engajamento: 0 })]), 100);
  });

  test('sem historico da zero, nao NaN', () => {
    assert.equal(mediaGeral([]), 0);
    assert.equal(mediaGeral(hist(5, { engajamento: 0 })), 0);
  });
});

describe('mediaPorFormato', () => {
  test('separa por formato e conta a amostra', () => {
    const r = mediaPorFormato([
      ...hist(3, { publishMode: 'REELS', engajamento: 300 }),
      ...hist(2, { publishMode: 'FEED', engajamento: 100 }),
    ]);
    assert.equal(r.REELS.media, 300);
    assert.equal(r.REELS.posts, 3);
    assert.equal(r.FEED.posts, 2);
  });
});

describe('mediaPorHora', () => {
  test('agrupa pela hora da publicacao', () => {
    const r = mediaPorHora([
      { caption: '', publishMode: 'FEED', mediaType: 'IMAGE', publishedAt: new Date(2026, 6, 1, 19, 30), engajamento: 200 },
      { caption: '', publishMode: 'FEED', mediaType: 'IMAGE', publishedAt: new Date(2026, 6, 2, 19, 5), engajamento: 100 },
    ]);
    assert.equal(r[19].media, 150);
    assert.equal(r[19].posts, 2);
  });
});

describe('temPergunta / temChamada', () => {
  test('acha a pergunta', () => {
    assert.ok(temPergunta('Qual seu sabor favorito?'));
    assert.ok(!temPergunta('Chegou a pizza nova.'));
  });

  test('acha a chamada para acao', () => {
    assert.ok(temChamada('Comenta aqui'));
    assert.ok(temChamada('Link na bio'));
    assert.ok(temChamada('Corre que acaba hoje'));
    assert.ok(!temChamada('Chegou a pizza nova.'));
  });

  // \b em JavaScript usa [A-Za-z0-9_], entao uma palavra logo apos acento
  // nunca casaria. Ja foi bug real neste projeto.
  test('funciona com acento colado na palavra', () => {
    assert.ok(temChamada('Promoção! comenta aí'));
    assert.ok(temChamada('É hoje, garanta o seu'));
  });

  test('nao confunde palavra parecida', () => {
    assert.ok(!temChamada('recomendado por todos'));
  });

  // O erro mais irritante possivel numa feature que da conselho: penalizar
  // uma legenda que TEM chamada para acao porque ela foi escrita com
  // acento — que e como a pessoa realmente escreve.
  test('chamada acentuada conta como chamada', () => {
    assert.ok(temChamada('Peça já o seu'));
    assert.ok(temChamada('Agende seu horário'));
    assert.ok(temChamada('Reserve sua mesa'));
  });
});

describe('preverNota', () => {
  // Com pouco historico, "media da conta" e ruido: tres posts com um viral
  // no meio fariam a nota condenar tudo que nao for viral.
  test('sem historico suficiente, nao inventa nota', () => {
    const r = preverNota(post(), hist(MINIMO_HISTORICO - 1));
    assert.equal(r.nota, null);
    assert.match(r.base, new RegExp(String(MINIMO_HISTORICO)));
  });

  test('conta nova nao quebra', () => {
    assert.equal(preverNota(post(), []).nota, null);
  });

  test('com historico, devolve nota e motivos', () => {
    const r = preverNota(post(), hist(20));
    assert.ok(r.nota! > 0);
    assert.ok(r.motivos.length > 0);
  });

  test('nota nunca sai da faixa, nem no melhor nem no pior caso', () => {
    const otimo = preverNota(
      post({ caption: 'Qual seu sabor favorito? Comenta aqui embaixo que eu respondo!', publishMode: 'REELS' }),
      [...hist(20, { publishMode: 'REELS', engajamento: 5000 }), ...hist(10, { engajamento: 10 })],
    );
    const pessimo = preverNota(
      post({ caption: 'oi', hashtags: [], publishMode: 'REELS' }),
      [...hist(20, { publishMode: 'REELS', engajamento: 5 }), ...hist(10, { engajamento: 900 })],
    );
    assert.ok(otimo.nota! <= 95 && otimo.nota! >= 5);
    assert.ok(pessimo.nota! <= 95 && pessimo.nota! >= 5);
  });

  test('formato que rende mais nesta conta sobe a nota', () => {
    const historico = [...hist(10, { publishMode: 'REELS', engajamento: 400 }), ...hist(10, { engajamento: 100 })];
    const comReels = preverNota(post({ publishMode: 'REELS' }), historico);
    const comFeed = preverNota(post({ publishMode: 'FEED' }), historico);
    assert.ok(comReels.nota! > comFeed.nota!);
    assert.ok(comReels.motivos.some((m) => /acima da média/.test(m.texto)));
  });

  // Um unico Reels que viralizou nao pode fazer a nota mandar publicar so
  // Reels para sempre.
  test('amostra pequena de um formato nao vira recomendacao', () => {
    const historico = [...hist(1, { publishMode: 'REELS', engajamento: 9999 }), ...hist(20, { engajamento: 100 })];
    const r = preverNota(post({ publishMode: 'REELS' }), historico);
    assert.ok(!r.motivos.some((m) => /REELS/.test(m.texto)));
  });

  test('legenda sem chamada perde ponto e explica o porque', () => {
    const semCta = preverNota(post({ caption: 'Chegou a pizza nova de calabresa hoje na casa' }), hist(20));
    assert.ok(semCta.motivos.some((m) => m.impacto < 0 && /chamada/.test(m.texto)));
  });

  test('legenda curta demais e apontada', () => {
    const r = preverNota(post({ caption: 'oi' }), hist(20));
    assert.ok(r.motivos.some((m) => /curta/.test(m.texto)));
  });

  test('sem hashtag e hashtag demais sao ambos apontados', () => {
    assert.ok(preverNota(post({ hashtags: [] }), hist(20)).motivos.some((m) => /hashtag/i.test(m.texto)));
    const muitas = Array.from({ length: 30 }, (_, i) => `t${i}`);
    assert.ok(preverNota(post({ hashtags: muitas }), hist(20)).motivos.some((m) => /spam/.test(m.texto)));
  });

  // Nota sem motivo e inutil: o usuario nao aprende nada e nao sabe o que
  // mudar. Os motivos vem ordenados pelo que mais pesa.
  test('os motivos vem do que mais pesa para o que menos pesa', () => {
    const r = preverNota(post({ caption: 'oi', hashtags: [] }), hist(20));
    const pesos = r.motivos.map((m) => Math.abs(m.impacto));
    assert.deepEqual(pesos, [...pesos].sort((a, b) => b - a));
  });
});
