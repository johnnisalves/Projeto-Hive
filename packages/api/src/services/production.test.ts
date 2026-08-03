import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  oQueFalta,
  podeProduzir,
  ordenarPorUrgencia,
  separarPorTeto,
  progresso,
  temaDoPost,
  MAX_POR_PEDIDO,
  PostParaProduzir,
} from './production.service';

/**
 * Esta fila gera IMAGEM, e imagem custa dinheiro. Os testes aqui protegem
 * duas coisas: nao gastar credito a toa, e entregar primeiro o que publica
 * primeiro.
 */

const post = (over: Partial<PostParaProduzir> = {}): PostParaProduzir => ({
  id: 'p1',
  caption: null,
  imageUrl: null,
  videoUrl: null,
  nanoPrompt: 'promoção de terça na pizzaria',
  scheduledAt: new Date(2026, 7, 10),
  status: 'DRAFT',
  ...over,
});

describe('oQueFalta', () => {
  test('rascunho do piloto: falta tudo', () => {
    assert.equal(oQueFalta(post()), 'ambos');
  });

  test('so legenda, so arte, ou nada', () => {
    assert.equal(oQueFalta(post({ imageUrl: 'x.jpg' })), 'legenda');
    assert.equal(oQueFalta(post({ caption: 'Uma legenda de verdade aqui' })), 'arte');
    assert.equal(oQueFalta(post({ caption: 'Uma legenda de verdade aqui', imageUrl: 'x.jpg' })), null);
  });

  // Gerar imagem para um post de video gastaria credito produzindo algo que
  // ninguem usaria.
  test('post com video nao precisa de arte', () => {
    assert.equal(oQueFalta(post({ videoUrl: 'v.mp4', caption: 'Legenda completa aqui' })), null);
    assert.equal(oQueFalta(post({ videoUrl: 'v.mp4' })), 'legenda');
  });

  // Legenda de duas letras nao e legenda; sem esse piso, um post com "oi"
  // seria dado como pronto.
  test('legenda curta demais conta como ausente', () => {
    assert.equal(oQueFalta(post({ caption: 'oi', imageUrl: 'x.jpg' })), 'legenda');
    assert.equal(oQueFalta(post({ caption: '   ', imageUrl: 'x.jpg' })), 'legenda');
  });
});

describe('podeProduzir', () => {
  test('rascunho com tema entra', () => {
    assert.ok(podeProduzir(post()));
    assert.ok(podeProduzir(post({ status: 'SCHEDULED' })));
  });

  // Produzir para um post publicado sobrescreveria o que esta no ar.
  test('publicado, falho ou publicando NAO entram', () => {
    for (const status of ['PUBLISHED', 'FAILED', 'PUBLISHING', 'PARTIAL']) {
      assert.ok(!podeProduzir(post({ status })), `${status} nao deveria entrar`);
    }
  });

  test('post ja pronto nao entra de novo', () => {
    assert.ok(!podeProduzir(post({ caption: 'Legenda pronta aqui', imageUrl: 'x.jpg' })));
  });

  // Sem tema a IA nao tem sobre o que escrever nem desenhar — o job
  // gastaria uma chamada para produzir algo generico.
  test('post sem tema nenhum nao entra', () => {
    assert.ok(!podeProduzir(post({ nanoPrompt: null, caption: null })));
    assert.ok(!podeProduzir(post({ nanoPrompt: '   ', caption: '' })));
  });

  test('legenda serve de tema quando so falta a arte', () => {
    assert.ok(podeProduzir(post({ nanoPrompt: null, caption: 'Chegou a pizza nova de calabresa' })));
  });
});

describe('ordenarPorUrgencia', () => {
  // Se 30 entram e so 10 terminam a tempo, voce quer os 10 mais proximos,
  // nao 10 sorteados.
  test('o que publica antes fica pronto antes', () => {
    const r = ordenarPorUrgencia([
      post({ id: 'tarde', scheduledAt: new Date(2026, 7, 20) }),
      post({ id: 'cedo', scheduledAt: new Date(2026, 7, 2) }),
      post({ id: 'meio', scheduledAt: new Date(2026, 7, 10) }),
    ]);
    assert.deepEqual(r.map((p) => p.id), ['cedo', 'meio', 'tarde']);
  });

  test('post sem data vai para o fim: nao tem prazo', () => {
    const r = ordenarPorUrgencia([
      post({ id: 'sem-data', scheduledAt: null }),
      post({ id: 'com-data', scheduledAt: new Date(2026, 7, 20) }),
    ]);
    assert.deepEqual(r.map((p) => p.id), ['com-data', 'sem-data']);
  });

  // Sem desempate estavel, a fila dancaria entre duas chamadas e a tela
  // mostraria uma ordem diferente a cada atualizacao.
  test('empate desempata igual sempre', () => {
    const mesmaData = new Date(2026, 7, 10);
    const entrada = [post({ id: 'b', scheduledAt: mesmaData }), post({ id: 'a', scheduledAt: mesmaData })];
    assert.deepEqual(ordenarPorUrgencia(entrada).map((p) => p.id), ['a', 'b']);
    assert.deepEqual(ordenarPorUrgencia([...entrada].reverse()).map((p) => p.id), ['a', 'b']);
  });

  test('nao altera a lista recebida', () => {
    const entrada = [post({ id: 'b', scheduledAt: new Date(2026, 7, 20) }), post({ id: 'a', scheduledAt: new Date(2026, 7, 1) })];
    ordenarPorUrgencia(entrada);
    assert.equal(entrada[0].id, 'b');
  });

  test('lista vazia nao quebra', () => {
    assert.deepEqual(ordenarPorUrgencia([]), []);
  });
});

describe('separarPorTeto', () => {
  // Sem teto, um clique errado enfileiraria centenas de geracoes de imagem
  // e o usuario so descobriria pela fatura.
  test('o que passa do teto fica de fora, e e devolvido', () => {
    const muitos = Array.from({ length: MAX_POR_PEDIDO + 15 }, (_, i) => ({ id: String(i) }));
    const r = separarPorTeto(muitos);
    assert.equal(r.entram.length, MAX_POR_PEDIDO);
    assert.equal(r.sobram.length, 15);
  });

  test('nada e perdido no corte', () => {
    const muitos = Array.from({ length: 100 }, (_, i) => ({ id: String(i) }));
    const r = separarPorTeto(muitos);
    assert.equal(r.entram.length + r.sobram.length, 100);
  });

  test('abaixo do teto passa tudo', () => {
    const r = separarPorTeto([{ id: '1' }, { id: '2' }]);
    assert.equal(r.entram.length, 2);
    assert.equal(r.sobram.length, 0);
  });
});

describe('progresso', () => {
  test('conta o que ja esta pronto', () => {
    const r = progresso([
      post({ caption: 'Legenda pronta aqui', imageUrl: 'x.jpg' }),
      post(),
      post(),
      post(),
    ]);
    assert.equal(r.total, 4);
    assert.equal(r.prontos, 1);
    assert.equal(r.faltando, 3);
    assert.equal(r.porcentagem, 25);
  });

  // Mostrar 100% com um post ainda na fila faz o usuario abrir a tela e
  // encontrar trabalho pela frente.
  test('arredonda para baixo: nunca promete 100% cedo demais', () => {
    const quase = [
      ...Array.from({ length: 99 }, () => post({ caption: 'Legenda pronta aqui', imageUrl: 'x.jpg' })),
      post(),
    ];
    assert.equal(progresso(quase).porcentagem, 99);
  });

  test('tudo pronto da 100', () => {
    assert.equal(progresso([post({ caption: 'Legenda pronta aqui', imageUrl: 'x.jpg' })]).porcentagem, 100);
  });

  test('lista vazia nao vira NaN', () => {
    const r = progresso([]);
    assert.equal(r.porcentagem, 100);
    assert.equal(r.total, 0);
  });
});

describe('temaDoPost', () => {
  test('usa o tema que o piloto gravou', () => {
    assert.equal(temaDoPost(post()), 'promoção de terça na pizzaria');
  });

  test('cai na legenda quando nao ha tema', () => {
    assert.equal(temaDoPost(post({ nanoPrompt: null, caption: 'Chegou a pizza nova' })), 'Chegou a pizza nova');
  });

  test('tema gigante e cortado antes de virar prompt', () => {
    assert.equal(temaDoPost(post({ nanoPrompt: 'x'.repeat(900) })).length, 500);
  });

  test('sem nada devolve string vazia, nao undefined', () => {
    assert.equal(temaDoPost(post({ nanoPrompt: null, caption: null })), '');
  });
});
