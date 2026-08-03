import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  minutosGastos,
  custoCentavos,
  classificar,
  calcular,
  feeSugerido,
  ranquear,
  MINUTOS_PADRAO,
  MARGEM_SAUDAVEL,
} from './profitability.service';

/**
 * Este numero pode fazer a agencia demitir um cliente. Se ele estiver
 * errado, o estrago e maior que qualquer bug de tela — por isso o codigo
 * prefere devolver null a devolver um numero que nao da pra confiar.
 */

const esforco = (over: Partial<any> = {}) => ({ posts: 12, artes: 8, respostas: 40, tarefas: 3, ...over });

describe('minutosGastos', () => {
  test('soma cada atividade pelo seu peso', () => {
    const m = minutosGastos({ posts: 1, artes: 1, respostas: 1, tarefas: 1 });
    assert.equal(m, MINUTOS_PADRAO.post + MINUTOS_PADRAO.arte + MINUTOS_PADRAO.resposta + MINUTOS_PADRAO.tarefa);
  });

  test('aceita tabela propria da agencia', () => {
    const m = minutosGastos({ posts: 2, artes: 0, respostas: 0, tarefas: 0 }, { post: 5, arte: 0, resposta: 0, tarefa: 0 });
    assert.equal(m, 10);
  });

  test('marca sem movimento da zero', () => {
    assert.equal(minutosGastos({ posts: 0, artes: 0, respostas: 0, tarefas: 0 }), 0);
  });
});

describe('custoCentavos', () => {
  test('converte minutos em dinheiro pela hora', () => {
    // 120 minutos a R$ 50/h = R$ 100
    assert.equal(custoCentavos(120, 5000), 10000);
  });

  test('sem custo/hora nao inventa custo', () => {
    assert.equal(custoCentavos(120, 0), 0);
  });

  // Arredondar por atividade acumularia erro e o total nao fecharia com a
  // soma das linhas na tela.
  test('arredonda uma vez so, no fim', () => {
    assert.equal(custoCentavos(7, 5000), Math.round((7 / 60) * 5000));
  });
});

describe('classificar', () => {
  test('margem negativa e prejuizo', () => {
    assert.equal(classificar(-1), 'prejuizo');
    assert.equal(classificar(-40), 'prejuizo');
  });

  test('margem zero e apertado, nao prejuizo', () => {
    assert.equal(classificar(0), 'apertado');
  });

  test('no limiar ja e saudavel', () => {
    assert.equal(classificar(MARGEM_SAUDAVEL - 1), 'apertado');
    assert.equal(classificar(MARGEM_SAUDAVEL), 'saudavel');
  });
});

describe('calcular', () => {
  test('faz a conta completa', () => {
    // 12 posts (240) + 8 artes (120) + 40 respostas (120) + 3 tarefas (90) = 570 min
    // 570 min a R$ 60/h = R$ 570. Fee R$ 1500 -> margem R$ 930 (62%)
    const r = calcular(esforco(), 150000, 6000)!;
    assert.equal(r.minutos, 570);
    assert.equal(r.custoCentavos, 57000);
    assert.equal(r.margemCentavos, 93000);
    assert.equal(r.margemPct, 62);
    assert.equal(r.situacao, 'saudavel');
  });

  test('cliente que consome mais do que paga aparece como prejuizo', () => {
    const r = calcular(esforco({ posts: 40, respostas: 300 }), 80000, 6000)!;
    assert.ok(r.margemCentavos < 0);
    assert.equal(r.situacao, 'prejuizo');
  });

  // Mostrar "0% de margem" seria pior que nao mostrar nada: a agencia
  // leria como prejuizo e poderia demitir um cliente lucrativo.
  test('sem fee ou sem custo/hora devolve null, nao zero', () => {
    assert.equal(calcular(esforco(), null, 6000), null);
    assert.equal(calcular(esforco(), 0, 6000), null);
    assert.equal(calcular(esforco(), 150000, null), null);
    assert.equal(calcular(esforco(), 150000, 0), null);
  });

  test('marca sem movimento nenhum da margem cheia', () => {
    const r = calcular({ posts: 0, artes: 0, respostas: 0, tarefas: 0 }, 150000, 6000)!;
    assert.equal(r.custoCentavos, 0);
    assert.equal(r.margemPct, 100);
  });
});

describe('feeSugerido', () => {
  test('devolve o preco que fecha a margem alvo', () => {
    // Custo R$ 570 com margem alvo de 30% -> R$ 814,29
    assert.equal(feeSugerido(57000, 30), Math.round(57000 / 0.7));
  });

  test('usa a margem saudavel por padrao', () => {
    assert.equal(feeSugerido(57000), feeSugerido(57000, MARGEM_SAUDAVEL));
  });

  // Margem de 100% faria o preco tender ao infinito e a tela mostraria
  // um numero absurdo.
  test('margem impossivel e limitada em vez de explodir', () => {
    const r = feeSugerido(10000, 100);
    assert.ok(Number.isFinite(r));
    assert.equal(r, feeSugerido(10000, 95));
  });

  test('sem custo nao sugere preco', () => {
    assert.equal(feeSugerido(0), 0);
  });
});

describe('ranquear', () => {
  const linha = (nome: string, margemPct: number | undefined, temConta: boolean) => ({
    id: nome, nome, esforco: esforco(), margemPct, temConta,
  });

  test('quem sangra primeiro aparece primeiro', () => {
    const r = ranquear([
      linha('Boa', 70, true),
      linha('Prejuizo', -20, true),
      linha('Apertada', 12, true),
    ]);
    assert.deepEqual(r.map((l) => l.nome), ['Prejuizo', 'Apertada', 'Boa']);
  });

  // Marca sem configuracao nao e um problema de rentabilidade; enche-la no
  // topo esconderia os clientes que realmente dao prejuizo.
  test('marca sem conta possivel vai para o fim', () => {
    const r = ranquear([
      linha('SemFee', undefined, false),
      linha('Prejuizo', -20, true),
    ]);
    assert.deepEqual(r.map((l) => l.nome), ['Prejuizo', 'SemFee']);
  });

  test('as sem conta ficam em ordem alfabetica entre si', () => {
    const r = ranquear([linha('Zebra', undefined, false), linha('Abelha', undefined, false)]);
    assert.deepEqual(r.map((l) => l.nome), ['Abelha', 'Zebra']);
  });

  test('lista vazia nao quebra', () => {
    assert.deepEqual(ranquear([]), []);
  });

  test('nao altera a lista original', () => {
    const entrada = [linha('B', 10, true), linha('A', -5, true)];
    ranquear(entrada);
    assert.equal(entrada[0].nome, 'B');
  });
});
