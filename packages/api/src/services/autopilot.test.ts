import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { planejarMes, sequenciaDePilares, resumoDoPlano, MIX_PADRAO, Pilar } from './autopilot.service';

/**
 * O piloto automatico gera 30 rascunhos de uma vez e ninguem confere um por
 * um. Um erro aqui vira post agendado no passado, mes inteiro concentrado
 * numa semana, ou uma data forte esquecida — tudo silencioso.
 */

// Referencia fixa para os testes: 15/03/2026.
const hoje = new Date(2026, 2, 15, 10, 0, 0);

describe('planejarMes', () => {
  test('gera pautas para o mês inteiro quando ele ainda não começou', () => {
    const p = planejarMes({ ano: 2026, mes: 6, postsPorSemana: 3, hoje });
    assert.ok(p.length >= 12, `esperava ~13, veio ${p.length}`);
  });

  // A regra mais importante: agendar no passado faz o worker publicar tudo
  // de uma vez, no ato.
  test('nunca planeja para um dia que já passou', () => {
    const p = planejarMes({ ano: 2026, mes: 3, postsPorSemana: 5, hoje });
    for (const pauta of p) {
      assert.ok(pauta.data.getTime() > hoje.getTime(), `${pauta.data.toISOString()} esta no passado`);
    }
  });

  test('mês já terminado devolve lista vazia', () => {
    assert.deepEqual(planejarMes({ ano: 2026, mes: 3, postsPorSemana: 3, hoje: new Date(2026, 2, 31, 23, 0) }), []);
  });

  test('as pautas saem em ordem de data', () => {
    const p = planejarMes({ ano: 2026, mes: 9, postsPorSemana: 4, hoje });
    for (let i = 1; i < p.length; i++) {
      assert.ok(p[i].data.getTime() >= p[i - 1].data.getTime(), 'fora de ordem');
    }
  });

  test('não repete o mesmo dia', () => {
    const p = planejarMes({ ano: 2026, mes: 10, postsPorSemana: 5, hoje });
    const dias = p.map((x) => x.data.getDate());
    assert.equal(new Set(dias).size, dias.length, 'dia repetido no plano');
  });

  // Data forte esquecida e o pior erro possivel: o cliente perde a venda do
  // ano e so descobre depois.
  test('datas fortes sempre entram, mesmo com ritmo baixo', () => {
    const dez = planejarMes({ ano: 2026, mes: 12, postsPorSemana: 1, hoje });
    assert.ok(dez.some((p) => p.dataComemorativa === 'Natal'), 'Natal ficou de fora');

    const maio = planejarMes({ ano: 2026, mes: 5, postsPorSemana: 1, hoje });
    assert.ok(maio.some((p) => p.dataComemorativa === 'Dia das Mães'), 'Dia das Maes ficou de fora');
  });

  test('data comemorativa forte vira post de venda', () => {
    const p = planejarMes({ ano: 2026, mes: 12, postsPorSemana: 3, hoje });
    const natal = p.find((x) => x.dataComemorativa === 'Natal')!;
    assert.equal(natal.pilar, 'vender');
    assert.equal(natal.prioridade, 3);
  });

  test('respeita o ramo do negócio', () => {
    const pizzaria = planejarMes({ ano: 2026, mes: 7, postsPorSemana: 3, ramo: 'pizzaria', hoje });
    assert.ok(pizzaria.some((p) => p.dataComemorativa === 'Dia da Pizza'));

    const advocacia = planejarMes({ ano: 2026, mes: 7, postsPorSemana: 3, ramo: 'advocacia', hoje });
    assert.ok(!advocacia.some((p) => p.dataComemorativa === 'Dia da Pizza'));
  });

  // Concentrar o mes na primeira semana e um erro que so aparece olhando o
  // calendario — o total de posts fica certo.
  test('espalha pelo mês em vez de amontoar no começo', () => {
    const p = planejarMes({ ano: 2026, mes: 6, postsPorSemana: 3, hoje });
    const naPrimeiraSemana = p.filter((x) => x.data.getDate() <= 7).length;
    assert.ok(naPrimeiraSemana <= Math.ceil(p.length / 2), `${naPrimeiraSemana} de ${p.length} na 1a semana`);
  });

  test('toda pauta tem tema preenchido', () => {
    for (const p of planejarMes({ ano: 2026, mes: 8, postsPorSemana: 5, hoje })) {
      assert.ok(p.tema.length > 10, 'tema vazio ou curto demais');
    }
  });

  test('ritmo absurdo é limitado, não quebra', () => {
    const p = planejarMes({ ano: 2026, mes: 6, postsPorSemana: 999, hoje });
    assert.ok(p.length <= 31, `gerou ${p.length} pautas em um mes`);
  });
});

describe('sequenciaDePilares', () => {
  test('respeita a proporção pedida', () => {
    const s = sequenciaDePilares(10, MIX_PADRAO);
    assert.equal(s.length, 10);
    const vender = s.filter((x) => x === 'vender').length;
    assert.ok(vender >= 2 && vender <= 4, `venda apareceu ${vender}x de 10`);
  });

  // Agrupar geraria uma semana so de venda seguida de uma so de dica.
  test('intercala os pilares em vez de agrupar', () => {
    const s = sequenciaDePilares(9, MIX_PADRAO);
    let maiorSequencia = 1;
    let atual = 1;
    for (let i = 1; i < s.length; i++) {
      atual = s[i] === s[i - 1] ? atual + 1 : 1;
      maiorSequencia = Math.max(maiorSequencia, atual);
    }
    assert.ok(maiorSequencia <= 3, `${maiorSequencia} posts iguais seguidos`);
  });

  test('mix só de venda gera só venda', () => {
    const s = sequenciaDePilares(5, { vender: 1, educar: 0, engajar: 0 });
    assert.ok(s.every((x) => x === 'vender'));
  });

  test('mix zerado não quebra', () => {
    const s = sequenciaDePilares(3, { vender: 0, educar: 0, engajar: 0 } as Record<Pilar, number>);
    assert.equal(s.length, 3);
  });
});

describe('resumoDoPlano', () => {
  test('conta total, comemorativas e pilares', () => {
    const p = planejarMes({ ano: 2026, mes: 12, postsPorSemana: 3, hoje });
    const r = resumoDoPlano(p);
    assert.equal(r.total, p.length);
    assert.equal(r.porPilar.vender + r.porPilar.educar + r.porPilar.engajar, p.length);
    assert.ok(r.comemorativas >= 2, 'dezembro deveria ter Natal e Reveillon');
  });
});
