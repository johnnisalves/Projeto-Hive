import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { legendaCurtaStatus, bitrateStatusKbps } from './whatsapp.service';

describe('legendaCurtaStatus', () => {
  test('usa so o primeiro paragrafo da legenda', () => {
    const legenda = 'Cabe uma viagem num globo? 🔮\n\nEu achei que nao.\n\n#viagem #familia';
    assert.equal(legendaCurtaStatus(legenda), 'Cabe uma viagem num globo? 🔮');
  });

  test('tira hashtags do primeiro paragrafo', () => {
    assert.equal(legendaCurtaStatus('Dia de praia #mar #sol'), 'Dia de praia');
  });

  test('legenda vazia vira texto vazio', () => {
    assert.equal(legendaCurtaStatus(null), '');
    assert.equal(legendaCurtaStatus(''), '');
  });

  test('corta textos muito longos', () => {
    assert.equal(legendaCurtaStatus('a'.repeat(900)).length, 700);
  });
});

describe('bitrateStatusKbps', () => {
  test('o arquivo cabe em ~9 MB para qualquer duracao ate 59 s', () => {
    for (const s of [15, 30, 36, 59]) {
      const kbps = bitrateStatusKbps(s);
      const mb = ((kbps + 112) * s) / 8 / 1024;
      assert.ok(mb <= 9.5, `${s}s deu ${mb.toFixed(1)} MB`);
    }
  });

  test('video longo e tratado como 59 s (ele e cortado)', () => {
    assert.equal(bitrateStatusKbps(120), bitrateStatusKbps(59));
  });

  test('video curto nao passa do teto de qualidade', () => {
    assert.equal(bitrateStatusKbps(5), 2500);
  });
});
