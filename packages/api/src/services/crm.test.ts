import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  podeMover,
  exigeValor,
  resumoDoFunil,
  receitaPorPost,
  paradoHaDias,
  esquecidos,
  ETAPAS,
  DIAS_PARADO,
  Etapa,
} from './crm.service';

/**
 * O numero que sai daqui e o que a agencia leva pro cliente: "as DMs
 * viraram R$ 3.200". Inflar esse numero e pior que nao ter numero nenhum.
 */

const agora = new Date(2026, 7, 15, 12, 0, 0);
const diasAtras = (n: number) => new Date(agora.getTime() - n * 86_400_000);

const lead = (etapa: Etapa, over: Partial<any> = {}) => ({
  etapa,
  valorCentavos: null,
  postId: null,
  criadoEm: diasAtras(5),
  atualizadoEm: diasAtras(1),
  ...over,
});

describe('podeMover', () => {
  test('anda para frente', () => {
    assert.ok(podeMover('novo', 'respondido'));
    assert.ok(podeMover('orcamento', 'fechado'));
  });

  // No mundo real o cliente some, o atendente marca "perdido" e ele volta
  // duas semanas depois. Um funil so-para-frente forcaria criar lead
  // duplicado, e a atribuicao ao post de origem se perderia.
  test('voltar atras e permitido', () => {
    assert.ok(podeMover('perdido', 'respondido'));
    assert.ok(podeMover('fechado', 'orcamento'));
  });

  test('mover para a mesma etapa nao e movimento', () => {
    for (const e of ETAPAS) assert.ok(!podeMover(e, e));
  });

  test('etapa inventada e recusada', () => {
    assert.ok(!podeMover('novo', 'inventada' as Etapa));
    assert.ok(!podeMover('inventada' as Etapa, 'novo'));
  });
});

describe('exigeValor', () => {
  // Lead "fechado" sem valor destroi o unico numero que o funil existe
  // para produzir.
  test('so fechar exige valor', () => {
    assert.ok(exigeValor('fechado'));
    assert.ok(!exigeValor('perdido'));
    assert.ok(!exigeValor('orcamento'));
    assert.ok(!exigeValor('novo'));
  });
});

describe('resumoDoFunil', () => {
  test('conta leads e valor por etapa', () => {
    const r = resumoDoFunil([
      lead('novo'),
      lead('respondido'),
      lead('fechado', { valorCentavos: 8000 }),
      lead('fechado', { valorCentavos: 12000 }),
      lead('perdido'),
    ]);

    assert.equal(r.abertos, 2);
    assert.equal(r.fechados, 2);
    assert.equal(r.perdidos, 1);
    assert.equal(r.receitaCentavos, 20000);
    assert.equal(r.porEtapa.novo.leads, 1);
  });

  // Leads abertos nao perderam nada. Conta-los no denominador faria a taxa
  // despencar so por ter movimento novo no inbox — punindo justamente a
  // semana em que o marketing funcionou.
  test('a conversao ignora quem ainda esta em aberto', () => {
    const r = resumoDoFunil([
      lead('fechado', { valorCentavos: 100 }),
      lead('perdido'),
      ...Array.from({ length: 50 }, () => lead('novo')),
    ]);
    assert.equal(r.taxaConversao, 50);
  });

  test('sem nada decidido, a conversao e null e nao zero', () => {
    const r = resumoDoFunil([lead('novo'), lead('respondido')]);
    assert.equal(r.taxaConversao, null);
    assert.equal(r.ticketMedioCentavos, null);
  });

  test('ticket medio divide pelo numero de fechados', () => {
    const r = resumoDoFunil([
      lead('fechado', { valorCentavos: 10000 }),
      lead('fechado', { valorCentavos: 20000 }),
    ]);
    assert.equal(r.ticketMedioCentavos, 15000);
  });

  test('so o que fechou entra na receita', () => {
    const r = resumoDoFunil([
      lead('orcamento', { valorCentavos: 999900 }),
      lead('fechado', { valorCentavos: 5000 }),
    ]);
    assert.equal(r.receitaCentavos, 5000);
  });

  test('lista vazia devolve zeros, nao NaN', () => {
    const r = resumoDoFunil([]);
    assert.equal(r.receitaCentavos, 0);
    assert.equal(r.taxaConversao, null);
    assert.equal(r.ticketMedioCentavos, null);
  });

  // Dado velho ou corrompido nao pode derrubar a tela do funil.
  test('etapa desconhecida cai em "novo" em vez de sumir', () => {
    const r = resumoDoFunil([lead('lixo' as Etapa)]);
    assert.equal(r.porEtapa.novo.leads, 1);
    assert.equal(r.abertos, 1);
  });

  test('valor nulo nao vira NaN na soma', () => {
    const r = resumoDoFunil([lead('fechado', { valorCentavos: null }), lead('fechado', { valorCentavos: 5000 })]);
    assert.equal(r.receitaCentavos, 5000);
  });
});

describe('receitaPorPost', () => {
  test('agrupa por post e ordena pelo que mais rendeu', () => {
    const r = receitaPorPost([
      lead('fechado', { postId: 'p1', valorCentavos: 5000 }),
      lead('fechado', { postId: 'p2', valorCentavos: 30000 }),
      lead('novo', { postId: 'p1' }),
    ]);
    assert.equal(r[0].postId, 'p2');
    assert.equal(r[1].postId, 'p1');
    assert.equal(r[1].leads, 2);
  });

  // Somar orcamento enviado como receita inflaria o numero que a agencia
  // leva pro cliente.
  test('so lead fechado vira receita do post', () => {
    const r = receitaPorPost([
      lead('orcamento', { postId: 'p1', valorCentavos: 999900 }),
      lead('perdido', { postId: 'p1', valorCentavos: 500000 }),
    ]);
    assert.equal(r[0].receitaCentavos, 0);
    assert.equal(r[0].leads, 2);
  });

  test('lead sem post de origem fica de fora', () => {
    assert.deepEqual(receitaPorPost([lead('fechado', { valorCentavos: 5000 })]), []);
  });

  test('empate na receita desempata pelo numero de leads', () => {
    const r = receitaPorPost([
      lead('novo', { postId: 'poucos' }),
      lead('novo', { postId: 'muitos' }),
      lead('novo', { postId: 'muitos' }),
    ]);
    assert.equal(r[0].postId, 'muitos');
  });
});

describe('paradoHaDias / esquecidos', () => {
  test('conta os dias desde o ultimo movimento', () => {
    assert.equal(paradoHaDias(lead('novo', { atualizadoEm: diasAtras(4) }), agora), 4);
  });

  // Lead finalizado nao esta parado: esta pronto. Cobrar o atendente por
  // ele seria ruido que faz o alerta inteiro ser ignorado.
  test('lead fechado ou perdido nunca aparece como parado', () => {
    assert.equal(paradoHaDias(lead('fechado', { atualizadoEm: diasAtras(90) }), agora), null);
    assert.equal(paradoHaDias(lead('perdido', { atualizadoEm: diasAtras(90) }), agora), null);
  });

  test('so os parados ha tempo suficiente entram na lista', () => {
    const r = esquecidos([
      lead('novo', { atualizadoEm: diasAtras(DIAS_PARADO - 1) }),
      lead('respondido', { atualizadoEm: diasAtras(DIAS_PARADO) }),
      lead('orcamento', { atualizadoEm: diasAtras(10) }),
    ], agora);
    assert.equal(r.length, 2);
  });

  test('o mais esquecido aparece primeiro', () => {
    const r = esquecidos([
      lead('novo', { atualizadoEm: diasAtras(4) }),
      lead('novo', { atualizadoEm: diasAtras(20) }),
    ], agora);
    assert.equal(new Date(r[0].atualizadoEm).getTime(), diasAtras(20).getTime());
  });

  test('lista vazia nao quebra', () => {
    assert.deepEqual(esquecidos([], agora), []);
  });
});
