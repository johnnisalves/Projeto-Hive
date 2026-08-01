import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { defaultIgOptions, igOptionsToPayload, IgOptions } from './ig-options';

/**
 * Testes da montagem do payload enviado a API.
 *
 * O que esta sendo protegido: mandar campo vazio grava lixo no banco e vira
 * parametro invalido no Meta; deixar de mandar um campo preenchido faz o
 * recurso sumir sem erro nenhum — o post publica, so que sem a marcacao.
 */

function withOptions(patch: Partial<IgOptions>): IgOptions {
  return { ...defaultIgOptions(), ...patch };
}

describe('igOptionsToPayload', () => {
  test('estado padrao nao manda nada', () => {
    assert.deepEqual(igOptionsToPayload(defaultIgOptions()), {});
  });

  test('campos so de espacos em branco sao ignorados', () => {
    const p = igOptionsToPayload(withOptions({ locationId: '   ', altText: '  ', audioName: ' ', coverUrl: '  ' }));
    assert.deepEqual(p, {});
  });

  test('texto e enviado sem espacos nas pontas', () => {
    const p = igOptionsToPayload(withOptions({ altText: '  foto do produto  ', locationId: ' 123 ' }));
    assert.equal(p.altText, 'foto do produto');
    assert.equal(p.locationId, '123');
  });

  test('marcacoes vao completas, com as coordenadas', () => {
    const userTags = [{ username: 'joao', x: 0.2, y: 0.8, imageIndex: 1 }];
    assert.deepEqual(igOptionsToPayload(withOptions({ userTags })).userTags, userTags);
  });

  // shareToFeed=true e o padrao da coluna no banco: mandar seria redundante.
  test('shareToFeed so viaja quando desmarcado', () => {
    assert.equal('shareToFeed' in igOptionsToPayload(withOptions({ shareToFeed: true })), false);
    assert.equal(igOptionsToPayload(withOptions({ shareToFeed: false })).shareToFeed, false);
  });

  test('volume so acompanha quando ha audio escolhido', () => {
    const semAudio = igOptionsToPayload(withOptions({ audioVolume: 30 }));
    assert.equal('audioVolume' in semAudio, false);

    const comAudio = igOptionsToPayload(withOptions({ audioUrl: 'https://x/a.mp3', audioVolume: 30 }));
    assert.equal(comAudio.audioUrl, 'https://x/a.mp3');
    assert.equal(comAudio.audioVolume, 30);
  });

  test('volume zero e enviado (0 e uma escolha, nao "vazio")', () => {
    const p = igOptionsToPayload(withOptions({ audioUrl: 'https://x/a.mp3', audioVolume: 0 }));
    assert.equal(p.audioVolume, 0);
  });

  test('nome do arquivo de audio e so da interface, nao vai para a API', () => {
    const p = igOptionsToPayload(withOptions({ audioUrl: 'https://x/a.mp3', audioFileName: 'trilha.mp3' }));
    assert.equal('audioFileName' in p, false);
  });

  test('booleanos desmarcados nao viajam', () => {
    const p = igOptionsToPayload(withOptions({ isAiGenerated: false, isPaidPartnership: false }));
    assert.equal('isAiGenerated' in p, false);
    assert.equal('isPaidPartnership' in p, false);
  });

  test('post completo monta todos os campos', () => {
    const p = igOptionsToPayload(withOptions({
      userTags: [{ username: 'ana', x: 0.5, y: 0.5, imageIndex: 0 }],
      collaborators: ['parceiro'],
      locationId: '999',
      altText: 'descricao',
      shareToFeed: false,
      audioName: 'trilha da campanha',
      coverUrl: 'https://x/capa.jpg',
      audioUrl: 'https://x/a.mp3',
      audioVolume: 60,
      isAiGenerated: true,
      isPaidPartnership: true,
      sponsorIds: ['777'],
    }));

    assert.deepEqual(Object.keys(p).sort(), [
      'altText', 'audioName', 'audioUrl', 'audioVolume', 'collaborators',
      'coverUrl', 'isAiGenerated', 'isPaidPartnership', 'locationId',
      'shareToFeed', 'sponsorIds', 'userTags',
    ]);
  });
});
