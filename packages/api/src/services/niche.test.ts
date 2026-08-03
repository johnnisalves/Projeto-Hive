import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  nichoDe,
  elogiosDoNicho,
  chamadasDoNicho,
  pautaDeClima,
  opcoes,
  NICHOS,
  GENERICO,
  ELOGIOS_GERAIS,
} from './niche.service';

/**
 * A REGRA QUE MANDA: nicho desconhecido cai no GENERICO, NUNCA em comida.
 *
 * O sistema nasceu com cara de ferramenta de pizzaria. Uma sugestao neutra
 * serve para todo mundo; uma sugestao do ramo errado envergonha o cliente
 * na frente do publico dele.
 */

describe('nichoDe', () => {
  test('acha o nicho pela chave', () => {
    assert.equal(nichoDe('beleza').rotulo, 'Beleza e estética');
    assert.equal(nichoDe('juridico').chave, 'juridico');
  });

  test('aceita a chave em qualquer caixa', () => {
    assert.equal(nichoDe('BELEZA').chave, 'beleza');
  });

  // O teste mais importante do arquivo.
  test('chave desconhecida, nula ou vazia cai no generico — nunca em comida', () => {
    for (const entrada of [null, undefined, '', 'inventado', 'pizzaria']) {
      const n = nichoDe(entrada as any);
      assert.equal(n.chave, 'generico', `"${entrada}" deveria cair no generico`);
      assert.notEqual(n.chave, 'alimentacao');
    }
  });

  test('o generico nao carrega termo de ramo nenhum', () => {
    assert.deepEqual(GENERICO.elogios, []);
    assert.deepEqual(GENERICO.chamadas, []);
  });
});

describe('elogiosDoNicho / chamadasDoNicho', () => {
  test('todo nicho herda os termos gerais', () => {
    for (const n of [...NICHOS, GENERICO]) {
      const e = elogiosDoNicho(n.chave);
      for (const geral of ELOGIOS_GERAIS) assert.ok(e.includes(geral), `${n.chave} perdeu "${geral}"`);
    }
  });

  test('cada ramo acrescenta os proprios', () => {
    assert.ok(elogiosDoNicho('alimentacao').includes('delici'));
    assert.ok(elogiosDoNicho('beleza').includes('ficou lind'));
    assert.ok(chamadasDoNicho('saude').includes('marque sua consulta'));
  });

  // Uma clinica nao pode ter "delicioso" como sinal de elogio, nem um
  // restaurante "marque sua consulta".
  test('termo de um ramo nao vaza para outro', () => {
    assert.ok(!elogiosDoNicho('juridico').includes('delici'));
    assert.ok(!elogiosDoNicho('saude').includes('saboros'));
    assert.ok(!chamadasDoNicho('alimentacao').includes('marque sua consulta'));
  });

  test('generico devolve so os gerais', () => {
    assert.deepEqual(elogiosDoNicho(null), ELOGIOS_GERAIS);
  });
});

describe('pautaDeClima', () => {
  // O ABSURDO QUE ISTO EVITA: um escritorio de advocacia postando
  // "noite de chuva pede advogado".
  test('ramo em que o clima nao muda a demanda nao gera pauta', () => {
    for (const chave of ['juridico', 'saude', 'imobiliario', 'educacao', 'beleza', 'automotivo']) {
      assert.equal(pautaDeClima(chave, 'chuva', 'Petrolina'), null, `${chave} nao deveria ter pauta de clima`);
    }
  });

  test('ramo em que o clima importa gera pauta com a cidade', () => {
    const p = pautaDeClima('alimentacao', 'chuva', 'Petrolina')!;
    assert.match(p, /Petrolina/);
    assert.match(p, /chuva/);
  });

  test('cada ramo liga o clima ao que ELE vende', () => {
    assert.match(pautaDeClima('alimentacao', 'chuva', 'Recife')!, /pedir em casa/);
    assert.match(pautaDeClima('fitness', 'chuva', 'Recife')!, /treino/);
    assert.match(pautaDeClima('eventos', 'chuva', 'Recife')!, /cobert/);
  });

  test('nicho desconhecido nunca gera pauta de clima', () => {
    assert.equal(pautaDeClima(null, 'chuva', 'Petrolina'), null);
    assert.equal(pautaDeClima('inventado', 'frio', 'Petrolina'), null);
  });

  test('sem condicao de clima, nao ha pauta', () => {
    assert.equal(pautaDeClima('alimentacao', null, 'Petrolina'), null);
  });

  // Um nicho pode ligar para chuva e nao para calor; o gancho ausente nao
  // pode virar texto quebrado.
  test('condicao sem gancho no ramo devolve null, nao frase pela metade', () => {
    const semGancho = NICHOS.find((n) => n.climaImporta && n.pautasDeClima && !n.pautasDeClima.calor);
    if (semGancho) assert.equal(pautaDeClima(semGancho.chave, 'calor', 'Recife'), null);
  });
});

describe('catalogo', () => {
  test('nenhuma chave repetida', () => {
    const chaves = NICHOS.map((n) => n.chave);
    assert.equal(new Set(chaves).size, chaves.length);
  });

  test('todo nicho tem rotulo e contexto para a IA', () => {
    for (const n of NICHOS) {
      assert.ok(n.rotulo.length > 2, `${n.chave} sem rotulo`);
      assert.ok(n.contextoIA.length > 10, `${n.chave} sem contexto`);
    }
  });

  // Saude e juridico tem limite de publicidade profissional. O contexto
  // precisa carregar a restricao, senao a IA gera peca que da problema no
  // conselho de classe.
  test('ramos regulados carregam a restricao no contexto', () => {
    assert.match(nichoDe('saude').contextoIA, /Nunca prometa cura|sem promessa de resultado/i);
    assert.match(nichoDe('juridico').contextoIA, /NUNCA prometa resultado/i);
  });

  test('quem diz que o clima importa tem as pautas', () => {
    for (const n of NICHOS.filter((x) => x.climaImporta)) {
      assert.ok(n.pautasDeClima, `${n.chave} diz que clima importa mas nao tem pauta`);
    }
  });

  test('as opcoes da tela incluem o generico por ultimo', () => {
    const o = opcoes();
    assert.equal(o[o.length - 1].chave, 'generico');
    assert.equal(o.length, NICHOS.length + 1);
  });
});
