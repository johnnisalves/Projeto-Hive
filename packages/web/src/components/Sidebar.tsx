'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, PlusSquare, FileText, Calendar, CalendarRange, CheckSquare, FolderKanban, Settings, LogOut, Hexagon, Users, GitBranch, Video, Palette, Wand2, LayoutTemplate, BarChart3, MessageCircle, Wallet, Moon, Sun, Rocket, Radar, RefreshCw, TrendingUp, Zap, Brain, HandCoins, LayoutGrid, FileSpreadsheet, Quote, Gauge, TrendingDown, Copy, BookMarked, Sparkles, Target, CalendarDays, Factory } from 'lucide-react';
import { useAuth } from './AuthProvider';
import { useTheme } from './ThemeProvider';
import { useBrand } from './BrandProvider';

/**
 * O menu em GRUPOS, na ordem do dia de trabalho.
 *
 * Eram 36 itens soltos numa lista so — uma agencia nova abria a tela e nao
 * sabia por onde comecar. Os grupos seguem a sequencia real: primeiro voce
 * planeja, depois cria, depois publica, depois cobra, depois mede.
 *
 * Cada item mantem o `page` que ja existia. Se cada tela nova tivesse a
 * sua chave, o dono nao teria onde marcar a permissao em Equipe e ela
 * sumiria para todo membro com lista de paginas configurada.
 */
const grupos = [
  {
    titulo: null, // sem cabecalho: sao as duas telas de "onde estou"
    itens: [
      { href: '/', label: 'Dashboard', icon: Home, page: 'dashboard' },
      // A primeira tela que a agencia deve olhar de manha, antes de
      // decidir o que fazer no dia.
      { href: '/cockpit', label: 'Cockpit', icon: Gauge, page: 'dashboard' },
    ],
  },
  {
    titulo: 'Planejar',
    itens: [
      { href: '/calendario', label: 'Calendário do Mês', icon: CalendarDays, page: 'planner' },
      { href: '/producao', label: 'Produção', icon: Factory, page: 'planner' },
      { href: '/autopilot', label: 'Piloto Automático', icon: Rocket, page: 'planner' },
      { href: '/planner', label: 'Planejador IA', icon: CalendarRange, page: 'planner' },
      { href: '/calendar', label: 'Calendário', icon: Calendar, page: 'calendar' },
    ],
  },
  {
    titulo: 'Criar',
    itens: [
      { href: '/posts/new', label: 'Novo Post', icon: PlusSquare, page: 'posts' },
      { href: '/posts/visual-editor', label: 'Editor Visual', icon: Wand2, page: 'posts' },
      { href: '/posts/videos', label: 'Reels / Vídeos', icon: Video, page: 'posts' },
      { href: '/ai-studio', label: 'Estúdio IA', icon: Wand2, page: 'ai-studio' },
      { href: '/templates', label: 'Templates', icon: LayoutTemplate, page: 'templates' },
      { href: '/multimarca', label: 'Campanha Multimarca', icon: Copy, page: 'posts' },
      { href: '/importar', label: 'Importar Planilha', icon: FileSpreadsheet, page: 'posts' },
    ],
  },
  {
    titulo: 'Publicar',
    itens: [
      { href: '/posts', label: 'Posts', icon: FileText, page: 'posts' },
      { href: '/grid', label: 'Preview do Feed', icon: LayoutGrid, page: 'calendar' },
      { href: '/reciclar', label: 'Reciclar Posts', icon: RefreshCw, page: 'posts' },
      { href: '/retrospectiva', label: 'Retrospectiva', icon: Sparkles, page: 'analytics' },
    ],
  },
  {
    titulo: 'Vender',
    itens: [
      { href: '/inbox', label: 'Inbox', icon: MessageCircle, page: 'inbox' },
      { href: '/funil', label: 'Funil de Vendas', icon: Target, page: 'inbox' },
      { href: '/vendas', label: 'Vendas', icon: HandCoins, page: 'analytics' },
      { href: '/gatilhos', label: 'Comentou, respondeu', icon: Zap, page: 'inbox' },
      { href: '/depoimentos', label: 'Elogios viram post', icon: Quote, page: 'inbox' },
    ],
  },
  {
    titulo: 'Medir',
    itens: [
      { href: '/analytics', label: 'Analytics', icon: BarChart3, page: 'analytics' },
      { href: '/rentabilidade', label: 'Rentabilidade', icon: TrendingDown, page: 'billing' },
      { href: '/radar', label: 'Radar de Concorrentes', icon: Radar, page: 'analytics' },
      { href: '/tendencias', label: 'Tendências', icon: TrendingUp, page: 'analytics' },
      { href: '/cerebro', label: 'O que eu aprendi', icon: Brain, page: 'ai-studio' },
    ],
  },
  {
    titulo: 'Clientes e equipe',
    itens: [
      { href: '/brands', label: 'Empresas', icon: Palette, page: 'brands' },
      { href: '/playbooks', label: 'Playbooks', icon: BookMarked, page: 'brands' },
      { href: '/tasks', label: 'Tarefas', icon: CheckSquare, page: 'tasks' },
      { href: '/projects', label: 'Projetos', icon: FolderKanban, page: 'projects' },
      { href: '/funnels', label: 'Funis', icon: GitBranch, page: 'funnels' },
      { href: '/team', label: 'Equipe', icon: Users, page: 'team' },
      { href: '/billing', label: 'Cobrança', icon: Wallet, page: 'billing' },
    ],
  },
];

const links = [
  ...grupos.flatMap((g) => g.itens),
  { href: '/settings', label: 'Configuracoes', icon: Settings, page: 'settings' },
];

export function Sidebar() {
  const pathname = usePathname();
  const { user, logout, branding } = useAuth();
  const { theme, toggle } = useTheme();
  const { marcas, marcaId, definir: definirMarca } = useBrand();

  const appName = branding?.appName || 'DisparaAI';
  const logoUrl = branding?.logoUrl || null;

  const isOwner = user?.role === 'OWNER' || !user?.role;
  const allowedPages: string[] = user?.allowedPages || [];

  const visibleLinks = links.filter((link) => {
    if (isOwner) return true;
    if (link.page === 'settings') return true;
    if (link.page === 'team') return user?.role === 'ADMIN';
    if (allowedPages.length === 0) return true;
    return allowedPages.includes(link.page);
  });

  const settingsLink = visibleLinks.find((l) => l.page === 'settings');

  // Grupo que fica so com itens sem permissao desaparece inteiro, cabecalho
  // junto. Sem isso, um membro com acesso restrito veria titulos de secao
  // seguidos de nada.
  const permitido = new Set(visibleLinks.map((l) => l.href));
  const gruposVisiveis = grupos
    .map((g) => ({ ...g, itens: g.itens.filter((i) => permitido.has(i.href)) }))
    .filter((g) => g.itens.length > 0);

  return (
    <aside className="fixed left-0 top-0 h-full w-60 bg-bg-card border-r border-border flex flex-col z-20 transition-colors duration-200">
      {/* Logo Area */}
      <div className="p-6 flex flex-col items-start gap-1">
        <div className="flex items-center gap-2">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt={appName} className="h-8 max-w-[180px] object-contain" />
          ) : (
            <>
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary via-accent-pink to-accent-orange flex items-center justify-center text-white shadow-sm">
                <Hexagon className="w-5 h-5" strokeWidth={2.5} fill="currentColor" />
              </div>
              <span className="font-bold text-[20px] tracking-tight bg-gradient-to-r from-primary to-accent-pink bg-clip-text text-transparent">
                {appName}
              </span>
            </>
          )}
        </div>
        {!logoUrl && <span className="text-[10px] font-bold tracking-[1px] text-text-muted ml-10">AI PLATFORM</span>}
      </div>

      {/* A empresa em que voce esta trabalhando.
          Fica no topo, sempre visivel: numa agencia, olhar o numero achando
          que e de um cliente e ser de outro nao e incomodo, e risco. */}
      {marcas.length > 0 && (
        <div className="px-3 pb-3">
          <label className="block text-[9px] font-bold text-text-muted px-1 mb-1 tracking-wider uppercase">
            Empresa
          </label>
          <select
            value={marcaId}
            onChange={(e) => definirMarca(e.target.value)}
            className="w-full px-2.5 py-2 rounded-lg bg-bg-main border border-border text-[12px] font-medium text-text-primary focus:outline-none focus:border-primary/50"
          >
            {marcas.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 px-3 py-2 flex flex-col gap-1 overflow-y-auto">
        {gruposVisiveis.map((grupo, gi) => (
          <div key={grupo.titulo || `grupo-${gi}`} className={grupo.titulo ? 'mt-3' : ''}>
            {grupo.titulo && (
              <span className="block text-[10px] font-bold text-text-muted px-4 mb-1 tracking-wider uppercase">
                {grupo.titulo}
              </span>
            )}
            {grupo.itens.map((link) => {
              const active = pathname === link.href;
              const Icon = link.icon;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`flex items-center gap-3 px-4 py-2 rounded-lg text-[13px] font-medium transition-all duration-200 relative ${
                    active
                      ? 'text-primary bg-primary/[0.08]'
                      : 'text-text-secondary hover:bg-bg-card-hover hover:text-text-primary'
                  }`}
                >
                  {active && (
                    <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-3/4 rounded-r-full bg-gradient-to-b from-primary to-accent-pink" />
                  )}
                  <Icon className="w-[18px] h-[18px] flex-shrink-0" strokeWidth={active ? 2 : 1.5} />
                  {link.label}
                </Link>
              );
            })}
          </div>
        ))}

        {/* Settings pushed to bottom */}
        {settingsLink && (
          <Link
            href="/settings"
            className={`flex items-center gap-3 px-4 py-2.5 rounded-lg text-[14px] font-medium transition-all duration-200 relative mt-auto mb-4 ${
              pathname === '/settings'
                ? 'text-primary bg-primary/[0.08]'
                : 'text-text-secondary hover:bg-bg-card-hover hover:text-text-primary'
            }`}
          >
            {pathname === '/settings' && (
              <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-3/4 rounded-r-full bg-gradient-to-b from-primary to-accent-pink" />
            )}
            <Settings className="w-5 h-5" strokeWidth={pathname === '/settings' ? 2 : 1.5} />
            Configuracoes
          </Link>
        )}
      </nav>

      {/* Bottom: Theme toggle + Logout */}
      <div className="px-3 pb-5 border-t border-border pt-3 space-y-1">
        <button
          onClick={toggle}
          className="flex items-center gap-3 w-full px-4 py-2.5 rounded-lg text-[14px] font-medium text-text-secondary hover:text-primary hover:bg-primary/[0.06] transition-all duration-200"
        >
          {theme === 'dark' ? <Sun className="w-5 h-5" strokeWidth={1.5} /> : <Moon className="w-5 h-5" strokeWidth={1.5} />}
          {theme === 'dark' ? 'Modo claro' : 'Modo escuro'}
        </button>
        <button
          onClick={logout}
          className="flex items-center gap-3 w-full px-4 py-2.5 rounded-lg text-[14px] font-medium text-text-muted hover:text-status-failed hover:bg-red-500/10 transition-all duration-200"
        >
          <LogOut className="w-5 h-5" strokeWidth={1.5} />
          Sair
        </button>
      </div>
    </aside>
  );
}
