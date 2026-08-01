import { prisma } from '../config/database';

/**
 * Agenda de @ do Instagram.
 *
 * POR QUE EXISTE: a API do Meta nao oferece busca de usuario por prefixo.
 * O unico endpoint de consulta e o business_discovery, que exige o @ exato e
 * completo e so responde para contas Business/Creator publicas. Entao o
 * autocomplete nao pode vir do Instagram — ele vem da agenda do proprio
 * usuario, alimentada por todo @ que ele ja usou.
 */

/** Tira @, espacos e normaliza para minusculo — o Instagram nao diferencia caixa. */
export function normalizeUsername(raw: string): string {
  return raw.trim().replace(/^@+/, '').toLowerCase();
}

/**
 * Extrai @ de um texto livre (legenda de post, por exemplo).
 *
 * O @ do Instagram aceita letra, numero, ponto e underline, ate 30 chars.
 * Exigimos 2+ para nao capturar "@a" solto, e ignoramos e-mail — por isso
 * o @ nao pode vir logo depois de caractere de palavra.
 */
export function extractMentions(text: string | null | undefined): string[] {
  if (!text) return [];
  const found = text.match(/(^|[^\w@])@([a-zA-Z0-9._]{2,30})/g) || [];
  return found
    .map((m) => normalizeUsername(m.slice(m.indexOf('@'))))
    // "valeu @jus." termina frase: o ponto e pontuacao, nao parte do @.
    // Ponto no meio ("loja.oficial") e valido e fica.
    .map((u) => u.replace(/\.+$/, ''))
    .filter((u) => u.length >= 2);
}

/**
 * Popula a agenda a partir do historico do usuario.
 *
 * POR QUE: a agenda comecava vazia, entao no primeiro uso o autocomplete
 * nao sugeria nada e parecia quebrado. As legendas dos posts antigos ja
 * contem os @ que a pessoa realmente usa — e a melhor semente disponivel.
 *
 * Roda uma vez, quando a agenda esta vazia. Nunca lanca.
 */
export async function seedContactsFromHistory(userId: string): Promise<number> {
  try {
    const posts = await prisma.post.findMany({
      where: { userId },
      select: { caption: true },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    const counts = new Map<string, number>();
    for (const p of posts) {
      for (const u of extractMentions(p.caption)) {
        counts.set(u, (counts.get(u) || 0) + 1);
      }
    }
    if (counts.size === 0) return 0;

    for (const [username, useCount] of counts) {
      await prisma.igContact.upsert({
        where: { userId_username: { userId, username } },
        create: { userId, username, useCount },
        update: {},
      }).catch(() => {});
    }

    console.log(`[IgContacts] Agenda populada com ${counts.size} @ das legendas antigas`);
    return counts.size;
  } catch (err) {
    console.warn('[IgContacts] Falha ao popular agenda:', (err as Error).message);
    return 0;
  }
}

/**
 * Puxa contatos da conta do Instagram do usuario.
 *
 * A API nao deixa buscar perfis nem listar seguidores, mas deixa ler o
 * proprio conteudo. Duas fontes de gente de verdade saem dai:
 *
 *  1. legendas dos seus posts  -> quem voce marca
 *  2. comentarios nos seus posts -> quem interage com voce
 *
 * Os comentarios exigem a permissao instagram_manage_comments. Se ela nao
 * estiver aprovada, essa parte falha sozinha e seguimos so com as legendas.
 */
export async function syncContactsFromInstagram(
  userId: string,
): Promise<{ added: number; sources: string[]; reason?: string }> {
  const account = await prisma.instagramToken.findFirst({
    where: { userId },
    orderBy: { isDefault: 'desc' },
  });
  // Sem conta conectada nao ha de onde puxar. Devolvemos o motivo em vez de
  // um zero mudo, senao a tela so diz "nao achei" e ninguem sabe por que.
  if (!account) {
    return {
      added: 0,
      sources: [],
      reason: 'Nenhuma conta do Instagram conectada. Conecte em Configuracoes para eu importar seus contatos.',
    };
  }

  const token = account.accessToken;
  const isBusiness = token.startsWith('EAA');
  const base = isBusiness ? 'https://graph.facebook.com/v21.0' : 'https://graph.instagram.com/v21.0';
  const me = isBusiness ? account.instagramUserId : 'me';

  const found = new Map<string, number>();
  const sources: string[] = [];
  const bump = (u: string, n = 1) => {
    const clean = normalizeUsername(u);
    if (clean.length >= 2) found.set(clean, (found.get(clean) || 0) + n);
  };

  // --- 1. Legendas dos proprios posts ---
  let mediaIds: string[] = [];
  try {
    const res = await fetch(`${base}/${me}/media?fields=id,caption,comments_count&limit=100&access_token=${token}`);
    const data = (await res.json()) as any;
    if (data?.error) throw new Error(data.error.message);
    const items = data?.data || [];
    for (const m of items) {
      for (const u of extractMentions(m.caption)) bump(u, 2); // quem voce marca pesa mais
      if ((m.comments_count ?? 0) > 0) mediaIds.push(m.id);
    }
    if (items.length) sources.push(`${items.length} posts`);
  } catch (err) {
    console.warn('[IgContacts] Nao consegui ler as midias do Instagram:', (err as Error).message);
  }

  // --- 2. Comentarios (quem interage com voce) ---
  // Limitado aos 25 posts mais recentes com comentario, para nao estourar
  // o rate limit do Meta numa unica sincronizacao.
  let commentUsers = 0;
  for (const mediaId of mediaIds.slice(0, 25)) {
    try {
      const res = await fetch(`${base}/${mediaId}/comments?fields=username,text&limit=50&access_token=${token}`);
      const data = (await res.json()) as any;
      if (data?.error) throw new Error(data.error.message);
      for (const c of data?.data || []) {
        if (c.username) { bump(c.username); commentUsers++; }
        for (const u of extractMentions(c.text)) bump(u);
      }
    } catch (err) {
      // Permissao de comentarios costuma nao estar aprovada. Nao e erro
      // fatal: as legendas ja renderam contatos.
      console.warn('[IgContacts] Comentarios indisponiveis:', (err as Error).message);
      break;
    }
  }
  if (commentUsers) sources.push(`${commentUsers} comentarios`);

  // --- 3. Quem marcou VOCE em posts (amigos de verdade) ---
  // /tags devolve as midias em que a conta foi marcada, com o @ de quem
  // marcou. E a fonte mais proxima de "meus amigos" que a API oferece.
  try {
    const res = await fetch(`${base}/${me}/tags?fields=username,caption&limit=100&access_token=${token}`);
    const data = (await res.json()) as any;
    if (data?.error) throw new Error(data.error.message);
    let tagged = 0;
    for (const m of data?.data || []) {
      if (m.username) { bump(m.username, 2); tagged++; }
      for (const u of extractMentions(m.caption)) bump(u);
    }
    if (tagged) sources.push(`${tagged} marcacoes em voce`);
  } catch (err) {
    console.warn('[IgContacts] /tags indisponivel:', (err as Error).message);
  }

  // Nao guardamos a propria conta como contato
  if (account.username) found.delete(normalizeUsername(account.username));

  for (const [username, useCount] of found) {
    await prisma.igContact.upsert({
      where: { userId_username: { userId, username } },
      create: { userId, username, useCount },
      update: { useCount: { increment: 0 } },
    }).catch(() => {});
  }

  console.log(`[IgContacts] Sync do Instagram: ${found.size} contatos (${sources.join(', ') || 'nenhuma fonte'})`);
  return {
    added: found.size,
    sources,
    reason: found.size === 0
      ? 'Conta conectada, mas nao encontrei nenhum @ nas legendas, comentarios ou marcacoes dos seus posts.'
      : undefined,
  };
}

/**
 * Sugestoes para o autocomplete.
 *
 * Ordena por prefixo primeiro (quem digita "jus" quer "jusciara" antes de
 * "arjus"), depois pelos mais usados.
 */
export async function searchContacts(userId: string, query: string, limit = 8) {
  const q = normalizeUsername(query);

  const contacts = await prisma.igContact.findMany({
    where: q
      ? { userId, username: { contains: q, mode: 'insensitive' } }
      : { userId },
    orderBy: [{ useCount: 'desc' }, { lastUsedAt: 'desc' }],
    take: limit * 3, // folga para reordenar por prefixo abaixo
  });

  if (!q) return contacts.slice(0, limit);

  const startsWith = contacts.filter((c) => c.username.startsWith(q));
  const contains = contacts.filter((c) => !c.username.startsWith(q));
  return [...startsWith, ...contains].slice(0, limit);
}

/**
 * Registra os @ usados num post. Chamado depois de criar/atualizar o post,
 * de forma que a agenda cresca sozinha conforme o uso.
 *
 * Nunca lanca: falhar aqui nao pode derrubar a criacao do post.
 */
export async function rememberContacts(userId: string, usernames: string[]): Promise<void> {
  const unique = Array.from(new Set(usernames.map(normalizeUsername).filter(Boolean)));
  if (unique.length === 0) return;

  for (const username of unique) {
    try {
      await prisma.igContact.upsert({
        where: { userId_username: { userId, username } },
        create: { userId, username },
        update: { useCount: { increment: 1 }, lastUsedAt: new Date() },
      });
    } catch (err) {
      console.warn(`[IgContacts] Falha ao registrar @${username}:`, (err as Error).message);
    }
  }
}

/** Extrai todos os @ de um payload de post (marcacao, colaborador, patrocinador). */
export function usernamesFromPost(body: {
  userTags?: Array<{ username: string }> | unknown;
  collaborators?: string[] | unknown;
}): string[] {
  const out: string[] = [];
  if (Array.isArray(body.userTags)) {
    for (const t of body.userTags) {
      if (t && typeof (t as any).username === 'string') out.push((t as any).username);
    }
  }
  if (Array.isArray(body.collaborators)) {
    for (const c of body.collaborators) if (typeof c === 'string') out.push(c);
  }
  return out;
}

/**
 * Confirma um @ pelo business_discovery e guarda o resultado na agenda.
 *
 * LIMITES DO META (nao nossos):
 *  - so funciona com token do Login do Facebook (EAA);
 *  - so encontra conta Business/Creator PUBLICA — perfil pessoal nunca responde;
 *  - exige o @ exato, nao aceita prefixo.
 *
 * Por isso o retorno distingue "nao encontrado" de "nao da para verificar":
 * um @ pessoal valido cai no segundo caso e nao pode ser tratado como erro.
 */
export async function verifyContact(
  userId: string,
  rawUsername: string,
): Promise<{ status: 'verified' | 'not_found' | 'unavailable'; username: string; displayName?: string; followers?: number; reason?: string }> {
  const username = normalizeUsername(rawUsername);
  if (!username) return { status: 'not_found', username };

  const account = await prisma.instagramToken.findFirst({
    where: { userId },
    orderBy: { isDefault: 'desc' },
  });

  if (!account) {
    return { status: 'unavailable', username, reason: 'Nenhuma conta do Instagram conectada.' };
  }
  if (!account.accessToken.startsWith('EAA')) {
    return {
      status: 'unavailable',
      username,
      reason: 'A confirmacao de perfil exige conta conectada via Login do Facebook.',
    };
  }

  try {
    const fields = `business_discovery.username(${encodeURIComponent(username)}){username,name,followers_count}`;
    const url = `https://graph.facebook.com/v21.0/${account.instagramUserId}?fields=${fields}&access_token=${account.accessToken}`;
    const res = await fetch(url);
    const data = (await res.json()) as any;

    const found = data?.business_discovery;
    if (!found?.username) {
      // O Meta responde erro tanto para @ inexistente quanto para conta
      // pessoal. Nao da para separar os dois, entao nao afirmamos que o
      // perfil nao existe — so que nao foi possivel confirmar.
      return {
        status: 'unavailable',
        username,
        reason: 'Perfil nao confirmado: pode ser conta pessoal ou privada, que o Meta nao expoe.',
      };
    }

    await prisma.igContact.upsert({
      where: { userId_username: { userId, username } },
      create: {
        userId,
        username,
        displayName: found.name || null,
        followers: found.followers_count ?? null,
        verifiedAt: new Date(),
      },
      update: {
        displayName: found.name || null,
        followers: found.followers_count ?? null,
        verifiedAt: new Date(),
      },
    }).catch(() => {});

    return {
      status: 'verified',
      username: found.username,
      displayName: found.name,
      followers: found.followers_count,
    };
  } catch (err) {
    return { status: 'unavailable', username, reason: (err as Error).message };
  }
}
