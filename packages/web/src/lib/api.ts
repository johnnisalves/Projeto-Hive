const BASE_URL = process.env.NEXT_PUBLIC_API_URL || '';

let token: string | null = null;

export function setToken(t: string | null) {
  token = t;
  if (t) localStorage.setItem('token', t);
  else localStorage.removeItem('token');
}

export function getToken(): string | null {
  if (token) return token;
  if (typeof window !== 'undefined') {
    token = localStorage.getItem('token');
  }
  return token;
}

async function request<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const t = getToken();
  if (t) headers['Authorization'] = `Bearer ${t}`;

  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { ...headers, ...options.headers },
  });

  if (res.status === 401 && t) {
    // Try refresh
    try {
      const refresh = await fetch(`${BASE_URL}/api/auth/refresh`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
      });
      if (refresh.ok) {
        const data = await refresh.json();
        setToken(data.data.token);
        headers['Authorization'] = `Bearer ${data.data.token}`;
        const retry = await fetch(`${BASE_URL}${path}`, { ...options, headers });
        const retryData = await retry.json();
        if (!retry.ok) throw new Error((retryData as any).error || 'Request failed');
        return (retryData as any).data;
      }
    } catch {
      setToken(null);
    }
    throw new Error('Unauthorized');
  }

  let data: any;
  try {
    data = await res.json();
  } catch {
    throw new Error(res.ok ? 'Resposta invalida do servidor' : `Erro ${res.status}: servidor indisponivel`);
  }
  if (!res.ok) throw new Error(data?.error || 'Request failed');
  return data?.data;
}

export const api = {
  login: (email: string, password: string) =>
    request<{ user: any; token: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  register: (email: string, password: string, name?: string) =>
    request<{ user: any; token: string }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, name }),
    }),

  listPosts: (params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return request<{ items: any[]; total: number; page: number; limit: number }>(`/api/posts${qs}`);
  },

  getPost: (id: string) => request<any>(`/api/posts/${id}`),

  createPost: (body: Record<string, unknown>) =>
    request('/api/posts', { method: 'POST', body: JSON.stringify(body) }),

  updatePost: (id: string, body: Record<string, unknown>) =>
    request(`/api/posts/${id}`, { method: 'PUT', body: JSON.stringify(body) }),

  deletePost: (id: string) => request(`/api/posts/${id}`, { method: 'DELETE' }),

  publishPost: (id: string) => request(`/api/posts/${id}/publish`, { method: 'POST' }),

  schedulePost: (id: string, scheduledAt: string) =>
    request(`/api/posts/${id}/schedule`, { method: 'POST', body: JSON.stringify({ scheduledAt }) }),

  setPostApproval: (id: string, approvalState: 'none' | 'pending' | 'approved' | 'rejected') =>
    request(`/api/posts/${id}/approval`, { method: 'PUT', body: JSON.stringify({ approvalState }) }),

  setPostEvergreen: (id: string, isEvergreen: boolean, evergreenIntervalDays?: number) =>
    request(`/api/posts/${id}/evergreen`, { method: 'PUT', body: JSON.stringify({ isEvergreen, evergreenIntervalDays }) }),

  getAnalytics: (period: '7d' | '30d' | '90d' = '30d') =>
    request<any>(`/api/analytics?period=${period}`),

  getInbox: () => request<any>(`/api/inbox`),
  replyToComment: (commentId: string, message: string) =>
    request<any>(`/api/inbox/reply`, { method: 'POST', body: JSON.stringify({ commentId, message }) }),
  getDMs: () => request<any>(`/api/inbox/dms`),
  replyDM: (recipientId: string, message: string) =>
    request<any>(`/api/inbox/dm-reply`, { method: 'POST', body: JSON.stringify({ recipientId, message }) }),

  getBranding: () => request<any>(`/api/branding`),
  setBranding: (body: { appName?: string | null; logoUrl?: string | null; primaryColor?: string | null }) =>
    request<any>(`/api/branding`, { method: 'PUT', body: JSON.stringify(body) }),

  getBillingConfig: () => request<any>(`/api/billing/config`),
  setBillingConfig: (body: { apiKey?: string | null; env?: 'sandbox' | 'production' }) =>
    request<any>(`/api/billing/config`, { method: 'PUT', body: JSON.stringify(body) }),
  testBilling: () => request<any>(`/api/billing/test`, { method: 'POST' }),
  createCharge: (body: { customerName: string; cpfCnpj: string; value: number; billingType: string; dueDate: string; description?: string }) =>
    request<any>(`/api/billing/charges`, { method: 'POST', body: JSON.stringify(body) }),
  listCharges: () => request<any>(`/api/billing/charges`),
  getPlans: () => request<any>(`/api/billing/plans`),
  setPlans: (plans: Array<{ id?: string; name: string; price: number; description?: string }>) =>
    request<any>(`/api/billing/plans`, { method: 'PUT', body: JSON.stringify({ plans }) }),
  createSubscription: (body: { customerName: string; cpfCnpj: string; value: number; billingType: string; nextDueDate: string; description?: string }) =>
    request<any>(`/api/billing/subscriptions`, { method: 'POST', body: JSON.stringify(body) }),
  listSubscriptions: () => request<any>(`/api/billing/subscriptions`),
  cancelSubscription: (id: string) => request<any>(`/api/billing/subscriptions/${id}`, { method: 'DELETE' }),

  generateImage: (prompt: string, aspectRatio?: string) =>
    request<{ imageUrl: string }>('/api/generate/image', {
      method: 'POST',
      body: JSON.stringify({ prompt, aspectRatio }),
    }),

  generateCaption: (topic: string, tone?: string, brandId?: string, mode?: string, platform?: string, imageUrl?: string) =>
    request<{ caption: string; hashtags: string[] }>('/api/generate/caption', {
      method: 'POST',
      body: JSON.stringify({ topic, tone, brandId, mode, platform, imageUrl }),
    }),

  refineSlide: (body: { title: string; subtitle?: string; label?: string; instruction: string }) =>
    request<{ title: string; subtitle: string; label: string }>('/api/generate/refine', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  generateContentPlan: (body: { brandId?: string; month?: string; postsCount?: number; platforms?: string[]; goals?: string }) =>
    request<{ month: string; brandName?: string; items: Array<{ day: number; weekday?: string; theme: string; format: string; hook: string; captionIdea: string; hashtags: string[]; objective?: string }> }>('/api/generate/content-plan', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  repurposeContent: (body: { caption: string; platforms: string[]; brandId?: string }) =>
    request<{ results: Record<string, string> }>('/api/generate/repurpose', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  captionVariations: (body: { topic: string; count?: number; platform?: string; brandId?: string }) =>
    request<{ variations: string[] }>('/api/generate/caption-variations', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  instagramStatus: () => request<{ connected: boolean }>('/api/instagram/status'),

  // Tasks
  listTasks: (params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return request<{ items: any[]; total: number; page: number; limit: number }>(`/api/tasks${qs}`);
  },
  getTask: (id: string) => request<any>(`/api/tasks/${id}`),
  createTask: (body: Record<string, unknown>) =>
    request('/api/tasks', { method: 'POST', body: JSON.stringify(body) }),
  updateTask: (id: string, body: Record<string, unknown>) =>
    request(`/api/tasks/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteTask: (id: string) => request(`/api/tasks/${id}`, { method: 'DELETE' }),

  // Projects
  listProjects: (params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return request<{ items: any[]; total: number; page: number; limit: number }>(`/api/projects${qs}`);
  },
  getProject: (id: string) => request<any>(`/api/projects/${id}`),
  createProject: (body: Record<string, unknown>) =>
    request('/api/projects', { method: 'POST', body: JSON.stringify(body) }),
  updateProject: (id: string, body: Record<string, unknown>) =>
    request(`/api/projects/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteProject: (id: string) => request(`/api/projects/${id}`, { method: 'DELETE' }),
  addModule: (projectId: string, body: Record<string, unknown>) =>
    request(`/api/projects/${projectId}/modules`, { method: 'POST', body: JSON.stringify(body) }),
  updateModule: (projectId: string, moduleId: string, body: Record<string, unknown>) =>
    request(`/api/projects/${projectId}/modules/${moduleId}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteModule: (projectId: string, moduleId: string) =>
    request(`/api/projects/${projectId}/modules/${moduleId}`, { method: 'DELETE' }),

  uploadFile: async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    const t = getToken();
    const res = await fetch(`${BASE_URL}/api/upload/file`, {
      method: 'POST',
      headers: t ? { Authorization: `Bearer ${t}` } : {},
      body: formData,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || 'Upload failed');
    return data.data as { fileUrl: string; fileName: string; mimeType: string };
  },

  // Quanto ainda cabe publicar nas proximas 24h (o Instagram corta em 50).
  getPublishingLimit: () =>
    request<{ usados: number; total: number; restantes: number; disponivel: boolean; motivo?: string }>(
      '/api/posts/publishing-limit',
    ),

  // Horarios em que os seguidores estao online (do maior para o menor).
  getBestHours: () =>
    request<{ horas: number[]; disponivel: boolean; motivo?: string }>('/api/posts/best-hours'),

  // Rascunho de resposta para um comentario, no tom da marca.
  suggestReply: (body: { comentario: string; autor?: string; brandId?: string }) =>
    request<{ texto: string; intencao: string; fallback: boolean }>('/api/inbox/suggest-reply', {
      method: 'POST', body: JSON.stringify(body),
    }),

  hideComment: (commentId: string, hide: boolean) =>
    request<{ hidden: boolean }>('/api/inbox/hide', { method: 'POST', body: JSON.stringify({ commentId, hide }) }),

  deleteComment: (commentId: string) =>
    request<{ deleted: boolean }>(`/api/inbox/comment/${encodeURIComponent(commentId)}`, { method: 'DELETE' }),

  // Descricao da imagem para leitor de tela, feita pela IA que ja a enxerga.
  generateAltText: (imageUrl: string) =>
    request<{ altText: string }>('/api/generate/alt-text', {
      method: 'POST', body: JSON.stringify({ imageUrl }),
    }),

  // Reciclagem: melhores posts e criacao do rascunho com legenda nova.
  // `criterio: 'receita'` muda a pergunta de "o que a audiencia curtiu?"
  // para "o que encheu o caixa?". `temReceita` false = ainda nao ha venda
  // atribuida, e a tela nao deve oferecer o filtro.
  recycleSuggestions: (brandId?: string, criterio?: 'engajamento' | 'receita') => {
    const q = new URLSearchParams();
    if (brandId) q.set('brandId', brandId);
    if (criterio) q.set('criterio', criterio);
    const s = q.toString();
    return request<{ items: any[]; totalPublicados: number; criterio: string; temReceita: boolean }>(
      `/api/posts/recycle/suggestions${s ? `?${s}` : ''}`,
    );
  },

  recyclePost: (id: string, scheduledAt?: string) =>
    request<{ id: string; caption?: string }>(`/api/posts/recycle/${id}`, {
      method: 'POST',
      body: JSON.stringify(scheduledAt ? { scheduledAt } : {}),
    }),

  // Radar de concorrentes.
  listCompetitors: () =>
    request<{ items: any[]; max: number }>('/api/competitors'),

  addCompetitor: (username: string) =>
    request<any>('/api/competitors', { method: 'POST', body: JSON.stringify({ username }) }),

  refreshCompetitor: (id: string) =>
    request<any>(`/api/competitors/${id}/refresh`, { method: 'POST' }),

  removeCompetitor: (id: string) =>
    request<{ deleted: boolean }>(`/api/competitors/${id}`, { method: 'DELETE' }),

  // Relatorio mensal em PDF. Devolve Blob, nao JSON — por isso nao usa
  // o request() comum, que faz res.json() e engasgaria no binario.
  downloadReport: async (brandId: string, ano: number, mes: number) => {
    const t = getToken();
    const res = await fetch(`${BASE_URL}/api/posts/report/${brandId}?ano=${ano}&mes=${mes}`, {
      headers: t ? { Authorization: `Bearer ${t}` } : {},
    });
    if (!res.ok) {
      const erro = await res.json().catch(() => ({}));
      throw new Error(erro?.error || 'Falha ao gerar o relatório');
    }
    return res.blob();
  },

  // Portal de aprovacao: gerar e revogar o link publico da marca.
  createApprovalLink: (brandId: string) =>
    request<{ token: string }>(`/api/approval-links/${brandId}`, { method: 'POST' }),

  revokeApprovalLink: (brandId: string) =>
    request<{ revoked: boolean }>(`/api/approval-links/${brandId}`, { method: 'DELETE' }),

  // Piloto automatico: planeja o mes e depois cria os rascunhos.
  autopilotPlan: (body: { ano: number; mes: number; postsPorSemana: number; brandId?: string }) =>
    request<{
      pautas: Array<{ data: string; tema: string; pilar: 'vender' | 'educar' | 'engajar'; dataComemorativa?: string; prioridade: number }>;
      resumo: { total: number; comemorativas: number; porPilar: Record<'vender' | 'educar' | 'engajar', number> };
    }>('/api/posts/autopilot/plan', { method: 'POST', body: JSON.stringify(body) }),

  autopilotCreate: (body: {
    pautas: Array<{ data: string; tema: string; pilar: string; dataComemorativa?: string }>;
    brandId?: string;
    platforms?: string[];
  }) =>
    request<{ criados: number; falhas: number; ids: string[] }>(
      '/api/posts/autopilot/create',
      { method: 'POST', body: JSON.stringify(body) },
    ),

  // Plano de divulgacao: N imagens viram N posts agendados de uma vez.
  createCampaign: (body: {
    items: Array<{ imageUrl: string; caption?: string; hashtags?: string[]; scheduledAt: string }>;
    brandId?: string;
    platforms?: string[];
    aspectRatio?: string;
  }) =>
    request<{ created: number; failed: number; posts: Array<{ id: string; scheduledAt: string }>; errors: Array<{ imageUrl: string; error: string }> }>(
      '/api/posts/campaign',
      { method: 'POST', body: JSON.stringify(body) },
    ),

  // Agenda de @ do Instagram. O autocomplete vem daqui, nao do Meta: a API
  // do Instagram nao tem busca de usuario por prefixo.
  searchIgContacts: (q: string) =>
    request<{ items: Array<{ username: string; displayName?: string | null; followers?: number | null; verifiedAt?: string | null }>; warning?: string; reason?: string }>(
      `/api/ig-contacts?q=${encodeURIComponent(q)}`,
    ),

  // Reimporta contatos das legendas e comentarios dos posts do Instagram.
  syncIgContacts: () =>
    request<{ total: number; fromHistory: number; fromInstagram: number; sources: string[]; reason?: string }>(
      '/api/ig-contacts/sync',
      { method: 'POST' },
    ),

  // Cola uma lista de @ de uma vez (virgula, espaco ou quebra de linha).
  addIgContactsBulk: (text: string) =>
    request<{ added: number; usernames: string[]; total: number }>('/api/ig-contacts/bulk', {
      method: 'POST',
      body: JSON.stringify({ text }),
    }),

  // Busca local pelo nome e devolve os IDs que o Instagram aceita.
  searchPlaces: (q: string) =>
    request<{ items: Array<{ id: string; name: string; where: string }>; reason?: string }>(
      `/api/ig-contacts/places?q=${encodeURIComponent(q)}`,
    ),

  // --- Vendas e atribuicao: ligar post a dinheiro no caixa ---

  // O numero que responde "isso me da cliente?".
  resumoVendas: (dias = 30, brandId?: string) =>
    request<{
      dias: number;
      totalCentavos: number; cupomCentavos: number; balcaoCentavos: number;
      vendasBalcao: number; cliques: number;
      topLinks: Array<{ code: string; clicks: number; postId: string | null }>;
      roi: number | null; feeCentavos: number | null;
    }>(`/api/vendas/resumo?dias=${dias}${brandId ? `&brandId=${brandId}` : ''}`),

  listarCupons: () =>
    request<Array<{
      id: string; code: string; descricao: string | null; usos: number; maxUsos: number | null;
      ativo: boolean; expiresAt: string | null; postId: string | null; receitaCentavos: number;
    }>>('/api/vendas/cupons'),

  criarCupom: (body: { descricao?: string; postId?: string; brandId?: string; maxUsos?: number; diasValidade?: number }) =>
    request<{ id: string; code: string }>('/api/vendas/cupons', { method: 'POST', body: JSON.stringify(body) }),

  alternarCupom: (id: string, ativo: boolean) =>
    request<{ ativo: boolean }>(`/api/vendas/cupons/${id}`, { method: 'PATCH', body: JSON.stringify({ ativo }) }),

  // Modo balcao: origem da venda em dois toques.
  registrarVenda: (origem: string, valorCentavos?: number, brandId?: string) =>
    request<{ id: string }>('/api/vendas/balcao', {
      method: 'POST',
      body: JSON.stringify({ origem, valorCentavos, brandId }),
    }),

  origensDeVenda: () =>
    request<{ opcoes: string[]; contamNoRoi: string[] }>('/api/vendas/origens'),

  // Botao "Pedir no Zap" rastreavel para um post.
  linkDoPost: (postId: string, mensagem?: string) =>
    request<{ code: string; url: string; destino: string }>('/api/vendas/link-do-post', {
      method: 'POST',
      body: JSON.stringify({ postId, mensagem }),
    }),

  // PIX copia e cola, gerado no proprio servidor pela spec EMV.
  gerarPix: (brandId: string, valor?: number, txid?: string) =>
    request<{ payload: string }>('/api/vendas/pix', {
      method: 'POST',
      body: JSON.stringify({ brandId, valor, txid }),
    }),

  // Importacao de planilha. Conferir e importar sao chamadas separadas: o
  // usuario ve todos os erros antes de qualquer coisa ser gravada.
  conferirPlanilha: (texto: string) =>
    request<{
      linhas: Array<{ linha: number; data: string | null; legenda: string; imagem: string | null; hashtags: string[]; erro?: string }>;
      validas: number; invalidas: number; erroGeral?: string;
    }>('/api/posts/importar/conferir', { method: 'POST', body: JSON.stringify({ texto }) }),

  importarPlanilha: (texto: string, brandId?: string, platforms?: string[]) =>
    request<{ criados: number; falhas: Array<{ linha: number; erro: string }> }>('/api/posts/importar', {
      method: 'POST',
      body: JSON.stringify({ texto, brandId, platforms }),
    }),

  // Preview do feed: publicados + agendados na ordem em que vao aparecer.
  gridDoFeed: (brandId?: string) =>
    request<{
      agendados: Array<{ id: string; imageUrl: string | null; caption: string; scheduledAt: string; publishMode: string; publicado: false }>;
      publicados: Array<{ id: string; imageUrl: string | null; caption: string; permalink?: string; timestamp: string; publicado: true }>;
      aviso?: string;
    }>(`/api/feed/grid${brandId ? `?brandId=${brandId}` : ''}`),

  // Micro-CRM do inbox: a DM com intencao de compra vira lead com valor.
  // `taxaConversao` vem null quando nada foi decidido ainda — zero seria
  // lido como "nunca fecho venda".
  funil: (brandId?: string) =>
    request<{
      items: Array<{
        id: string; etapa: string; contato: string | null; origem: string;
        mensagem: string | null; valorCentavos: number | null; observacao: string | null;
        postId: string | null; atualizadoEm: string;
      }>;
      resumo: {
        porEtapa: Record<string, { leads: number; valorCentavos: number }>;
        abertos: number; fechados: number; perdidos: number;
        receitaCentavos: number; taxaConversao: number | null; ticketMedioCentavos: number | null;
      };
      porPost: Array<{ postId: string; leads: number; receitaCentavos: number }>;
      esquecidos: number;
      etapas: Array<{ chave: string; rotulo: string }>;
    }>(`/api/crm${brandId ? `?brandId=${brandId}` : ''}`),

  criarLead: (body: { contato?: string; mensagem?: string; origem?: string; postId?: string; brandId?: string }) =>
    request<{ id: string }>('/api/crm', { method: 'POST', body: JSON.stringify(body) }),

  moverLead: (id: string, etapa: string, valorCentavos?: number, observacao?: string) =>
    request<{ id: string; etapa: string }>(`/api/crm/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ etapa, valorCentavos, observacao }),
    }),

  removerLead: (id: string) =>
    request<{ deleted: boolean }>(`/api/crm/${id}`, { method: 'DELETE' }),

  // Cockpit: a carteira inteira numa tela, pior primeiro.
  cockpit: () =>
    request<{
      linhas: Array<{
        id: string; nome: string; nota: number; gravidade: 'critico' | 'atencao' | 'ok';
        agendados7d: number; falhas24h: number; aprovacoesParadas: number;
        diasAteTokenVencer: number | null; ultimaPublicacao: string | null;
        sinais: Array<{ tipo: string; gravidade: 'critico' | 'atencao' | 'ok'; texto: string }>;
      }>;
      resumo: { total: number; criticas: number; atencao: number; ok: number };
    }>('/api/cockpit'),

  // Playbooks de nicho. Nunca carregam chave PIX, WhatsApp, fee nem token
  // de aprovacao — so estilo e configuracao (ver playbook.service.ts).
  listarPlaybooks: () =>
    request<{ items: Array<{ chave: string; nome: string; nicho?: string; aplica: string[]; temVisual: boolean }> }>(
      '/api/cockpit/playbooks',
    ),

  salvarPlaybook: (body: { brandId: string; nome: string; nicho?: string; incluirVisual?: boolean }) =>
    request<{ chave: string; aplica: string[] }>('/api/cockpit/playbooks', { method: 'POST', body: JSON.stringify(body) }),

  aplicarPlaybook: (body: { brandId: string; chave: string; aplicarVisual?: boolean }) =>
    request<{ aplicado: string[] }>('/api/cockpit/playbooks/aplicar', { method: 'POST', body: JSON.stringify(body) }),

  removerPlaybook: (chave: string) =>
    request<{ deleted: boolean }>(`/api/cockpit/playbooks/${chave}`, { method: 'DELETE' }),

  // Publicacao em massa: uma arte-mae vira N posts personalizados.
  // `pendencias` sao as marcas que ficariam com "{{nome}}" a mostra no
  // post — conferir antes de publicar e obrigatorio.
  conferirMultimarca: (template: string, brandIds?: string[]) =>
    request<{
      prontas: Array<{ id: string; name: string }>;
      pendencias: Array<{ marcaId: string; marcaNome: string; faltando: string[] }>;
      invalidas: string[];
      disponiveis: string[];
    }>('/api/cockpit/multimarca/conferir', { method: 'POST', body: JSON.stringify({ template, brandIds }) }),

  publicarMultimarca: (body: { template: string; brandIds?: string[]; imageUrl?: string; hashtags?: string[]; scheduledAt?: string }) =>
    request<{
      criados: Array<{ brandId: string; nome: string; postId: string }>;
      falhas: Array<{ nome: string; erro: string }>;
      pendencias: Array<{ marcaNome: string; faltando: string[] }>;
    }>('/api/cockpit/multimarca', { method: 'POST', body: JSON.stringify(body) }),

  // Rentabilidade: qual cliente da lucro e qual da prejuizo.
  // `temConta` false = falta fee ou custo/hora; a linha nao tem margem
  // calculavel e a tela precisa dizer isso em vez de mostrar 0%.
  rentabilidade: (dias = 30) =>
    request<{
      dias: number;
      custoHoraCentavos: number | null;
      precisaConfigurar: boolean;
      linhas: Array<{
        id: string; nome: string; temConta: boolean;
        esforco: { posts: number; artes: number; respostas: number; tarefas: number };
        minutos?: number; custoCentavos?: number; feeCentavos?: number;
        margemCentavos?: number; margemPct?: number;
        situacao?: 'saudavel' | 'apertado' | 'prejuizo';
        feeSugeridoCentavos?: number;
      }>;
    }>(`/api/cockpit/rentabilidade?dias=${dias}`),

  salvarCustoHora: (custoHoraCentavos: number) =>
    request<{ custoHoraCentavos: number }>('/api/cockpit/custo-hora', {
      method: 'PUT',
      body: JSON.stringify({ custoHoraCentavos }),
    }),

  // Nota prevista, comparada com o historico da PROPRIA conta.
  // `nota` vem null quando ainda nao ha historico suficiente — melhor dizer
  // que nao da do que inventar um numero em cima de ruido.
  notaDoPost: (body: { caption: string; hashtags?: string[]; publishMode?: string; mediaType?: string; scheduledAt?: string }) =>
    request<{ nota: number | null; motivos: Array<{ texto: string; impacto: number }>; base: string }>(
      '/api/feed/nota',
      { method: 'POST', body: JSON.stringify(body) },
    ),

  // Retrospectiva mensal. `pode` false quando o mes foi fraco demais para
  // virar peca — publicar "3 posts no mes" seria autossabotagem.
  retrospectiva: (brandId: string, mes?: number, ano?: number) =>
    request<{
      pode: boolean; motivo?: string;
      titulo?: string; subtitulo?: string; legendaSugerida?: string;
      cartoes?: Array<{ numero: string; rotulo: string; destaque?: boolean }>;
    }>(`/api/feed/retrospectiva?brandId=${brandId}${mes ? `&mes=${mes}` : ''}${ano ? `&ano=${ano}` : ''}`),

  arteDaRetrospectiva: (brandId: string, retrospectiva: unknown) =>
    request<{ image: string }>('/api/feed/retrospectiva/arte', {
      method: 'POST',
      body: JSON.stringify({ brandId, retrospectiva }),
    }),

  // Elogios que merecem virar arte de depoimento.
  depoimentos: () =>
    request<{ items: Array<{ id: string; texto: string; original: string }>; analisados: number }>(
      '/api/feed/depoimentos',
    ),

  // Gatilho de clima: a previsao da noite recomenda algum post hoje?
  climaDeHoje: (brandId: string) =>
    request<{
      cidade?: string; condicao: 'chuva' | 'frio' | 'calor' | null;
      detalhe?: string; liberado?: boolean; pauta?: string | null; motivo?: string;
    }>(`/api/feed/clima?brandId=${brandId}`),

  climaUsado: (brandId: string, condicao: string) =>
    request<{ ok: boolean }>('/api/feed/clima/usado', { method: 'POST', body: JSON.stringify({ brandId, condicao }) }),

  // --- Gatilhos de comentario, cerebro da marca e diario de bordo ---

  listarGatilhos: () =>
    request<{ items: Array<{ id: string; palavra: string; resposta: string; ativo: boolean; disparos: number; postId: string | null }> }>(
      '/api/gatilhos',
    ),

  criarGatilho: (body: { palavra: string; resposta: string; postId?: string; brandId?: string }) =>
    request<{ id: string }>('/api/gatilhos', { method: 'POST', body: JSON.stringify(body) }),

  alternarGatilho: (id: string, ativo: boolean) =>
    request<{ ativo: boolean }>(`/api/gatilhos/${id}`, { method: 'PATCH', body: JSON.stringify({ ativo }) }),

  removerGatilho: (id: string) =>
    request<{ deleted: boolean }>(`/api/gatilhos/${id}`, { method: 'DELETE' }),

  regrasDaMarca: (brandId: string) =>
    request<{ items: Array<{ id: string; regra: string; peso: number; ativa: boolean; origem: string }>; prompt: string }>(
      `/api/gatilhos/regras/${brandId}`,
    ),

  alternarRegra: (id: string, ativa: boolean) =>
    request<{ ativa: boolean }>(`/api/gatilhos/regras/item/${id}`, { method: 'PATCH', body: JSON.stringify({ ativa }) }),

  ensinarRegra: (brandId: string, regra: string) =>
    request<{ id: string }>(`/api/gatilhos/regras/${brandId}`, { method: 'POST', body: JSON.stringify({ regra }) }),

  diarioDeBordo: (brandId?: string) =>
    request<{ items: Array<{ id: string; ator: string; acao: string; justificativa: string | null; createdAt: string }> }>(
      `/api/gatilhos/diario/log${brandId ? `?brandId=${brandId}` : ''}`,
    ),

  // Radar de tendencias. O Meta so deixa consultar 30 hashtags DISTINTAS a
  // cada 7 dias por conta — por isso a resposta traz a cota junto, e as
  // tags que ficaram de fora vem em `bloqueadas` em vez de sumirem.
  searchTrends: (tags: string[]) =>
    request<{
      resultados: Array<{
        tag: string;
        posts: number;
        mediaCurtidas: number;
        topPost?: { permalink?: string; caption?: string; likes?: number };
        erro?: string;
      }>;
      bloqueadas: string[];
      cota: { usadas: number; restantes: number; jaConsultadas: string[] };
    }>('/api/ig-contacts/trends', { method: 'POST', body: JSON.stringify({ tags }) }),

  verifyIgContact: (username: string) =>
    request<{ status: 'verified' | 'not_found' | 'unavailable'; username: string; displayName?: string; followers?: number; reason?: string }>(
      `/api/ig-contacts/verify?username=${encodeURIComponent(username)}`,
    ),

  // Trilha sonora do post: o audio e mixado no video no servidor antes de publicar.
  uploadAudio: async (file: File) => {
    const formData = new FormData();
    formData.append('audio', file);
    const t = getToken();
    const res = await fetch(`${BASE_URL}/api/upload/audio`, {
      method: 'POST',
      headers: t ? { Authorization: `Bearer ${t}` } : {},
      body: formData,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || 'Falha ao enviar o audio');
    return data.data as { audioUrl: string; audioMinioKey: string; fileName: string; sizeBytes: number };
  },

  uploadVideo: async (file: File, onProgress?: (pct: number) => void) => {
    const formData = new FormData();
    formData.append('video', file);
    const t = getToken();

    // Use XMLHttpRequest to support upload progress
    return new Promise<{ videoUrl: string; videoMinioKey: string; sizeBytes: number; mimeType: string; fileName: string }>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable && onProgress) {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      });
      xhr.addEventListener('load', () => {
        try {
          const data = JSON.parse(xhr.responseText);
          if (xhr.status >= 200 && xhr.status < 300) resolve(data.data);
          else reject(new Error(data?.error || `Upload failed: ${xhr.status}`));
        } catch {
          reject(new Error('Resposta invalida do servidor'));
        }
      });
      xhr.addEventListener('error', () => reject(new Error('Erro de rede ao enviar video')));
      xhr.addEventListener('abort', () => reject(new Error('Upload cancelado')));
      xhr.open('POST', `${BASE_URL}/api/upload/video`);
      if (t) xhr.setRequestHeader('Authorization', `Bearer ${t}`);
      xhr.send(formData);
    });
  },

  instagramProfile: (accountId?: string) =>
    request<{
      profile: {
        id: string;
        username: string;
        name: string;
        biography: string;
        profile_picture_url: string;
        followers_count: number;
        follows_count: number;
        media_count: number;
        website: string;
      };
      recentMedia: Array<{
        id: string;
        caption: string;
        media_type: string;
        media_url: string;
        permalink: string;
        timestamp: string;
        like_count: number;
        comments_count: number;
      }>;
    }>(`/api/instagram/profile${accountId ? `?accountId=${accountId}` : ''}`),

  // Team
  listMembers: () => request<any[]>('/api/team/members'),
  listInvitations: () => request<any[]>('/api/team/invitations'),
  createInvitation: (email: string, role?: string, allowedPages?: string[]) =>
    request('/api/team/invite', { method: 'POST', body: JSON.stringify({ email, role, allowedPages }) }),
  deleteInvitation: (id: string) => request(`/api/team/invitations/${id}`, { method: 'DELETE' }),
  updateMemberRole: (id: string, role: string) =>
    request(`/api/team/members/${id}/role`, { method: 'PUT', body: JSON.stringify({ role }) }),
  updateMemberPages: (id: string, allowedPages: string[]) =>
    request(`/api/team/members/${id}/pages`, { method: 'PUT', body: JSON.stringify({ allowedPages }) }),
  removeMember: (id: string) => request(`/api/team/members/${id}`, { method: 'DELETE' }),
  getInvitationByToken: (token: string) => request<any>(`/api/team/invite/${token}`),
  acceptInvitation: (token: string, name: string, password: string) =>
    request<{ user: any; token: string }>('/api/team/accept', {
      method: 'POST',
      body: JSON.stringify({ token, name, password }),
    }),

  // Funnels
  listFunnels: () => request<any[]>('/api/funnels'),
  getFunnel: (id: string) => request<any>(`/api/funnels/${id}`),
  createFunnel: (body: Record<string, unknown>) =>
    request('/api/funnels', { method: 'POST', body: JSON.stringify(body) }),
  updateFunnel: (id: string, body: Record<string, unknown>) =>
    request(`/api/funnels/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteFunnel: (id: string) => request(`/api/funnels/${id}`, { method: 'DELETE' }),
  addStage: (funnelId: string, body: Record<string, unknown>) =>
    request(`/api/funnels/${funnelId}/stages`, { method: 'POST', body: JSON.stringify(body) }),
  updateStage: (funnelId: string, stageId: string, body: Record<string, unknown>) =>
    request(`/api/funnels/${funnelId}/stages/${stageId}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteStage: (funnelId: string, stageId: string) =>
    request(`/api/funnels/${funnelId}/stages/${stageId}`, { method: 'DELETE' }),
  addStep: (funnelId: string, stageId: string, body: Record<string, unknown>) =>
    request(`/api/funnels/${funnelId}/stages/${stageId}/steps`, { method: 'POST', body: JSON.stringify(body) }),
  updateStep: (funnelId: string, stageId: string, stepId: string, body: Record<string, unknown>) =>
    request(`/api/funnels/${funnelId}/stages/${stageId}/steps/${stepId}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteStep: (funnelId: string, stageId: string, stepId: string) =>
    request(`/api/funnels/${funnelId}/stages/${stageId}/steps/${stepId}`, { method: 'DELETE' }),
  reorderStages: (funnelId: string, stageIds: string[]) =>
    request(`/api/funnels/${funnelId}/stages/reorder`, { method: 'PUT', body: JSON.stringify({ stageIds }) }),
  moveStep: (funnelId: string, stepId: string, body: { targetStageId: string; order: number }) =>
    request(`/api/funnels/${funnelId}/steps/${stepId}/move`, { method: 'PUT', body: JSON.stringify(body) }),

  // Video Clips
  analyzeVideo: (body: Record<string, unknown>) =>
    request('/api/videos', { method: 'POST', body: JSON.stringify(body) }),
  getVideoClip: (id: string) =>
    request<any>(`/api/videos/${id}`),
  listVideoClips: (params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return request<{ data: { items: any[]; total: number; page: number; limit: number } }>(`/api/videos${qs}`);
  },
  cutVideoClips: (id: string, body: Record<string, unknown>) =>
    request(`/api/videos/${id}/cut`, { method: 'POST', body: JSON.stringify(body) }),
  deleteVideoClip: (id: string) =>
    request(`/api/videos/${id}`, { method: 'DELETE' }),
  uploadVideoFile: async (file: File, title?: string) => {
    const formData = new FormData();
    formData.append('video', file);
    if (title) formData.append('title', title);
    const headers: Record<string, string> = {};
    const t = getToken();
    if (t) headers['Authorization'] = `Bearer ${t}`;
    const res = await fetch(`${BASE_URL}/api/videos/upload`, { method: 'POST', headers, body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || 'Upload failed');
    return data?.data;
  },

  // Settings
  getSettings: () => request<any>('/api/settings'),
  updateSetting: (key: string, value: string) =>
    request('/api/settings', { method: 'PUT', body: JSON.stringify({ key, value }) }),
  deleteSetting: (key: string) => request(`/api/settings/${key}`, { method: 'DELETE' }),

  // Template image generation
  listTemplates: () => request<any[]>('/api/generate/templates'),
  generateTemplate: (body: { title: string; subtitle?: string; body?: string; accent?: string; template?: string; aspectRatio?: string; brandId?: string; applyBrand?: boolean }) =>
    request<{ imageUrl: string }>('/api/generate/template', { method: 'POST', body: JSON.stringify(body) }),

  // Composed image: AI background + HTML overlay
  generateComposed: (body: {
    html: string;
    backgroundPrompt?: string;
    backgroundUrl?: string;
    aspectRatio?: string;
    overlayOpacity?: number;
    brandId?: string;
    applyBrand?: boolean;
  }) =>
    request<{ imageUrl: string; backgroundUrl?: string }>('/api/generate/composed', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  // Brands
  listBrands: () => request<{ items: any[]; total: number }>('/api/brands'),
  getBrand: (id: string) => request<any>(`/api/brands/${id}`),
  getDefaultBrand: () => request<any>('/api/brands/default'),
  createBrand: (body: Record<string, unknown>) =>
    request('/api/brands', { method: 'POST', body: JSON.stringify(body) }),
  updateBrand: (id: string, body: Record<string, unknown>) =>
    request(`/api/brands/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  setDefaultBrand: (id: string) =>
    request(`/api/brands/${id}/default`, { method: 'PUT' }),
  deleteBrand: (id: string) => request(`/api/brands/${id}`, { method: 'DELETE' }),

  // WhatsApp (Status via UAZ)
  listWhatsappConnections: () => request<any[]>('/api/whatsapp/connections'),
  addWhatsappConnection: (body: { name: string; host: string; token: string; phone?: string }) =>
    request('/api/whatsapp/connections', { method: 'POST', body: JSON.stringify(body) }),
  setDefaultWhatsappConnection: (id: string) =>
    request(`/api/whatsapp/connections/${id}/default`, { method: 'PUT' }),
  deleteWhatsappConnection: (id: string) =>
    request(`/api/whatsapp/connections/${id}`, { method: 'DELETE' }),
  testWhatsappConnection: (body: { host: string; token: string }) =>
    request<{ ok: boolean; detail?: string }>('/api/whatsapp/test', { method: 'POST', body: JSON.stringify(body) }),
  publishWhatsappStatus: (postId: string, connectionId?: string) =>
    request<{ id: string }>(`/api/whatsapp/status/${postId}`, { method: 'POST', body: JSON.stringify({ connectionId }) }),
  connectWhatsapp: (id: string) =>
    request<{ loggedIn: boolean; connected: boolean }>(`/api/whatsapp/connections/${id}/connect`, { method: 'POST' }),
  getWhatsappQr: (id: string) =>
    request<{ qr: string | null; loggedIn: boolean }>(`/api/whatsapp/connections/${id}/qr`),
  getWhatsappStatus: (id: string) =>
    request<{ loggedIn: boolean; connected: boolean; jid?: string | null }>(`/api/whatsapp/connections/${id}/status`),
  logoutWhatsapp: (id: string) =>
    request(`/api/whatsapp/connections/${id}/logout`, { method: 'POST' }),
  provisionWhatsapp: (body: { name: string; phone?: string }) =>
    request<{ id: string; name: string; isDefault: boolean }>('/api/whatsapp/provision', { method: 'POST', body: JSON.stringify(body) }),
  getWhatsappAdminConfig: () =>
    request<{ host: string; hasAdminToken: boolean }>('/api/whatsapp/admin-config'),
  setWhatsappAdminConfig: (body: { host?: string; adminToken?: string }) =>
    request<{ host: string; hasAdminToken: boolean }>('/api/whatsapp/admin-config', { method: 'POST', body: JSON.stringify(body) }),

  // Instagram Accounts
  listInstagramAccounts: () => request<any[]>('/api/instagram/accounts'),
  addInstagramAccount: (body: { accessToken: string; instagramUserId: string; username?: string }) =>
    request('/api/instagram/accounts', { method: 'POST', body: JSON.stringify(body) }),
  setDefaultInstagramAccount: (id: string) =>
    request(`/api/instagram/accounts/${id}/default`, { method: 'PUT' }),
  deleteInstagramAccount: (id: string) =>
    request(`/api/instagram/accounts/${id}`, { method: 'DELETE' }),

  // Social Accounts (multi-platform)
  listSocialAccounts: () => request<any[]>('/api/social-accounts'),
  connectFacebookFromInstagram: () =>
    request<any>('/api/social-accounts/facebook/connect-from-instagram', { method: 'POST' }),
  getFacebookAuthUrl: () => request<any>('/api/social-accounts/facebook/auth-url'),
  getTikTokAuthUrl: () => request<any>('/api/social-accounts/tiktok/auth-url'),
  addSocialAccount: (body: { platform: string; accessToken: string; refreshToken?: string; platformUserId: string; username?: string; displayName?: string; pageId?: string; expiresAt?: string }) =>
    request('/api/social-accounts', { method: 'POST', body: JSON.stringify(body) }),
  setDefaultSocialAccount: (id: string) =>
    request(`/api/social-accounts/${id}/default`, { method: 'PUT' }),
  deleteSocialAccount: (id: string) =>
    request(`/api/social-accounts/${id}`, { method: 'DELETE' }),

  // Calendar Import
  importCalendar: (body: { icsContent: string; brandId?: string; platforms?: string[] }) =>
    request<{ imported: number; postIds: string[] }>('/api/calendar/import', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  getLinkedInAuthUrl: () => request<{ authUrl: string; state: string }>('/api/social-accounts/linkedin/auth-url'),
  getXAuthUrl: () => request<{ authUrl: string; state: string; codeVerifier: string }>('/api/social-accounts/x/auth-url'),

  facebookProfile: (accountId?: string) =>
    request<any>(`/api/social-accounts/facebook/profile${accountId ? `?accountId=${accountId}` : ''}`),
  facebookProfiles: () => request<any>('/api/social-accounts/facebook/profiles'),
  linkedinProfile: () => request<any>('/api/social-accounts/linkedin/profile'),
  xProfile: () => request<any>('/api/social-accounts/x/profile'),
  uploadYoutubeCookies: async (file: File) => {
    const formData = new FormData();
    formData.append('cookies', file);
    const headers: Record<string, string> = {};
    const t = getToken();
    if (t) headers['Authorization'] = `Bearer ${t}`;
    const res = await fetch(`${BASE_URL}/api/settings/youtube-cookies`, {
      method: 'POST',
      headers,
      body: formData,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || 'Upload failed');
    return data?.data;
  },
};
