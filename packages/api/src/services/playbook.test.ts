import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  exportar,
  aplicar,
  validar,
  resumir,
  CAMPOS_DO_PLAYBOOK,
  NUNCA_COPIAR,
  VERSAO_ATUAL,
} from './playbook.service';

/**
 * O PERIGO AQUI NAO E COPIAR DE MENOS, E COPIAR DE MAIS.
 *
 * Copiar a chave PIX de um cliente para outro manda dinheiro para a conta
 * errada. Copiar o WhatsApp faz o pedido de uma pizzaria cair no celular
 * de outra. Copiar o token de aprovacao da a um cliente acesso aos posts
 * do outro. A maior parte destes testes existe para provar que isso nao
 * acontece.
 */

const marcaCompleta = {
  id: 'b1',
  userId: 'u1',
  name: 'Pizzaria Essenza',
  logoUrl: 'https://x.com/logo.png',
  // Identidade e dinheiro — nada disso pode vazar para outra marca.
  pixKey: 'chave-secreta@essenza.com.br',
  pixCity: 'Petrolina',
  whatsappPhone: '87999998888',
  phone: '8738612222',
  feeCentavos: 150000,
  websiteUrl: 'https://essenza.com.br',
  instagramUrl: 'https://instagram.com/essenza',
  cidade: 'Petrolina',
  bioSlug: 'essenza',
  approvalToken: 'token-secreto-do-portal',
  isDefault: true,
  // Estilo e configuracao — isso sim e o playbook.
  voiceTone: 'descontraído e caloroso',
  tonePrompt: 'fale como um pizzaiolo animado',
  stylePrompt: 'cores quentes, foto de close',
  artDirection: 'nunca mostrar forno a lenha',
  defaultHashtags: ['pizza', 'petrolina'],
  defaultPlatforms: ['INSTAGRAM', 'FACEBOOK'],
  mixVender: 3, mixEducar: 4, mixEngajar: 3,
  cpmCentavos: 2500,
  autoPublicarPilares: ['educar'],
  primaryColor: '#E84393',
  secondaryColor: '#6C5CE7',
  fontFamily: 'Inter',
};

describe('exportar', () => {
  test('leva o estilo e a configuracao do nicho', () => {
    const p = exportar(marcaCompleta, { nome: 'Pizzaria' });
    assert.equal(p.config.voiceTone, 'descontraído e caloroso');
    assert.deepEqual(p.config.defaultHashtags, ['pizza', 'petrolina']);
    assert.equal(p.config.mixEducar, 4);
  });

  // O teste mais importante do arquivo.
  test('NAO leva chave PIX, WhatsApp, fee nem token de aprovacao', () => {
    const p = exportar(marcaCompleta, { nome: 'Pizzaria', incluirVisual: true });
    const serializado = JSON.stringify(p);

    assert.ok(!serializado.includes('chave-secreta'));
    assert.ok(!serializado.includes('87999998888'));
    assert.ok(!serializado.includes('token-secreto'));
    assert.ok(!serializado.includes('150000'));
    assert.ok(!serializado.includes('essenza.com.br'));
  });

  test('nenhum campo proibido aparece no playbook', () => {
    const p = exportar(marcaCompleta, { nome: 'Pizzaria', incluirVisual: true });
    const chaves = [...Object.keys(p.config), ...Object.keys(p.visual || {})];
    for (const proibido of NUNCA_COPIAR) {
      assert.ok(!chaves.includes(proibido), `vazou o campo "${proibido}"`);
    }
  });

  test('visual so entra quando pedido', () => {
    assert.equal(exportar(marcaCompleta, { nome: 'X' }).visual, undefined);
    assert.equal(exportar(marcaCompleta, { nome: 'X', incluirVisual: true }).visual!.primaryColor, '#E84393');
  });

  // Aplicar um playbook nao pode APAGAR o que ja estava preenchido na
  // marca nova.
  test('campo vazio nao entra no playbook', () => {
    const p = exportar({ ...marcaCompleta, voiceTone: '', artDirection: null, defaultHashtags: [] }, { nome: 'X' });
    assert.ok(!('voiceTone' in p.config));
    assert.ok(!('artDirection' in p.config));
    assert.ok(!('defaultHashtags' in p.config));
  });

  test('marca quase vazia gera playbook vazio, nao quebra', () => {
    const p = exportar({ id: 'x', name: 'Nova' }, { nome: 'Vazio' });
    assert.deepEqual(p.config, {});
  });

  test('carimba a versao e o nicho', () => {
    const p = exportar(marcaCompleta, { nome: 'Pizzaria', nicho: 'alimentação' });
    assert.equal(p.versao, VERSAO_ATUAL);
    assert.equal(p.nicho, 'alimentação');
  });
});

describe('aplicar', () => {
  test('devolve so o que pode ser gravado', () => {
    const p = exportar(marcaCompleta, { nome: 'Pizzaria' });
    const dados = aplicar(p);
    assert.equal(dados.voiceTone, 'descontraído e caloroso');
    assert.equal(dados.mixEducar, 4);
  });

  // O playbook pode ter sido editado a mao ou vindo de outra instalacao.
  // Confiar no conteudo dele seria confiar em entrada externa.
  test('playbook adulterado nao consegue injetar campo proibido', () => {
    const malicioso = {
      versao: 1,
      nome: 'Parece normal',
      config: {
        voiceTone: 'ok',
        pixKey: 'chave-do-atacante@x.com',
        whatsappPhone: '11999999999',
        approvalToken: 'token-roubado',
        userId: 'outro-usuario',
        feeCentavos: 1,
      },
    };
    const dados = aplicar(malicioso as any);
    assert.equal(dados.voiceTone, 'ok');
    assert.ok(!('pixKey' in dados));
    assert.ok(!('whatsappPhone' in dados));
    assert.ok(!('approvalToken' in dados));
    assert.ok(!('userId' in dados));
    assert.ok(!('feeCentavos' in dados));
  });

  test('cores so entram quando o usuario pede', () => {
    const p = exportar(marcaCompleta, { nome: 'X', incluirVisual: true });
    assert.ok(!('primaryColor' in aplicar(p)));
    assert.equal(aplicar(p, { aplicarVisual: true }).primaryColor, '#E84393');
  });

  test('playbook vazio nao gera gravacao nenhuma', () => {
    assert.deepEqual(aplicar({ versao: 1, nome: 'X', config: {} }), {});
    assert.deepEqual(aplicar({} as any), {});
  });

  test('valor nulo dentro do playbook e ignorado', () => {
    const dados = aplicar({ versao: 1, nome: 'X', config: { voiceTone: null, tonePrompt: '', stylePrompt: 'ok' } });
    assert.deepEqual(dados, { stylePrompt: 'ok' });
  });

  test('todo campo da allowlist e aceito', () => {
    const config = Object.fromEntries(CAMPOS_DO_PLAYBOOK.map((c) => [c, 'valor']));
    assert.equal(Object.keys(aplicar({ versao: 1, nome: 'X', config })).length, CAMPOS_DO_PLAYBOOK.length);
  });
});

describe('validar', () => {
  test('playbook bom passa', () => {
    const r = validar(exportar(marcaCompleta, { nome: 'Pizzaria' }));
    assert.ok(r.ok);
  });

  test('lixo e recusado com motivo', () => {
    assert.ok(!validar(null).ok);
    assert.ok(!validar('texto').ok);
    assert.ok(!validar({}).ok);
    assert.match(validar({ nome: 'X' }).erro!, /configuração/);
    assert.match(validar({ config: {} }).erro!, /nome/);
  });

  // Aplicar um playbook de versao futura poderia gravar campo com formato
  // que este codigo nao entende.
  test('versao mais nova que a nossa e recusada', () => {
    const r = validar({ versao: VERSAO_ATUAL + 1, nome: 'X', config: { voiceTone: 'a' } });
    assert.ok(!r.ok);
    assert.match(r.erro!, /versão mais nova/);
  });

  test('versao ausente ou antiga passa', () => {
    assert.ok(validar({ nome: 'X', config: { voiceTone: 'a' } }).ok);
  });
});

describe('resumir', () => {
  test('descreve em portugues o que vai ser aplicado', () => {
    const r = resumir({ voiceTone: 'a', defaultHashtags: ['x'] });
    assert.ok(r.includes('tom de voz'));
    assert.ok(r.includes('hashtags padrão'));
  });

  // mixVender/mixEducar/mixEngajar sao a mesma coisa para o usuario;
  // listar tres vezes "mix de conteudo" pareceria bug.
  test('campos do mesmo assunto viram um item so', () => {
    const r = resumir({ mixVender: 3, mixEducar: 4, mixEngajar: 3 });
    assert.deepEqual(r, ['mix de conteúdo']);
  });

  test('nada aplicado devolve lista vazia', () => {
    assert.deepEqual(resumir({}), []);
  });
});
