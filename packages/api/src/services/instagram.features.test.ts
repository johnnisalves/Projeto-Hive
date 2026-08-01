import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  IgFeatures,
  tagsForImage,
  appendUserTags,
  appendUniversal,
  appendBrandedContent,
  appendLocation,
  appendCollaborators,
} from './instagram.service';

/**
 * Testes dos construtores de parametro da API do Instagram.
 *
 * O que esta sendo protegido aqui: mandar um parametro errado faz o Meta
 * rejeitar o container inteiro e a publicacao falha. Entao o que importa e
 * o formato exato (JSON, faixa 0–1, limites) e a ausencia do parametro
 * quando ele nao se aplica.
 */

const EAA = 'EAAtoken-do-facebook';
const IGAA = 'IGAAtoken-do-instagram';

function params() {
  return new URLSearchParams();
}

describe('tagsForImage', () => {
  const features: IgFeatures = {
    userTags: [
      { username: 'a', x: 0.1, y: 0.1, imageIndex: 0 },
      { username: 'b', x: 0.2, y: 0.2, imageIndex: 1 },
      { username: 'c', x: 0.3, y: 0.3 },
    ],
  };

  test('post simples pega as marcacoes sem indice e as do indice 0', () => {
    const r = tagsForImage(features).map((t) => t.username);
    assert.deepEqual(r, ['a', 'c']);
  });

  test('carrossel pega so as marcacoes da foto pedida', () => {
    assert.deepEqual(tagsForImage(features, 1).map((t) => t.username), ['b']);
  });

  test('foto sem marcacao devolve lista vazia', () => {
    assert.deepEqual(tagsForImage(features, 5), []);
  });
});

describe('appendUserTags', () => {
  test('serializa em JSON no formato que o Meta espera', () => {
    const p = params();
    appendUserTags(p, [{ username: 'joao', x: 0.25, y: 0.75, imageIndex: 0 }]);
    assert.deepEqual(JSON.parse(p.get('user_tags')!), [{ username: 'joao', x: 0.25, y: 0.75 }]);
  });

  test('remove o @ do inicio do usuario', () => {
    const p = params();
    appendUserTags(p, [{ username: '@maria', x: 0.5, y: 0.5, imageIndex: 0 }]);
    assert.equal(JSON.parse(p.get('user_tags')!)[0].username, 'maria');
  });

  test('imageIndex e interno e NAO vai para o Meta', () => {
    const p = params();
    appendUserTags(p, [{ username: 'x', x: 0.5, y: 0.5, imageIndex: 3 }]);
    assert.equal('imageIndex' in JSON.parse(p.get('user_tags')!)[0], false);
  });

  test('coordenadas fora da faixa sao presas entre 0 e 1', () => {
    const p = params();
    appendUserTags(p, [{ username: 'x', x: -2, y: 9, imageIndex: 0 }]);
    const tag = JSON.parse(p.get('user_tags')!)[0];
    assert.equal(tag.x, 0);
    assert.equal(tag.y, 1);
  });

  test('lista vazia nao cria o parametro', () => {
    const p = params();
    appendUserTags(p, []);
    assert.equal(p.has('user_tags'), false);
  });
});

describe('appendCollaborators', () => {
  test('serializa como array JSON sem @', () => {
    const p = params();
    appendCollaborators(p, { collaborators: ['@ana', 'bruno'] });
    assert.deepEqual(JSON.parse(p.get('collaborators')!), ['ana', 'bruno']);
  });

  test('corta no limite de 3 que a API aceita', () => {
    const p = params();
    appendCollaborators(p, { collaborators: ['a', 'b', 'c', 'd', 'e'] });
    assert.deepEqual(JSON.parse(p.get('collaborators')!), ['a', 'b', 'c']);
  });

  test('sem colaborador nao cria o parametro', () => {
    const p = params();
    appendCollaborators(p, {});
    assert.equal(p.has('collaborators'), false);
  });
});

describe('appendBrandedContent', () => {
  test('token do Facebook: manda patrocinadores e liga o selo', () => {
    const p = params();
    appendBrandedContent(p, { sponsorIds: ['123', '456'] }, EAA);
    assert.deepEqual(JSON.parse(p.get('branded_content_sponsor_ids')!), ['123', '456']);
    assert.equal(p.get('is_paid_partnership'), 'true');
  });

  test('corta no limite de 2 patrocinadores', () => {
    const p = params();
    appendBrandedContent(p, { sponsorIds: ['1', '2', '3'] }, EAA);
    assert.deepEqual(JSON.parse(p.get('branded_content_sponsor_ids')!), ['1', '2']);
  });

  test('selo sozinho, sem patrocinador, ainda funciona', () => {
    const p = params();
    appendBrandedContent(p, { isPaidPartnership: true }, EAA);
    assert.equal(p.get('is_paid_partnership'), 'true');
    assert.equal(p.has('branded_content_sponsor_ids'), false);
  });

  // O ponto critico: com token IGAA o Meta rejeita o container inteiro.
  // Preferimos publicar sem o selo a derrubar a publicacao.
  test('token do Instagram: NAO manda nada (evita derrubar o post)', () => {
    const p = params();
    appendBrandedContent(p, { sponsorIds: ['123'], isPaidPartnership: true }, IGAA);
    assert.equal(p.has('branded_content_sponsor_ids'), false);
    assert.equal(p.has('is_paid_partnership'), false);
  });

  test('sem publi pedida nao cria parametro em nenhum tipo de token', () => {
    for (const token of [EAA, IGAA]) {
      const p = params();
      appendBrandedContent(p, {}, token);
      assert.equal(p.has('is_paid_partnership'), false);
    }
  });
});

describe('appendLocation e appendUniversal', () => {
  test('localizacao entra quando informada', () => {
    const p = params();
    appendLocation(p, { locationId: '106377336067638' });
    assert.equal(p.get('location_id'), '106377336067638');
  });

  test('localizacao vazia ou nula nao cria parametro', () => {
    for (const locationId of ['', null, undefined]) {
      const p = params();
      appendLocation(p, { locationId });
      assert.equal(p.has('location_id'), false);
    }
  });

  test('declaracao de IA so entra quando marcada', () => {
    const on = params();
    appendUniversal(on, { isAiGenerated: true });
    assert.equal(on.get('is_ai_generated'), 'true');

    const off = params();
    appendUniversal(off, { isAiGenerated: false });
    assert.equal(off.has('is_ai_generated'), false);
  });
});
