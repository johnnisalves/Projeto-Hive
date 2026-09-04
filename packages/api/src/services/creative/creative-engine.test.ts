import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {
  getFormatSpec,
  safeAreaPx,
  geminiAspectRatio,
  openRouterAspectRatio,
  huggingFaceDimensions,
} from './format-spec';
import {
  detectNiche,
  resolveCreativeMode,
  buildCreativePlanSystemPrompt,
  planToImagePrompt,
  buildNegativePrompt,
  type CreativeInput,
  type CreativePlan,
} from './creative-engine';
import { normalizeToSpec } from './image-normalize';

const baseInput: CreativeInput = {
  topic: 'Pizzaria premium chegando em Petrolina',
  brand: { name: 'Bella Napoli', primaryColor: '#E63946', secondaryColor: '#F1FAEE' },
  headline: 'Chegou em Petrolina',
  format: 'ig-feed',
  creativeMode: 'auto',
  creativeIntensity: 'balanced',
  variationSeed: 7,
};

test('formatos resolvem para o canvas correto', () => {
  const cases: Record<string, [number, number, string]> = {
    'ig-feed': [1080, 1350, '4:5'],
    'ig-feed-square': [1080, 1080, '1:1'],
    'ig-stories': [1080, 1920, '9:16'],
    'yt-thumbnail': [1280, 720, '16:9'],
    'tw-post': [1200, 675, '16:9'],
    '4:5': [1080, 1350, '4:5'],
    '9:16': [1080, 1920, '9:16'],
  };
  for (const [fmt, [w, h, r]] of Object.entries(cases)) {
    const s = getFormatSpec(fmt);
    assert.equal(s.width, w, fmt);
    assert.equal(s.height, h, fmt);
    assert.equal(s.ratio, r, fmt);
  }
});

test('safe area de stories = 14% topo / 15% base', () => {
  const s = safeAreaPx(getFormatSpec('ig-stories'));
  assert.equal(s.top, 269);
  assert.equal(s.bottom, 288);
  assert.equal(safeAreaPx(getFormatSpec('ig-feed')).top, undefined);
});

test('providers recebem o aspect ratio certo (nunca 1:1 forcado)', () => {
  assert.equal(geminiAspectRatio(getFormatSpec('ig-feed')), '4:5');
  assert.equal(geminiAspectRatio(getFormatSpec('ig-stories')), '9:16');
  assert.equal(geminiAspectRatio(getFormatSpec('ig-feed-square')), '1:1');
  assert.equal(openRouterAspectRatio(getFormatSpec('yt-thumbnail')), '16:9');
  const feed = huggingFaceDimensions(getFormatSpec('ig-feed'));
  assert.equal(feed.width, 816);
  assert.equal(feed.height, 1024);
  const story = huggingFaceDimensions(getFormatSpec('ig-stories'));
  assert.equal(story.width, 576);
  assert.equal(story.height, 1024);
});

test('deteccao de nicho', () => {
  const cases: [string, string][] = [
    ['Pizzaria premium chegando em Petrolina', 'food'],
    ['Promoção de hambúrguer artesanal', 'food'],
    ['Clínica odontológica moderna', 'health'],
    ['Imobiliária de luxo em Recife', 'realestate'],
    ['Loja de moda feminina, nova coleção', 'fashion'],
    ['Empresa de energia solar', 'energy'],
    ['Tecnologia SaaS para gestão', 'tech'],
    ['Salão de beleza e barbearia', 'beauty'],
    ['Oficina mecânica e estética automotiva', 'automotive'],
    ['Escola bilíngue matrículas abertas', 'education'],
  ];
  for (const [brief, want] of cases) {
    assert.equal(detectNiche(brief, null), want, brief);
  }
});

test('modo automatico por nicho', () => {
  assert.equal(resolveCreativeMode('auto', 'food'), 'food');
  assert.equal(resolveCreativeMode('auto', 'health'), 'humanized');
  assert.equal(resolveCreativeMode('auto', 'realestate'), 'luxury');
  assert.equal(resolveCreativeMode('auto', 'tech'), 'minimal');
  assert.equal(resolveCreativeMode('pop', 'food'), 'pop', 'escolha manual vence auto');
  assert.equal(resolveCreativeMode('modo-inexistente', 'food'), 'food', 'invalido cai no auto do nicho');
});

test('nao forca fundo escuro e injeta regras de food', () => {
  const sys = buildCreativePlanSystemPrompt(baseInput);
  assert.match(sys, /never a default/i);
  assert.doesNotMatch(sys, /#0a0a0f|#1B1B1B/i);
  assert.match(sys, /food styling/i);
  assert.match(sys, /4:5/);
  assert.match(sys, /1080x1350/);
  assert.match(sys, /never invent a price/i);
});

test('diversidade: 10 seeds -> 10 prompts distintos', () => {
  const prompts = new Set<string>();
  for (let seed = 0; seed < 10; seed++) {
    prompts.add(buildCreativePlanSystemPrompt({ ...baseInput, variationSeed: seed }));
  }
  assert.equal(prompts.size, 10);
});

test('foto do usuario e logo', () => {
  const plan: CreativePlan = {
    objective: 'o', audience: 'a', concept: 'c', visualHook: 'v', primarySubject: 's',
    composition: 'comp', palette: 'pal', typographyMood: 'typo', lighting: 'light',
    camera: 'cam', environment: 'env', emotion: 'emo', headline: 'Chegou em Petrolina',
    cta: 'Peça já', negativeInstructions: 'nada',
  };
  const withPhoto = planToImagePrompt(plan, { ...baseInput, hasUserPhoto: true, bakeText: true });
  assert.match(withPhoto, /Generate NO human figure/i);
  assert.match(withPhoto, /35-45%/);
  assert.match(withPhoto, /Do not draw, letter or invent a logo/i);
  const noPhoto = planToImagePrompt(plan, { ...baseInput, hasUserPhoto: false, bakeText: true });
  assert.doesNotMatch(noPhoto, /Generate NO human figure/i);
  assert.match(noPhoto, /correct anatomy, natural hands/i);
});

test('bakeText controla se ha texto no prompt', () => {
  const plan: CreativePlan = {
    objective: 'o', audience: 'a', concept: 'c', visualHook: 'v', primarySubject: 's',
    composition: 'comp', palette: 'pal', typographyMood: 'typo', lighting: 'light',
    camera: 'cam', environment: 'env', emotion: 'emo', headline: 'Chegou em Petrolina',
    cta: 'Peça já', negativeInstructions: 'nada',
  };
  assert.match(planToImagePrompt(plan, { ...baseInput, bakeText: true }), /TEXT TO RENDER/);
  assert.match(planToImagePrompt(plan, { ...baseInput, bakeText: false }), /Render NO text/);
});

test('negative prompt sempre bloqueia texto e fundo escuro padrao', () => {
  const neg = buildNegativePrompt(null);
  assert.match(neg, /text/);
  assert.match(neg, /default dark gradient background/);
});

test('normalizacao entrega o canvas exato (cover-crop, sem distorcer)', async () => {
  const synth = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 255, g: 85, b: 51 } } }).png().toBuffer();
  const cases: [number, number, string][] = [
    [1024, 1024, 'ig-feed'],
    [1024, 1792, 'ig-feed'],
    [1024, 1024, 'ig-stories'],
    [1792, 1024, 'ig-feed'],
    [816, 1024, 'ig-feed'],
    [1024, 1024, 'yt-thumbnail'],
  ];
  for (const [w, h, fmt] of cases) {
    const spec = getFormatSpec(fmt);
    const out = await normalizeToSpec(await synth(w, h), spec);
    const meta = await sharp(out.buffer).metadata();
    assert.equal(meta.width, spec.width, `${w}x${h} -> ${fmt} width`);
    assert.equal(meta.height, spec.height, `${w}x${h} -> ${fmt} height`);
  }
});

test('logoPlacement: normaliza valores invalidos', async () => {
  const { normalizeLogoPlacement } = await import('./creative-engine');
  assert.deepEqual(normalizeLogoPlacement(undefined), { position: 'top-center', widthRatio: 0.22 });
  assert.deepEqual(normalizeLogoPlacement({ position: 'lado', widthRatio: 0.9 }), { position: 'top-center', widthRatio: 0.3 });
  assert.deepEqual(normalizeLogoPlacement({ position: 'bottom-right', widthRatio: 0.05 }), { position: 'bottom-right', widthRatio: 0.16 });
});

test('placa: escolhe a cor mais escura da marca, senao grafite', async () => {
  const { pickPlateColor } = await import('./logo-composite');
  assert.equal(pickPlateColor(['#FFF3D0', '#FFC400', '#D8291C']), '#D8291C', 'Essenza -> vermelho');
  assert.equal(pickPlateColor(['#FFF3D0', '#FFC400']), '#1F2937', 'so cores claras -> grafite');
  assert.equal(pickPlateColor([null, undefined, 'azul']), '#1F2937', 'lixo -> grafite');
});

test('carimbo da logo: mantem canvas, placa em fundo claro, sem placa em fundo escuro, respeita safe area', async () => {
  const { compositeLogoBuffer } = await import('./logo-composite');
  const spec = getFormatSpec('ig-feed');
  const block = await sharp({ create: { width: 200, height: 100, channels: 4, background: { r: 255, g: 196, b: 0, alpha: 1 } } }).png().toBuffer();
  const logo = await sharp({ create: { width: 400, height: 200, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: block, left: 100, top: 50 }])
    .png().toBuffer();
  const light = await sharp({ create: { width: spec.width, height: spec.height, channels: 3, background: { r: 250, g: 243, b: 208 } } }).png().toBuffer();
  const dark = await sharp({ create: { width: spec.width, height: spec.height, channels: 3, background: { r: 20, g: 30, b: 25 } } }).png().toBuffer();
  const placement = { position: 'top-center' as const, widthRatio: 0.22 };

  const a = await compositeLogoBuffer(light, spec, logo, placement, '#D8291C');
  const ma = await sharp(a.buffer).metadata();
  assert.equal(ma.width, spec.width);
  assert.equal(ma.height, spec.height);
  assert.equal(a.plate, true, 'fundo claro pede placa');
  assert.equal(a.width, Math.round(spec.width * 0.22), 'logo aparada e redimensionada pela largura');

  const b = await compositeLogoBuffer(dark, spec, logo, placement, '#D8291C');
  assert.equal(b.plate, false, 'fundo escuro nao pede placa');

  const story = getFormatSpec('ig-stories');
  const sBase = await sharp({ create: { width: story.width, height: story.height, channels: 3, background: { r: 250, g: 243, b: 208 } } }).png().toBuffer();
  const c = await compositeLogoBuffer(sBase, story, logo, placement, '#D8291C');
  assert.ok(c.y >= Math.round(story.height * 0.14), `logo abaixo da safe area (y=${c.y})`);
});

test('carimbo foge de area ocupada (texto/logo desenhada) e ativa placa', async () => {
  const { compositeLogoBuffer } = await import('./logo-composite');
  const spec = getFormatSpec('ig-feed');
  const block = await sharp({ create: { width: 200, height: 100, channels: 4, background: { r: 255, g: 196, b: 0, alpha: 1 } } }).png().toBuffer();
  const logo = await sharp({ create: { width: 400, height: 200, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: block, left: 100, top: 50 }])
    .png().toBuffer();

  // Topo poluido (listras de alto contraste = "texto"), base calma.
  const stripes = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${spec.width}" height="420">` +
    Array.from({ length: 14 }, (_, i) => `<rect x="0" y="${i * 30}" width="${spec.width}" height="15" fill="${i % 2 ? '#000000' : '#FFFFFF'}"/>`).join('') +
    `</svg>`,
  );
  const busyTop = await sharp({ create: { width: spec.width, height: spec.height, channels: 3, background: { r: 40, g: 60, b: 50 } } })
    .composite([{ input: stripes, left: 0, top: 0 }])
    .png().toBuffer();

  const out = await compositeLogoBuffer(busyTop, spec, logo, { position: 'top-center', widthRatio: 0.22 }, '#D8291C');
  assert.equal(out.relocated, true, 'deve sair do topo poluido');
  // Pode descer dentro da faixa ou trocar de banda — o que importa e nao ficar na area suja.
  assert.ok(out.busy < 0.2, `slot escolhido deve ser mais limpo (busy=${out.busy.toFixed(3)})`);
  assert.ok(out.y > 100 || !out.position.startsWith('top'), `saiu da faixa poluida (y=${out.y}, pos=${out.position})`);
  const meta = await sharp(out.buffer).metadata();
  assert.equal(meta.width, spec.width);
  assert.equal(meta.height, spec.height);

  // Area calma: fica onde foi planejado.
  const calm = await sharp({ create: { width: spec.width, height: spec.height, channels: 3, background: { r: 40, g: 60, b: 50 } } }).png().toBuffer();
  const ok = await compositeLogoBuffer(calm, spec, logo, { position: 'top-center', widthRatio: 0.22 }, '#D8291C');
  assert.equal(ok.relocated, false, 'area calma nao realoca');
  assert.equal(ok.position, 'top-center');
  assert.equal(ok.plate, false, 'fundo escuro e calmo dispensa placa');
});

test('copy obrigatoria e extraida de briefing longo', async () => {
  const { extractMandatoryCopy, mandatoryCopyBlock } = await import('./mandatory-copy');
  const brief = [
    'CRIE A ARTE FINAL COMPLETA. Atue como um time senior de campanha publicitaria.',
    'x'.repeat(2000),
    'TEXTO OBRIGATORIO — escreva exatamente assim:',
    'HEADLINE: "A espera acabou."',
    'TEXTO DE APOIO: "A Essenza abre ainda este mês."',
    'CTA: "Acompanhe. Está chegando."',
    'FORMATO: 1080x1350 px, 4:5.',
  ].join('\n');
  const copy = extractMandatoryCopy(brief);
  assert.equal(copy.headline, 'A espera acabou.');
  assert.equal(copy.support, 'A Essenza abre ainda este mês.');
  assert.equal(copy.cta, 'Acompanhe. Está chegando.');

  const block = mandatoryCopyBlock(brief);
  assert.match(block, /MUST be exactly: A espera acabou\./);
  assert.match(block, /MUST be exactly: Acompanhe\. Está chegando\./);

  // O bloco tem que aparecer no prompt do plano, mesmo com briefing gigante.
  const sys = buildCreativePlanSystemPrompt({ ...baseInput, topic: brief, bakeText: true });
  assert.match(sys, /MANDATORY COPY/);
  assert.match(sys, /A espera acabou\./);
});

test('"Sem CTA" e instrucao de omitir, nao texto', async () => {
  const { extractMandatoryCopy } = await import('./mandatory-copy');
  const c = extractMandatoryCopy('HEADLINE: "Chegou."\nCTA: Sem CTA.');
  assert.equal(c.headline, 'Chegou.');
  assert.equal(c.cta, undefined);
  assert.deepEqual(extractMandatoryCopy('post de pizza sem marcacao nenhuma'), {});
});

test('recomposicao: plano reaproveitado manda refazer o layout, nao cortar', () => {
  const plan: CreativePlan = {
    objective: 'o', audience: 'a', concept: 'c', visualHook: 'v', primarySubject: 's',
    composition: 'comp', palette: 'pal', typographyMood: 'typo', lighting: 'light',
    camera: 'cam', environment: 'env', emotion: 'emo', headline: 'A espera acabou.',
    cta: '', negativeInstructions: 'nada',
  };
  const story = planToImagePrompt(plan, { ...baseInput, format: '9:16', bakeText: true, recomposedFrom: '4:5' });
  assert.match(story, /RECOMPOSE FOR THIS CANVAS/);
  assert.match(story, /1080x1920/);
  assert.match(story, /Do not crop or letterbox/);
  assert.match(story, /A espera acabou\./, 'a copy segue identica');

  // Sem recomposedFrom o bloco nao aparece.
  const feed = planToImagePrompt(plan, { ...baseInput, format: '4:5', bakeText: true });
  assert.doesNotMatch(feed, /RECOMPOSE FOR THIS CANVAS/);
});
