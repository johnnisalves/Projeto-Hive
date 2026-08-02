import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCampaignSchedule, campaignSpanDays, slotsFor, recommendCadence, MAX_CADENCE,
} from './campaign';

/**
 * O que esta sendo protegido: uma data errada aqui vira post publicado na
 * madrugada, ou pior, publicado na hora porque o horario ja passou. Nada
 * disso aparece em revisao de codigo — so quando o post ja saiu.
 */

// Segunda, 04/08/2026, 07:00 — antes de qualquer slot do dia.
const manhaCedo = new Date(2026, 7, 4, 7, 0, 0);
// Mesmo dia, 20:00 — depois dos slots de 9h, 12h e 18h.
const noite = new Date(2026, 7, 4, 20, 0, 0);

describe('buildCampaignSchedule', () => {
  test('gera exatamente uma data por imagem', () => {
    for (const n of [1, 5, 10, 30]) {
      assert.equal(buildCampaignSchedule(n, 3, manhaCedo).length, n);
    }
  });

  test('1 por dia: um post por data, sempre ao meio-dia', () => {
    const d = buildCampaignSchedule(3, 1, manhaCedo);
    assert.deepEqual(d.map((x) => x.getHours()), [12, 12, 12]);
    assert.deepEqual(d.map((x) => x.getDate()), [4, 5, 6]);
  });

  test('3 por dia: enche o dia antes de passar para o proximo', () => {
    const d = buildCampaignSchedule(4, 3, manhaCedo);
    assert.deepEqual(d.map((x) => x.getHours()), [9, 12, 18, 9]);
    assert.deepEqual(d.map((x) => x.getDate()), [4, 4, 4, 5]);
  });

  test('6 por dia usa os seis horarios do dia', () => {
    const d = buildCampaignSchedule(6, 6, manhaCedo);
    assert.deepEqual(d.map((x) => x.getHours()), slotsFor(6));
  });

  // A regra mais importante: agendar no passado faria o worker publicar
  // tudo de uma vez, no ato.
  test('nunca agenda no passado', () => {
    for (const cadence of [1, 2, 3, 6] as const) {
      for (const agora of [manhaCedo, noite]) {
        for (const when of buildCampaignSchedule(10, cadence, agora)) {
          assert.ok(when.getTime() > agora.getTime(), `${cadence}/dia gerou ${when.toISOString()} antes de ${agora.toISOString()}`);
        }
      }
    }
  });

  test('a noite, pula os slots que ja passaram e comeca no proximo', () => {
    const d = buildCampaignSchedule(2, 3, noite);
    // As 20h, os slots 9/12/18 de hoje ja foram: comeca amanha as 9h.
    assert.equal(d[0].getDate(), 5);
    assert.equal(d[0].getHours(), 9);
    assert.equal(d[1].getHours(), 12);
  });

  test('as 20h com ritmo de 6, ainda cabe o slot das 21h de hoje', () => {
    const d = buildCampaignSchedule(2, 6, noite);
    assert.equal(d[0].getDate(), 4);
    assert.equal(d[0].getHours(), 21);
    assert.equal(d[1].getDate(), 5);
  });

  test('as datas saem em ordem crescente', () => {
    const d = buildCampaignSchedule(20, 3, manhaCedo);
    for (let i = 1; i < d.length; i++) {
      assert.ok(d[i].getTime() > d[i - 1].getTime(), 'datas fora de ordem');
    }
  });

  test('minutos e segundos zerados — post na hora cheia', () => {
    for (const when of buildCampaignSchedule(5, 2, manhaCedo)) {
      assert.equal(when.getMinutes(), 0);
      assert.equal(when.getSeconds(), 0);
    }
  });

  test('zero imagens devolve lista vazia', () => {
    assert.deepEqual(buildCampaignSchedule(0, 3, manhaCedo), []);
  });
});

/**
 * A barra deixa escolher qualquer ritmo, inclusive os que nao tem
 * curadoria de horario. Se slotsFor devolver hora repetida ou fora da
 * faixa, o dia perde um post ou ele sai de madrugada.
 */
describe('slotsFor', () => {
  test('todo ritmo de 1 a 8 tem a quantidade certa de horarios', () => {
    for (let n = 1; n <= MAX_CADENCE; n++) {
      assert.equal(slotsFor(n).length, n, `${n} por dia devolveu ${slotsFor(n).length} horarios`);
    }
  });

  test('horarios sempre em ordem, sem repetir', () => {
    for (let n = 1; n <= MAX_CADENCE; n++) {
      const s = slotsFor(n);
      assert.deepEqual(s, [...new Set(s)].sort((a, b) => a - b), `${n} por dia tem hora repetida ou fora de ordem`);
    }
  });

  test('nunca agenda de madrugada', () => {
    for (let n = 1; n <= MAX_CADENCE; n++) {
      for (const h of slotsFor(n)) {
        assert.ok(h >= 8 && h <= 21, `${n} por dia gerou ${h}h`);
      }
    }
  });

  test('valor fora da faixa e limitado, nao quebra', () => {
    assert.equal(slotsFor(0).length, 1);
    assert.equal(slotsFor(-5).length, 1);
    assert.equal(slotsFor(99).length, MAX_CADENCE);
  });

  test('ritmos sem curadoria (7 e 8) tambem funcionam', () => {
    assert.equal(buildCampaignSchedule(7, 7, manhaCedo).length, 7);
    assert.equal(buildCampaignSchedule(8, 8, manhaCedo).length, 8);
  });
});

describe('recommendCadence', () => {
  test('ate uma semana de conteudo: 1 por dia', () => {
    assert.equal(recommendCadence(3).perDay, 1);
    assert.equal(recommendCadence(7).perDay, 1);
  });

  test('mais que isso sobe o ritmo', () => {
    assert.equal(recommendCadence(8).perDay, 2);
    assert.equal(recommendCadence(20).perDay, 3);
    assert.equal(recommendCadence(50).perDay, 4);
  });

  test('a recomendacao sempre cabe na barra', () => {
    for (const n of [1, 5, 10, 25, 60, 200]) {
      const r = recommendCadence(n);
      assert.ok(r.perDay >= 1 && r.perDay <= MAX_CADENCE);
      assert.ok(r.why.length > 10, 'recomendacao sem explicacao');
    }
  });
});

describe('campaignSpanDays', () => {
  test('10 imagens a 2 por dia ocupam 5 dias', () => {
    assert.equal(campaignSpanDays(buildCampaignSchedule(10, 2, manhaCedo)), 5);
  });

  test('3 imagens a 1 por dia ocupam 3 dias', () => {
    assert.equal(campaignSpanDays(buildCampaignSchedule(3, 1, manhaCedo)), 3);
  });

  test('tudo no mesmo dia conta 1', () => {
    assert.equal(campaignSpanDays(buildCampaignSchedule(3, 3, manhaCedo)), 1);
  });

  test('lista vazia conta 0', () => {
    assert.equal(campaignSpanDays([]), 0);
  });
});
