interface BrandContext {
  name: string;
  voiceTone?: string;
  defaultHashtags?: string[];
  products?: string[];
  description?: string;
  phone?: string;
  tonePrompt?: string;
}

export type CaptionMode = 'engajar' | 'vender' | 'educar';

interface GenerateCaptionParams {
  topic: string;
  tone?: 'educativo' | 'inspirador' | 'humor' | 'noticia';
  mode?: CaptionMode;
  platform?: string;
  hashtagsCount?: number;
  language?: string;
  maxLength?: number;
  brandId?: string;
}

interface GenerateCaptionResult {
  caption: string;
  hashtags: string[];
}

interface RefineSlideParams {
  title: string;
  subtitle?: string;
  label?: string;
  instruction: string;
}

interface RefineSlideResult {
  title: string;
  subtitle: string;
  label: string;
}

const TONE_TEMPLATES: Record<string, string> = {
  educativo: '💡 Você sabia?\n\n{content}\n\n💾 Salva esse post para consultar depois!',
  inspirador: '🚀 {content}\n\n✨ O futuro é agora!\n\n📌 Salve e compartilhe!',
  humor: '😂 {content}\n\n🤣 Marca aquele amigo dev!\n\n#humor #tech',
  noticia: '🔥 NOVIDADE!\n\n{content}\n\n📲 Fica ligado para mais updates!',
};

// ── Modo de conteúdo (portado do motor Dispara AI) ──
const MODE_INSTRUCTIONS: Record<CaptionMode, string> = {
  engajar: `OBJETIVO: MAXIMIZAR ENGAJAMENTO (comentários, compartilhamentos, salvamentos)
- Faça perguntas abertas que gerem conversa
- Use storytelling pessoal/relatável
- Gatilhos: curiosidade, identificação, nostalgia, humor
- Técnica "loop aberto": comece com uma promessa e entregue no final
- Peça opinião: "Concorda? Comenta aí"
- Use "Salve esse post" como CTA (aumenta alcance algorítmico)`,

  vender: `OBJETIVO: GERAR CONVERSÕES (pedidos, cliques, vendas, leads)
- Framework PAS (Problema → Agitação → Solução) ou AIDA (Atenção → Interesse → Desejo → Ação)
- Foque em BENEFÍCIOS e desejo, não em características
- Prova social quando fizer sentido (clientes satisfeitos, mais pedido, favorito da casa)
- Urgência real e leve: "só hoje", "enquanto durar", "peça agora"
- CTA claro e específico — se a marca tiver WhatsApp/telefone, use-o no CTA (ex: "Peça pelo WhatsApp: (87) 99999-9999")
- Quebre objeções antes que apareçam`,

  educar: `OBJETIVO: CONSTRUIR AUTORIDADE E CONFIANÇA
- Comece com um dado/fato surpreendente
- Estruture em passos numerados ou lista curta
- Use analogias simples para conceitos complexos
- Dê uma dica prática que o seguidor possa aplicar HOJE
- Posicione a marca como especialista sem arrogância
- CTA: "Salve para consultar depois" ou "Compartilhe com alguém que precisa"`,
};

// ── Regras por plataforma (portado do motor Dispara AI) ──
const PLATFORM_RULES: Record<string, string> = {
  INSTAGRAM: `- MÁXIMO 1800 caracteres (limite é 2200, deixe margem)
- Gancho forte nos primeiros 125 caracteres (é o que aparece antes do "mais")
- Parágrafos curtos (2-3 linhas), máximo 4 parágrafos
- 1-2 emojis por parágrafo, não mais
- CTA curto no final (1 frase)
- Seja CONCISO. Menos é mais. Corte tudo que não agrega valor direto.`,
  FACEBOOK: `- Posts entre 40-80 palavras têm mais engajamento
- Perguntas geram mais comentários
- Tom conversacional e storytelling
- Emojis moderados, 1-2 por parágrafo`,
  LINKEDIN: `- Tom profissional mas humano, nunca corporativo demais
- Comece com afirmação provocativa ou dado surpreendente
- Use quebras de linha e listas para facilitar leitura
- 1300-1600 caracteres é o ideal
- Máximo 1-2 emojis no post inteiro
- CTA: "Concorda? Comente abaixo"`,
  X: `- Direto e provocativo, máximo 280 caracteres
- 1 ideia forte por post
- No máximo 1-2 hashtags`,
};

async function getBrandContext(brandId: string): Promise<BrandContext | null> {
  const { prisma } = await import('../config/database');
  const brand = await prisma.brand.findUnique({ where: { id: brandId } });
  if (!brand) return null;
  return {
    name: brand.name,
    voiceTone: brand.voiceTone || undefined,
    defaultHashtags: brand.defaultHashtags?.length ? brand.defaultHashtags : undefined,
    products: brand.products?.length ? brand.products : undefined,
    description: brand.description || undefined,
    phone: (brand as any).phone || undefined,
    tonePrompt: (brand as any).tonePrompt || undefined,
  };
}

function generateHashtags(topic: string, count: number, brandHashtags?: string[]): string[] {
  const base = brandHashtags?.length ? brandHashtags : ['IA', 'Tech', 'Programacao', 'Dev', 'Tecnologia'];
  const topicWords = topic
    .split(' ')
    .filter((w) => w.length > 3)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());

  return [...base, ...topicWords.slice(0, Math.ceil(count / 2))].slice(0, count);
}

function generateCaptionStatic(params: GenerateCaptionParams, brand?: BrandContext | null): GenerateCaptionResult {
  const { topic, tone = 'educativo', hashtagsCount = 10, maxLength = 2200 } = params;

  const template = TONE_TEMPLATES[tone] || TONE_TEMPLATES.educativo;
  const brandName = brand?.name || 'nossos seguidores';
  const content = `Sobre ${topic}: Conteúdo relevante para ${brandName}. Confira!`;
  let caption = template.replace('{content}', content);

  if (caption.length > maxLength) {
    caption = caption.slice(0, maxLength - 3) + '...';
  }

  const hashtags = generateHashtags(topic, hashtagsCount, brand?.defaultHashtags);

  return { caption, hashtags };
}

async function callGeminiText(apiKey: string, prompt: string): Promise<string> {
  const model = 'gemini-2.0-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.8, maxOutputTokens: 1024 },
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini API error ${response.status}: ${err}`);
  }

  const data = (await response.json()) as any;
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('No text returned from Gemini');
  return text.trim();
}

async function resolveTextProvider(): Promise<{ kind: 'openrouter' | 'google'; key: string; model: string } | null> {
  const { getSetting } = await import('../helpers/getSetting');
  const provider = ((await getSetting('NANO_BANANA_PROVIDER')) || 'google').toLowerCase();
  if (provider === 'openrouter') {
    const key = await getSetting('OPENROUTER_API_KEY');
    if (key) {
      const model = (await getSetting('OPENROUTER_TEXT_MODEL')) || 'google/gemini-2.5-flash';
      return { kind: 'openrouter', key, model };
    }
  }
  const googleKey = await getSetting('NANO_BANANA_API_KEY');
  if (googleKey) return { kind: 'google', key: googleKey, model: 'gemini-2.0-flash' };
  return null;
}

async function callOpenRouterText(apiKey: string, model: string, prompt: string): Promise<string> {
  const { env } = await import('../config/env');
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': env.FRONTEND_URL,
      'X-Title': 'OpenHive',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.8,
      max_tokens: 1024,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenRouter text error ${response.status}: ${err.slice(0, 150)}`);
  }

  const data = (await response.json()) as any;
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('No text returned from OpenRouter');
  return String(text).trim();
}

/**
 * Unified text generation: routes to OpenRouter when NANO_BANANA_PROVIDER=openrouter
 * (single key for text + image), otherwise falls back to native Google Gemini.
 */
async function callText(prompt: string): Promise<string> {
  const provider = await resolveTextProvider();
  if (!provider) throw new Error('No text provider configured');
  if (provider.kind === 'openrouter') {
    return callOpenRouterText(provider.key, provider.model, prompt);
  }
  return callGeminiText(provider.key, prompt);
}

export async function generateCaption(params: GenerateCaptionParams): Promise<GenerateCaptionResult> {
  const textProvider = await resolveTextProvider();

  let brand: BrandContext | null = null;
  if (params.brandId) {
    brand = await getBrandContext(params.brandId);
  }

  if (!textProvider) {
    return generateCaptionStatic(params, brand);
  }

  const { topic, tone = 'educativo', hashtagsCount = 10, mode = 'engajar', platform } = params;

  const platformKey = (platform || 'INSTAGRAM').toUpperCase();
  const platformRules = PLATFORM_RULES[platformKey] || PLATFORM_RULES.INSTAGRAM;
  const modeInstructions = MODE_INSTRUCTIONS[mode] || MODE_INSTRUCTIONS.engajar;

  // Brand context block (shared by both prompts)
  let brandBlock = '';
  if (brand) {
    const parts: string[] = [`Marca: ${brand.name}`];
    if (brand.description) parts.push(`Sobre: ${brand.description}`);
    if (brand.products?.length) parts.push(`Produtos/serviços: ${brand.products.join(', ')}`);
    if (brand.voiceTone) parts.push(`Tom de voz da marca: ${brand.voiceTone}`);
    if (brand.tonePrompt) parts.push(`Instruções de tom da marca: ${brand.tonePrompt}`);
    if (brand.phone) parts.push(`WhatsApp/telefone da marca: ${brand.phone} (use no CTA quando o objetivo for vender/pedir)`);
    brandBlock = `\n## CONTEXTO DA MARCA\n${parts.join('\n')}\n`;
  }

  const prompt = `Você é um copywriter sênior e estrategista de conteúdo digital com 10+ anos de experiência em redes sociais no Brasil. Domina copywriting (PAS, AIDA, storytelling), algoritmos e psicologia de engajamento.

## REGRAS ABSOLUTAS
- Responda SEMPRE em português brasileiro fluente e natural
- NUNCA use clichês como "no mundo digital de hoje" ou "você sabia que"
- Cada frase deve ter um propósito: informar, emocionar, persuadir ou direcionar ação
- Emojis são ferramentas estratégicas, não decoração
- O conteúdo deve soar como uma pessoa real, não uma IA
${brandBlock}
## REGRAS DA PLATAFORMA (${platformKey})
${platformRules}

## MODO DE CONTEÚDO
${modeInstructions}

## BRIEFING
- Tema/assunto: "${topic}"
${!brand ? `- Tom desejado: ${tone}` : ''}
${brand?.defaultHashtags?.length ? `- Hashtags obrigatórias da marca (inclua todas): ${brand.defaultHashtags.join(', ')}` : ''}

Retorne EXATAMENTE neste formato (sem markdown, sem aspas extras):
TITULO: [título impactante, máximo 6 palavras — hook que para o scroll]
SUBTITULO: [subtítulo que complementa, máximo 15 palavras]
LEGENDA: [legenda pronta para colar, seguindo as regras da plataforma e o modo de conteúdo, com gancho, valor e CTA]
HASHTAGS: [${hashtagsCount} hashtags separadas por vírgula, sem #${brand?.defaultHashtags?.length ? ' — inclua TODAS as obrigatórias da marca e complete com relevantes ao tema' : ', mix de alto volume e nicho'}]`;

  try {
    const result = await callText(prompt);

    const titleMatch = result.match(/TITULO:\s*(.+)/i);
    const subtitleMatch = result.match(/SUBTITULO:\s*(.+)/i);
    const captionMatch = result.match(/LEGENDA:\s*([\s\S]+?)(?=HASHTAGS:|$)/i);
    const hashtagsMatch = result.match(/HASHTAGS:\s*(.+)/i);

    const title = titleMatch?.[1]?.trim() || topic;
    const subtitle = subtitleMatch?.[1]?.trim() || '';
    const captionText = captionMatch?.[1]?.trim() || '';
    const rawHashtags = hashtagsMatch?.[1]
      ?.split(',')
      .map((h: string) => h.trim().replace(/^#/, ''))
      .filter(Boolean) || [];

    const brandHashtags = brand?.defaultHashtags || [];
    const mergedHashtags = [...new Set([...brandHashtags, ...rawHashtags])].slice(0, hashtagsCount);
    const hashtags = mergedHashtags.length > 0 ? mergedHashtags : generateHashtags(topic, hashtagsCount, brand?.defaultHashtags);

    const caption = `${title}.\n${subtitle}${captionText ? `\n\n${captionText}` : ''}`;

    return { caption, hashtags };
  } catch (err) {
    console.error('[caption] Gemini failed, falling back to static:', err);
    return generateCaptionStatic(params, brand);
  }
}

interface GenerateImagePromptParams {
  topic: string;
  brandId?: string;
  style?: string;
  aspectRatio?: string;
  usage?: string;
}

interface GenerateImagePromptResult {
  prompt: string;
  negative_prompt: string;
  tips: string;
}

async function getBrandVisualContext(brandId: string): Promise<{ name: string; primaryColor?: string; secondaryColor?: string; description?: string } | null> {
  const { prisma } = await import('../config/database');
  const brand = await prisma.brand.findUnique({ where: { id: brandId } });
  if (!brand) return null;
  return {
    name: brand.name,
    primaryColor: brand.primaryColor || undefined,
    secondaryColor: brand.secondaryColor || undefined,
    description: brand.description || undefined,
  };
}

export async function generateImagePromptForStudio(params: GenerateImagePromptParams): Promise<GenerateImagePromptResult> {
  const textProvider = await resolveTextProvider();

  let brand: { name: string; primaryColor?: string; secondaryColor?: string; description?: string } | null = null;
  if (params.brandId) {
    brand = await getBrandVisualContext(params.brandId);
  }

  const style = params.style || 'fotográfico';
  const ratio = params.aspectRatio || '4:5 (retrato)';
  const usage = params.usage || 'post de Instagram/Facebook';

  let systemContext = '';
  if (brand) {
    systemContext = `
Contexto da marca: "${brand.name}"
${brand.description ? `Descrição: ${brand.description}` : ''}
Cores da marca: primária ${brand.primaryColor || 'N/A'}, secundária ${brand.secondaryColor || 'N/A'}
O prompt deve gerar uma imagem que combine visualmente com a identidade dessa marca.`;
  }

  const prompt = `Você é um especialista em engenharia de prompts para geração de imagens em IA (Google Gemini / Imagen 3).
Gere um prompt otimizado para Google AI Studio (Gemini) que produza uma imagem de alta qualidade.

TEMA: "${params.topic}"
ESTILO VISUAL: ${style}
PROPORÇÃO: ${ratio}
USO: ${usage}
${systemContext}

Retorne EXATAMENTE neste formato (sem markdown, sem aspas extras):

PROMPT: [prompt detalhado em inglês para gerar a imagem no AI Studio — seja específico sobre iluminação, composição, cores, texturas, atmosfera. Mínimo 50 palavras, máximo 150 palavras]
NEGATIVE: [negative prompt — o que evitar na imagem, ex: text, watermarks, blurry, deformed faces]
DICAS: [3 dicas curtas em português sobre como ajustar o prompt se o resultado não ficar bom]

Regras do prompt:
- SEMPRE em inglês (AI Studio gera melhor com prompts em inglês)
- Seja ultra-específico sobre composição, iluminação e atmosfera
- Inclua detalhes de textura e qualidade (ex: "crisp details", "professional photography")
- Se o tema envolver pessoas, especifique "diverse group" ou detalhes de aparência
- Para posts de redes sociais: fundo com espaço negativo para sobrepor texto depois
- NUNCA peça texto/letras na imagem (vamos adicionar via overlay HTML)
- Evite faces muito próximas (AI Studio distorce facilmente)`;

  if (!textProvider) {
    // Fallback: prompt simples sem Gemini
    const fallbackPrompt = `Professional ${style} style image for social media. Topic: ${params.topic}. High quality, vibrant colors, ${ratio} composition with negative space for text overlay. Crisp details, modern aesthetic.`;
    return {
      prompt: fallbackPrompt,
      negative_prompt: 'text, watermark, blurry, deformed faces, low quality, cartoon, illustration (unless specified)',
      tips: '1. Se a imagem tiver texto, adicione "no text, no letters" ao prompt.\n2. Se as cores não combinarem com a marca, ajuste as cores descritas no prompt.\n3. Para mais espaço de texto, adicione "generous negative space, minimal background".',
    };
  }

  try {
    const result = await callText(prompt);

    const promptMatch = result.match(/PROMPT:\s*([\s\S]+?)(?=NEGATIVE:|$)/i);
    const negativeMatch = result.match(/NEGATIVE:\s*([\s\S]+?)(?=DICAS:|$)/i);
    const tipsMatch = result.match(/DICAS:\s*([\s\S]+?)(?=$)/i);

    return {
      prompt: promptMatch?.[1]?.trim() || `Professional ${style} image about ${params.topic}. High quality, vibrant, ${ratio}.`,
      negative_prompt: negativeMatch?.[1]?.trim() || 'text, watermark, blurry, deformed, low quality',
      tips: tipsMatch?.[1]?.trim() || 'Ajuste cores e composição conforme necessário.',
    };
  } catch (err) {
    console.error('[image-prompt] Gemini failed:', err);
    const fallbackPrompt = `Professional ${style} style image for social media. Topic: ${params.topic}. High quality, vibrant colors, ${ratio} composition with negative space for text overlay.`;
    return {
      prompt: fallbackPrompt,
      negative_prompt: 'text, watermark, blurry, deformed faces, low quality',
      tips: 'Gemini indisponível. Ajuste o prompt manualmente no AI Studio.',
    };
  }
}

export async function refineSlide(params: RefineSlideParams): Promise<RefineSlideResult> {
  const textProvider = await resolveTextProvider();

  if (!textProvider) {
    throw new Error('Configure sua chave de IA (OpenRouter ou Google Gemini) em Configurações para usar IA');
  }

  const { title, subtitle, label, instruction } = params;

  const prompt = `Você é um especialista em conteúdo para Instagram.

Conteúdo atual do slide:
${label ? `Label: "${label}"` : ''}
Título: "${title}"
${subtitle ? `Subtítulo: "${subtitle}"` : ''}

Instrução do usuário: "${instruction}"

Refine o conteúdo seguindo a instrução. Retorne EXATAMENTE neste formato (sem markdown):
TITULO: [título refinado, máximo 8 palavras]
SUBTITULO: [subtítulo refinado, máximo 20 palavras]
LABEL: [label refinado ou vazio se não tinha]

Regras:
- Português BR
- Mantenha impactante e conciso
- Siga a instrução do usuário fielmente`;

  const result = await callText(prompt);

  const titleMatch = result.match(/TITULO:\s*(.+)/i);
  const subtitleMatch = result.match(/SUBTITULO:\s*(.+)/i);
  const labelMatch = result.match(/LABEL:\s*(.+)/i);

  return {
    title: titleMatch?.[1]?.trim() || title,
    subtitle: subtitleMatch?.[1]?.trim() || subtitle || '',
    label: labelMatch?.[1]?.trim() || label || '',
  };
}
