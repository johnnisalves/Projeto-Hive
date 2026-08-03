import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  naJanelaDaNoite,
  avaliarPrevisao,
  podeDisparar,
  pautaPara,
  PROB_CHUVA,
  TEMP_FRIA,
  TEMP_QUENTE,
  DIAS_ENTRE_DISPAROS,
} from './weather.service';

const h = (hora: string, chuvaProb: number, temperatura: number) => ({ hora, chuvaProb, temperatura });

describe('naJanelaDaNoite', () => {
  test('pega a janela em que o cliente decide se sai de casa', () => {
    assert.ok(naJanelaDaNoite('2026-08-02T18:00'));
    assert.ok(naJanelaDaNoite('2026-08-02T21:00'));
    assert.ok(naJanelaDaNoite('2026-08-02T23:00'));
  });

  test('fora da janela nao conta', () => {
    assert.ok(!naJanelaDaNoite('2026-08-02T04:00'));
    assert.ok(!naJanelaDaNoite('2026-08-02T14:00'));
    assert.ok(!naJanelaDaNoite('2026-08-02T17:00'));
  });

  // Ler a hora da string em vez de passar por Date evita o JS interpretar
  // como UTC e deslocar 3 horas — a janela da noite cairia na tarde e o
  // gatilho olharia o clima errado.
  test('nao desloca por fuso', () => {
    assert.ok(naJanelaDaNoite('2026-12-31T19:00'));
    assert.ok(!naJanelaDaNoite('2026-12-31T15:00'));
  });

  test('formato estranho nao vira falso positivo', () => {
    assert.ok(!naJanelaDaNoite('sem-hora'));
    assert.ok(!naJanelaDaNoite(''));
  });
});

describe('avaliarPrevisao', () => {
  test('chuva provavel a noite vira gatilho', () => {
    const r = avaliarPrevisao([h('2026-08-02T19:00', 80, 25), h('2026-08-02T20:00', 75, 24)]);
    assert.equal(r.condicao, 'chuva');
    assert.match(r.detalhe, /80%/);
  });

  test('chuva de madrugada nao dispara nada', () => {
    // Chuva as 4 da manha nao muda o faturamento de ninguem.
    const r = avaliarPrevisao([h('2026-08-02T04:00', 95, 22), h('2026-08-02T20:00', 5, 26)]);
    assert.equal(r.condicao, null);
  });

  test('chance baixa de chuva nao dispara', () => {
    const r = avaliarPrevisao([h('2026-08-02T20:00', PROB_CHUVA - 1, 26)]);
    assert.equal(r.condicao, null);
  });

  test('exatamente no limiar ja dispara', () => {
    assert.equal(avaliarPrevisao([h('2026-08-02T20:00', PROB_CHUVA, 26)]).condicao, 'chuva');
  });

  test('noite fria vira gatilho de frio', () => {
    assert.equal(avaliarPrevisao([h('2026-08-02T20:00', 10, TEMP_FRIA)]).condicao, 'frio');
  });

  test('noite quente vira gatilho de calor', () => {
    assert.equal(avaliarPrevisao([h('2026-08-02T20:00', 10, TEMP_QUENTE)]).condicao, 'calor');
  });

  // Chuva muda mais o comportamento de sair de casa que temperatura.
  test('chuva ganha de frio quando os dois batem', () => {
    const r = avaliarPrevisao([h('2026-08-02T20:00', 90, 15)]);
    assert.equal(r.condicao, 'chuva');
  });

  test('noite amena nao gera post nenhum', () => {
    assert.equal(avaliarPrevisao([h('2026-08-02T20:00', 5, 25)]).condicao, null);
  });

  test('sem dados nao quebra', () => {
    assert.equal(avaliarPrevisao([]).condicao, null);
    assert.equal(avaliarPrevisao([h('2026-08-02T03:00', 90, 20)]).condicao, null);
  });
});

describe('podeDisparar', () => {
  const agora = new Date(2026, 7, 2, 12, 0, 0);
  const diasAtras = (n: number) => new Date(agora.getTime() - n * 86_400_000);

  test('primeira vez sempre pode', () => {
    assert.ok(podeDisparar(null, agora));
    assert.ok(podeDisparar(undefined, agora));
  });

  // Em semana de chuva o gatilho dispararia todo dia e o perfil viraria um
  // disco riscado — o seguidor cansa e o alcance cai.
  test('nao repete no dia seguinte', () => {
    assert.ok(!podeDisparar(diasAtras(1), agora));
    assert.ok(!podeDisparar(diasAtras(2), agora));
  });

  test('depois da trava, libera', () => {
    assert.ok(podeDisparar(diasAtras(DIAS_ENTRE_DISPAROS), agora));
    assert.ok(podeDisparar(diasAtras(10), agora));
  });
});

describe('pautaPara', () => {
  test('cada condicao gera pauta com a cidade', () => {
    assert.match(pautaPara('chuva', 'Petrolina')!, /Petrolina/);
    assert.match(pautaPara('frio', 'Recife')!, /Recife/);
    assert.match(pautaPara('calor', 'Juazeiro')!, /Juazeiro/);
  });

  test('sem condicao nao gera pauta', () => {
    assert.equal(pautaPara(null, 'Petrolina'), null);
  });
});
