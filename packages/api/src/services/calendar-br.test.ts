import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { datasDoMes, datasMoveis, DATAS_FIXAS } from './calendar-br';

/**
 * O que esta sendo protegido: Dia das Maes, dos Pais e Black Friday mudam
 * de dia todo ano. Errar significa o piloto automatico agendar a campanha
 * da maior data de venda do cliente no dia errado — e ninguem confere 30
 * rascunhos um por um.
 */

describe('datas moveis', () => {
  // Conferidos no calendario real.
  const casos = [
    { ano: 2026, maes: 10, pais: 9, black: 27 },
    { ano: 2025, maes: 11, pais: 10, black: 28 },
    { ano: 2024, maes: 12, pais: 11, black: 29 },
  ];

  for (const c of casos) {
    test(`${c.ano}: Dia das Mães cai em ${c.maes}/05`, () => {
      const d = datasMoveis(c.ano).find((x) => x.nome === 'Dia das Mães');
      assert.equal(d?.dia, c.maes);
    });

    test(`${c.ano}: Dia dos Pais cai em ${c.pais}/08`, () => {
      const d = datasMoveis(c.ano).find((x) => x.nome === 'Dia dos Pais');
      assert.equal(d?.dia, c.pais);
    });

    test(`${c.ano}: Black Friday cai em ${c.black}/11`, () => {
      const d = datasMoveis(c.ano).find((x) => x.nome === 'Black Friday');
      assert.equal(d?.dia, c.black);
    });
  }

  test('Dia das Mães é sempre domingo', () => {
    for (let ano = 2024; ano <= 2035; ano++) {
      const d = datasMoveis(ano).find((x) => x.nome === 'Dia das Mães')!;
      assert.equal(new Date(ano, 4, d.dia).getDay(), 0, `${ano} nao caiu em domingo`);
    }
  });

  test('Dia dos Pais é sempre domingo', () => {
    for (let ano = 2024; ano <= 2035; ano++) {
      const d = datasMoveis(ano).find((x) => x.nome === 'Dia dos Pais')!;
      assert.equal(new Date(ano, 7, d.dia).getDay(), 0, `${ano} nao caiu em domingo`);
    }
  });

  test('Black Friday é sempre sexta-feira de novembro', () => {
    for (let ano = 2024; ano <= 2035; ano++) {
      const d = datasMoveis(ano).find((x) => x.nome === 'Black Friday')!;
      assert.equal(new Date(ano, 10, d.dia).getDay(), 5, `${ano} nao caiu em sexta`);
      assert.ok(d.dia >= 23 && d.dia <= 29, `${ano} caiu em ${d.dia}, fora da ultima semana`);
    }
  });

  // Quando a Black Friday cai em 29/11, a Cyber Monday atravessa para
  // dezembro. Comparamos datas reais, nao subtracao de dias, senao o teste
  // esconderia exatamente esse caso.
  test('Cyber Monday cai na segunda seguinte à Black Friday, mesmo virando o mês', () => {
    for (let ano = 2024; ano <= 2035; ano++) {
      const moveis = datasMoveis(ano);
      const bf = moveis.find((x) => x.nome === 'Black Friday')!;
      const cm = moveis.find((x) => x.nome === 'Cyber Monday')!;

      const dBf = new Date(ano, bf.mes - 1, bf.dia);
      const dCm = new Date(ano, cm.mes - 1, cm.dia);

      assert.equal(dCm.getDay(), 1, `${ano}: Cyber Monday nao caiu em segunda`);
      assert.equal(
        Math.round((dCm.getTime() - dBf.getTime()) / 86_400_000), 3,
        `${ano}: nao sao 3 dias depois da Black Friday`,
      );
    }
  });

  test('a virada de mês da Cyber Monday é rotulada como dezembro', () => {
    // 2024: Black Friday 29/11 -> Cyber Monday 02/12
    const cm = datasMoveis(2024).find((x) => x.nome === 'Cyber Monday')!;
    assert.equal(cm.mes, 12);
    assert.equal(cm.dia, 2);
    // E ela NAO pode aparecer no calendario de novembro
    assert.ok(!datasDoMes(2024, 11).some((d) => d.nome === 'Cyber Monday'));
    assert.ok(datasDoMes(2024, 12).some((d) => d.nome === 'Cyber Monday'));
  });
});

describe('datasDoMes', () => {
  test('maio traz Dia do Trabalhador e Dia das Mães', () => {
    const nomes = datasDoMes(2026, 5).map((d) => d.nome);
    assert.ok(nomes.includes('Dia do Trabalhador'));
    assert.ok(nomes.includes('Dia das Mães'));
  });

  test('vem ordenado por dia', () => {
    for (let mes = 1; mes <= 12; mes++) {
      const dias = datasDoMes(2026, mes).map((d) => d.dia);
      assert.deepEqual(dias, [...dias].sort((a, b) => a - b), `mes ${mes} fora de ordem`);
    }
  });

  // Data de ramo poluiria o calendario de quem vende outra coisa.
  test('Dia da Pizza só aparece para quem é do ramo', () => {
    assert.ok(datasDoMes(2026, 7, 'pizzaria').some((d) => d.nome === 'Dia da Pizza'));
    assert.ok(datasDoMes(2026, 7, 'restaurante').some((d) => d.nome === 'Dia da Pizza'));
    assert.ok(!datasDoMes(2026, 7, 'advocacia').some((d) => d.nome === 'Dia da Pizza'));
    assert.ok(!datasDoMes(2026, 7).some((d) => d.nome === 'Dia da Pizza'));
  });

  test('datas gerais aparecem para qualquer ramo', () => {
    for (const ramo of ['pizzaria', 'advocacia', 'academia', undefined]) {
      assert.ok(datasDoMes(2026, 12, ramo).some((d) => d.nome === 'Natal'), `Natal sumiu para ${ramo}`);
    }
  });

  test('todo mês do ano tem pelo menos uma data', () => {
    for (let mes = 1; mes <= 12; mes++) {
      assert.ok(datasDoMes(2026, mes).length > 0, `mes ${mes} ficou vazio`);
    }
  });

  test('nenhum dia inválido na lista fixa', () => {
    for (const d of DATAS_FIXAS) {
      assert.ok(d.mes >= 1 && d.mes <= 12, `${d.nome}: mes invalido`);
      if (d.dia !== undefined) assert.ok(d.dia >= 1 && d.dia <= 31, `${d.nome}: dia invalido`);
    }
  });
});
