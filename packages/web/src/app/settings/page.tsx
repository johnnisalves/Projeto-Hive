'use client';

import { useEffect, useState, useRef } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../components/AuthProvider';
import {
  Camera, Zap, Send, Monitor, LogOut, CheckCircle, XCircle, Plus, Trash2,
  Loader2, Eye, EyeOff, Save, Copy, Check, ExternalLink, Hexagon, Cloud, Palette,
  QrCode, Smartphone,
} from 'lucide-react';
import { useConfirm } from '@/components/ConfirmModal';

interface SettingFieldOption {
  value: string;
  label: string;
  hint?: string;
}

interface SettingField {
  key: string;
  label: string;
  placeholder: string;
  type?: 'password' | 'text' | 'select';
  options?: SettingFieldOption[];
  defaultValue?: string;
  hint?: string;
}

interface ServiceConfig {
  name: string;
  description: string;
  icon: any;
  iconBg: string;
  iconColor: string;
  fields: SettingField[];
}

const SERVICES: ServiceConfig[] = [
  {
    name: 'Facebook App (para token Instagram)',
    description: 'Necessario para trocar token short-lived por long-lived (60 dias)',
    icon: Camera,
    iconBg: 'bg-blue-500/10',
    iconColor: 'text-blue-600',
    fields: [
      { key: 'FACEBOOK_APP_ID', label: 'App ID', placeholder: '953530xxxxxxx (topo do Facebook Developer)' },
      { key: 'FACEBOOK_APP_SECRET', label: 'App Secret', placeholder: 'Chave secreta do app do Instagram' },
    ],
  },
  {
    name: 'Geracao de Imagens (Gemini)',
    description: 'Geracao de imagens e legendas com IA via Google Gemini',
    icon: Zap,
    iconBg: 'bg-amber-500/10',
    iconColor: 'text-amber-600',
    fields: [
      { key: 'NANO_BANANA_API_KEY', label: 'Google Gemini API Key', placeholder: 'AIzaSyxxxxxxxxx...' },
      {
        key: 'NANO_BANANA_MODEL',
        label: 'Modelo de geracao de imagem',
        placeholder: '',
        type: 'select',
        defaultValue: 'gemini-3.1-flash-image-preview',
        options: [
          { value: 'gemini-3.1-flash-image-preview', label: 'Nano Banana Pro (recomendado)', hint: 'Mais qualidade • mais caro' },
          { value: 'gemini-2.5-flash-image', label: 'Nano Banana 2.5', hint: 'Estavel (GA) • mais rapido e barato' },
          { value: 'gemini-2.5-flash-image-preview', label: 'Nano Banana 2.5 Preview', hint: 'Versao preview da 2.5' },
        ],
      },
    ],
  },
  {
    name: 'Telegram Bot',
    description: 'Criacao e gerenciamento de posts via Telegram',
    icon: Send,
    iconBg: 'bg-blue-500/10',
    iconColor: 'text-blue-500',
    fields: [
      { key: 'TELEGRAM_BOT_TOKEN', label: 'Bot Token', placeholder: '123456:ABCxxxxxxx...' },
      { key: 'TELEGRAM_ALLOWED_CHAT_IDS', label: 'Chat IDs (separados por virgula)', placeholder: '123456789,987654321' },
    ],
  },
  {
    name: 'Cloudinary (obrigatorio para publicar no Instagram)',
    description: 'Meta apertou o filtro de hosts em 2026 — Cloudinary e o CDN intermediario que faz Meta aceitar suas imagens. Free tier 25GB/mes em cloudinary.com',
    icon: Cloud,
    iconBg: 'bg-sky-500/10',
    iconColor: 'text-sky-500',
    fields: [
      { key: 'CLOUDINARY_CLOUD_NAME', label: 'Cloud Name', placeholder: 'dxxxxxxxx' },
      { key: 'CLOUDINARY_API_KEY', label: 'API Key', placeholder: '15 digitos' },
      { key: 'CLOUDINARY_API_SECRET', label: 'API Secret', placeholder: 'clica em "reveal" no dashboard Cloudinary' },
    ],
  },
  {
    name: 'LinkedIn (publicacao em perfil pessoal)',
    description: 'Crie um app em linkedin.com/developers, adicione "Share on LinkedIn", copie Client ID e Secret',
    icon: Hexagon,
    iconBg: 'bg-sky-500/10',
    iconColor: 'text-sky-600',
    fields: [
      { key: 'LINKEDIN_CLIENT_ID', label: 'Client ID', placeholder: '77xxxxxxxxxx' },
      { key: 'LINKEDIN_CLIENT_SECRET', label: 'Client Secret', placeholder: 'Chave secreta do app LinkedIn' },
    ],
  },
  {
    name: 'X / Twitter (text only, free tier)',
    description: 'Crie um app em developer.x.com, habilite OAuth 2.0 com PKCE. Free tier = 1.500 tweets/mes',
    icon: Hexagon,
    iconBg: 'bg-gray-500/10',
    iconColor: 'text-gray-600',
    fields: [
      { key: 'X_CLIENT_ID', label: 'Client ID', placeholder: 'xxxxxxxxxxxxx' },
      { key: 'X_CLIENT_SECRET', label: 'Client Secret', placeholder: 'Chave secreta do app X' },
    ],
  },
];

export default function SettingsPage() {
  const confirm = useConfirm();
  const { logout } = useAuth();
  const [settings, setSettings] = useState<Record<string, { value: string; hasValue: boolean }>>({});
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [showValues, setShowValues] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [mcpCopied, setMcpCopied] = useState(false);

  // White-label (#10)
  const [wlForm, setWlForm] = useState({ appName: '', logoUrl: '', primaryColor: '' });
  const [wlSaving, setWlSaving] = useState(false);
  const [wlSaved, setWlSaved] = useState(false);

  useEffect(() => {
    api.getBranding()
      .then((b: any) => setWlForm({ appName: b?.appName || '', logoUrl: b?.logoUrl || '', primaryColor: b?.primaryColor || '' }))
      .catch(() => {});
  }, []);

  async function handleSaveBranding() {
    setWlSaving(true);
    setWlSaved(false);
    try {
      await api.setBranding({ appName: wlForm.appName || null, logoUrl: wlForm.logoUrl || null, primaryColor: wlForm.primaryColor || null });
      setWlSaved(true);
      setTimeout(() => window.location.reload(), 700); // recarrega pra aplicar no menu
    } catch (err: any) {
      alert(err?.message || 'Erro ao salvar');
    }
    setWlSaving(false);
  }

  // Instagram accounts
  const [igAccounts, setIgAccounts] = useState<any[]>([]);
  const [showAddIg, setShowAddIg] = useState(false);
  const [igToken, setIgToken] = useState('');
  const [igUserId, setIgUserId] = useState('');
  const [igAdding, setIgAdding] = useState(false);

  // WhatsApp (Status via UAZ)
  const [waConns, setWaConns] = useState<any[]>([]);
  const [showAddWa, setShowAddWa] = useState(false);
  const [waForm, setWaForm] = useState({ name: '', host: 'https://wapi.digitalcrm.com.br', token: '', phone: '' });
  const [waAdding, setWaAdding] = useState(false);
  const [waTest, setWaTest] = useState('');
  const [waProvisioning, setWaProvisioning] = useState(false);
  const [showWaAdvanced, setShowWaAdvanced] = useState(false);
  // Config WUZAPI da plataforma (admin token) — habilita o "conectar so clicando"
  const [waAdminCfg, setWaAdminCfg] = useState<{ host: string; hasAdminToken: boolean }>({ host: '', hasAdminToken: false });
  const [showWaAdminCfg, setShowWaAdminCfg] = useState(false);
  const [waAdminForm, setWaAdminForm] = useState({ host: '', adminToken: '' });
  const [waAdminSaving, setWaAdminSaving] = useState(false);
  // Modal de conexao por QR (ao vivo)
  const [waQr, setWaQr] = useState<{ open: boolean; id: string; name: string; qr: string | null; loggedIn: boolean; loading: boolean; err: string; stalled: boolean }>(
    { open: false, id: '', name: '', qr: null, loggedIn: false, loading: false, err: '', stalled: false }
  );
  const waQrTimer = useRef<any>(null);
  const waQrTick = useRef(0);

  // Social accounts (multi-platform)
  const [socialAccounts, setSocialAccounts] = useState<any[]>([]);
  const [showAddSocial, setShowAddSocial] = useState(false);
  const [socialForm, setSocialForm] = useState({ platform: 'FACEBOOK', accessToken: '', platformUserId: '', username: '', displayName: '', pageId: '' });
  const [socialAdding, setSocialAdding] = useState(false);

  useEffect(() => {
    loadSettings();
    loadIgAccounts();
    loadSocialAccounts();
    loadWaConns();
    loadWaAdminCfg();
    return () => { if (waQrTimer.current) clearInterval(waQrTimer.current); };
  }, []);

  async function loadWaConns() {
    try {
      const res: any = await api.listWhatsappConnections();
      setWaConns(Array.isArray(res) ? res : res?.data || []);
    } catch {}
  }

  async function loadWaAdminCfg() {
    try {
      const r: any = await api.getWhatsappAdminConfig();
      const d = r?.data || r;
      setWaAdminCfg({ host: d?.host || '', hasAdminToken: !!d?.hasAdminToken });
      setWaAdminForm((f) => ({ ...f, host: d?.host || 'https://wapi.digitalcrm.com.br' }));
    } catch {}
  }

  // Fluxo automatico: cria a instancia no WuzAPI sozinho + abre o QR (sem colar token)
  async function handleProvisionWa() {
    if (!waForm.name) return;
    setWaProvisioning(true);
    setWaTest('');
    try {
      const r: any = await api.provisionWhatsapp({ name: waForm.name, phone: waForm.phone || undefined });
      const newId = r?.data?.id || r?.id;
      const newName = waForm.name;
      setWaForm({ name: '', host: 'https://wapi.digitalcrm.com.br', token: '', phone: '' });
      setShowAddWa(false);
      await loadWaConns();
      if (newId) openWaQr(newId, newName);
    } catch (e: any) {
      setWaTest('Erro ao conectar: ' + (e?.message || ''));
    }
    setWaProvisioning(false);
  }

  async function handleSaveWaAdminCfg() {
    setWaAdminSaving(true);
    try {
      await api.setWhatsappAdminConfig({ host: waAdminForm.host || undefined, adminToken: waAdminForm.adminToken || undefined });
      setWaAdminForm((f) => ({ ...f, adminToken: '' }));
      await loadWaAdminCfg();
    } catch {}
    setWaAdminSaving(false);
  }

  async function handleAddWaConn() {
    if (!waForm.name || !waForm.host || !waForm.token) return;
    setWaAdding(true);
    setWaTest('');
    try {
      const r: any = await api.addWhatsappConnection(waForm);
      const newId = r?.data?.id || r?.id;
      const newName = waForm.name;
      setWaForm({ name: '', host: 'https://wapi.digitalcrm.com.br', token: '', phone: '' });
      setShowAddWa(false);
      await loadWaConns();
      if (newId) openWaQr(newId, newName); // ja abre o QR pra conectar na hora
    } catch (e: any) {
      setWaTest('Erro ao salvar: ' + (e?.message || ''));
    }
    setWaAdding(false);
  }

  async function openWaQr(id: string, name: string) {
    if (waQrTimer.current) { clearInterval(waQrTimer.current); waQrTimer.current = null; }
    waQrTick.current = 0;
    setWaQr({ open: true, id, name, qr: null, loggedIn: false, loading: true, err: '', stalled: false });
    try {
      const r: any = await api.getWhatsappQr(id);
      const d = r?.data || r;
      if (d?.loggedIn) { setWaQr((s) => ({ ...s, loading: false, loggedIn: true, qr: null })); await loadWaConns(); return; }
      setWaQr((s) => ({ ...s, loading: false, qr: d?.qr || null }));
    } catch (e: any) {
      setWaQr((s) => ({ ...s, loading: false, err: e?.message || 'Falha ao gerar QR' }));
    }
    waQrTimer.current = setInterval(async () => {
      waQrTick.current++;
      // para de tentar apos ~2,5 min para nao ficar consultando pra sempre
      if (waQrTick.current > 50) {
        if (waQrTimer.current) { clearInterval(waQrTimer.current); waQrTimer.current = null; }
        setWaQr((s) => ({ ...s, stalled: true }));
        return;
      }
      try {
        const st: any = await api.getWhatsappStatus(id);
        const sd = st?.data || st;
        if (sd?.loggedIn) {
          if (waQrTimer.current) { clearInterval(waQrTimer.current); waQrTimer.current = null; }
          setWaQr((s) => ({ ...s, loggedIn: true, qr: null }));
          await loadWaConns();
          return;
        }
        // renova o QR a cada ~18s (WhatsApp expira o QR rapido)
        if (waQrTick.current % 6 === 0) {
          const r: any = await api.getWhatsappQr(id);
          const d = r?.data || r;
          if (d?.loggedIn) {
            if (waQrTimer.current) { clearInterval(waQrTimer.current); waQrTimer.current = null; }
            setWaQr((s) => ({ ...s, loggedIn: true, qr: null }));
            await loadWaConns();
            return;
          }
          setWaQr((s) => ({ ...s, qr: d?.qr || s.qr }));
        }
      } catch { /* transiente, ignora */ }
    }, 3000);
  }

  function closeWaQr() {
    if (waQrTimer.current) { clearInterval(waQrTimer.current); waQrTimer.current = null; }
    setWaQr({ open: false, id: '', name: '', qr: null, loggedIn: false, loading: false, err: '', stalled: false });
  }

  async function handleTestWaConn() {
    if (!waForm.host || !waForm.token) return;
    setWaTest('Testando...');
    try {
      const r: any = await api.testWhatsappConnection({ host: waForm.host, token: waForm.token });
      setWaTest(r?.ok ? '✅ Conexao OK' : '❌ Falhou: ' + (r?.detail || ''));
    } catch (e: any) {
      setWaTest('❌ Erro: ' + (e?.message || ''));
    }
  }

  async function handleSetDefaultWa(id: string) {
    try { await api.setDefaultWhatsappConnection(id); await loadWaConns(); } catch {}
  }

  async function handleDeleteWa(id: string) {
    if (!await confirm({ message: 'Remover esta conexao WhatsApp?' })) return;
    try { await api.deleteWhatsappConnection(id); await loadWaConns(); } catch {}
  }

  async function loadSocialAccounts() {
    try {
      const res: any = await api.listSocialAccounts();
      setSocialAccounts(Array.isArray(res) ? res : res?.data || []);
    } catch {}
  }

  async function handleAddSocialAccount() {
    if (!socialForm.accessToken || !socialForm.platformUserId) return;
    setSocialAdding(true);
    try {
      await api.addSocialAccount(socialForm as any);
      setSocialForm({ platform: 'FACEBOOK', accessToken: '', platformUserId: '', username: '', displayName: '', pageId: '' });
      setShowAddSocial(false);
      await loadSocialAccounts();
    } catch {}
    setSocialAdding(false);
  }

  async function handleSetDefaultSocial(id: string) {
    try {
      await api.setDefaultSocialAccount(id);
      await loadSocialAccounts();
    } catch {}
  }

  async function handleDeleteSocial(id: string) {
    if (!await confirm({ message: 'Remover esta conta social?' })) return;
    try {
      await api.deleteSocialAccount(id);
      await loadSocialAccounts();
    } catch {}
  }

  async function handleConnectFacebook() {
    try {
      // 1) Tenta o atalho: reaproveitar o token do Instagram (se for conta Business)
      try {
        const quick: any = await api.connectFacebookFromInstagram();
        if (quick?.count > 0) {
          await loadSocialAccounts();
          alert(`Facebook conectado! Pagina(s): ${quick.connected.map((c: any) => c.name).join(', ')}`);
          return;
        }
      } catch { /* segue pro Login do Facebook */ }
      // 2) Login do Facebook (OAuth)
      const data: any = await api.getFacebookAuthUrl();
      if (data.authUrl) {
        window.open(data.authUrl, '_blank', 'width=600,height=750');
      } else {
        alert('Configure o App ID e Secret do Facebook nas configuracoes acima e tente de novo.');
      }
    } catch (err: any) {
      alert('Para conectar o Facebook: informe o "Facebook App ID" e "App Secret" nas configuracoes acima (secao Facebook App), depois clique aqui de novo. Detalhe: ' + (err?.message || ''));
    }
  }

  async function handleConnectLinkedIn() {
    try {
      const data: any = await api.getLinkedInAuthUrl();
      if (data.authUrl) {
        window.open(data.authUrl, '_blank', 'width=600,height=700');
      } else {
        alert('Erro: URL de autorização não retornada. Verifique se o LINKEDIN_CLIENT_ID está salvo nas configurações.');
      }
    } catch (err: any) {
      alert('Erro ao conectar LinkedIn: ' + (err?.message || 'Verifique se LINKEDIN_CLIENT_ID e LINKEDIN_CLIENT_SECRET estão salvos nas configurações acima.'));
    }
  }

  async function handleConnectX() {
    try {
      const data: any = await api.getXAuthUrl();
      if (data.authUrl) {
        window.open(data.authUrl, '_blank', 'width=600,height=700');
      } else {
        alert('Erro: URL de autorização não retornada. Verifique se o X_CLIENT_ID está salvo nas configurações.');
      }
    } catch (err: any) {
      alert('Erro ao conectar X/Twitter: ' + (err?.message || 'Verifique se X_CLIENT_ID e X_CLIENT_SECRET estão salvos nas configurações acima.'));
    }
  }

  async function loadIgAccounts() {
    try {
      const res: any = await api.listInstagramAccounts();
      setIgAccounts(Array.isArray(res) ? res : res?.data || []);
    } catch {}
  }

  async function handleAddIgAccount() {
    if (!igToken || !igUserId) return;
    setIgAdding(true);
    try {
      await api.addInstagramAccount({ accessToken: igToken, instagramUserId: igUserId });
      setIgToken(''); setIgUserId(''); setShowAddIg(false);
      await loadIgAccounts();
    } catch {}
    setIgAdding(false);
  }

  async function handleSetDefaultIg(id: string) {
    try {
      await api.setDefaultInstagramAccount(id);
      await loadIgAccounts();
    } catch {}
  }

  async function handleDeleteIg(id: string) {
    if (!await confirm({ message: 'Remover esta conta do Instagram?' })) return;
    try {
      await api.deleteInstagramAccount(id);
      await loadIgAccounts();
    } catch {}
  }

  async function loadSettings() {
    try {
      const res: any = await api.getSettings();
      // res can be: array directly, or { data: array }, or { items: array }
      let items: any[] = [];
      if (Array.isArray(res)) items = res;
      else if (Array.isArray(res?.data)) items = res.data;
      else if (Array.isArray(res?.items)) items = res.items;

      const map: Record<string, { value: string; hasValue: boolean }> = {};
      items.forEach((s: any) => {
        map[s.key] = { value: s.value || '', hasValue: !!s.hasValue };
      });
      setSettings(map);
    } catch {}
    setLoading(false);
  }

  async function handleSave(key: string) {
    const value = editValues[key];
    if (value === undefined || value === '') return;

    setSaving((s) => ({ ...s, [key]: true }));
    try {
      await api.updateSetting(key, value);
      setEditValues((v) => ({ ...v, [key]: '' }));
      setSaved((s) => ({ ...s, [key]: true }));
      setTimeout(() => setSaved((s) => ({ ...s, [key]: false })), 2000);
      // Reload settings to get fresh state
      await loadSettings();
    } catch {}
    setSaving((s) => ({ ...s, [key]: false }));
  }

  const mcpUrl = settings['MCP_URL']?.hasValue ? '' : '';

  function getMcpUrl() {
    // Use saved URL if available, otherwise show placeholder
    const saved = editValues['MCP_URL'] || '';
    if (saved) return saved;
    // Check if we have a saved value in settings
    if (settings['MCP_URL']?.hasValue) return settings['MCP_URL'].value;
    return '';
  }

  function copyMcpUrl() {
    const url = getMcpUrl();
    if (url) {
      navigator.clipboard.writeText(url);
      setMcpCopied(true);
      setTimeout(() => setMcpCopied(false), 2000);
    }
  }

  async function handleSaveMcpUrl() {
    const url = editValues['MCP_URL'];
    if (!url) return;
    setSaving((s) => ({ ...s, MCP_URL: true }));
    try {
      await api.updateSetting('MCP_URL', url);
      setSettings((s) => ({ ...s, MCP_URL: { value: url, hasValue: true } }));
      setSaved((s) => ({ ...s, MCP_URL: true }));
      setTimeout(() => setSaved((s) => ({ ...s, MCP_URL: false })), 2000);
    } catch {}
    setSaving((s) => ({ ...s, MCP_URL: false }));
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto animate-fade-in">
      <div className="mb-6">
        <h1 className="text-page-title text-text-primary">Configuracoes</h1>
        <p className="text-sm text-text-secondary mt-1">Gerencie integracoes e chaves de API</p>
      </div>

      {/* Atalho: Empresas (logo + informacoes ficam la) */}
      <div className="mb-6">
        <a href="/brands" className="card p-5 flex items-center gap-4 border-2 border-primary/30 hover:border-primary transition-colors group block">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-500/10 to-fuchsia-500/10 flex items-center justify-center flex-shrink-0">
            <Hexagon className="w-6 h-6 text-violet-600" strokeWidth={1.5} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-bold text-text-primary">Logo e informacoes da empresa</h3>
            <p className="text-xs text-text-secondary mt-0.5">Logo, telefone/WhatsApp, cores, produtos, direcao de arte e tom de voz ficam no menu <span className="font-semibold text-primary">Empresas</span> — clique aqui para gerenciar</p>
          </div>
          <ExternalLink className="w-4 h-4 text-text-muted group-hover:text-primary transition-colors flex-shrink-0" />
        </a>
      </div>

      {/* White-label (#10) */}
      <div className="mb-6">
        <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-3">White-label</p>
        <div className="card p-5">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-fuchsia-500/10 to-pink-500/10 flex items-center justify-center flex-shrink-0">
              <Palette className="w-6 h-6 text-fuchsia-600" strokeWidth={1.5} />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-bold text-text-primary">Sua marca na plataforma</h3>
              <p className="text-xs text-text-secondary mt-0.5 mb-3">Personalize o nome e o logo que aparecem no menu — ideal para revender a plataforma com a sua marca.</p>

              <label className="block text-xs font-semibold text-text-secondary mb-1">Nome do app</label>
              <input
                value={wlForm.appName}
                onChange={(e) => setWlForm({ ...wlForm, appName: e.target.value })}
                placeholder="DisparaAI"
                maxLength={40}
                className="input-field text-sm mb-3"
              />

              <label className="block text-xs font-semibold text-text-secondary mb-1">URL do logo (opcional)</label>
              <input
                value={wlForm.logoUrl}
                onChange={(e) => setWlForm({ ...wlForm, logoUrl: e.target.value })}
                placeholder="https://.../logo.png"
                className="input-field text-sm mb-2"
              />
              {wlForm.logoUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={wlForm.logoUrl} alt="preview" className="h-8 max-w-[180px] object-contain mb-3" />
              )}

              <label className="block text-xs font-semibold text-text-secondary mb-1">Cor principal</label>
              <div className="flex items-center gap-2 mb-3">
                <input
                  type="color"
                  value={wlForm.primaryColor || '#6C5CE7'}
                  onChange={(e) => setWlForm({ ...wlForm, primaryColor: e.target.value })}
                  className="w-10 h-9 rounded-input border border-border bg-transparent cursor-pointer p-0.5"
                />
                <input
                  value={wlForm.primaryColor}
                  onChange={(e) => setWlForm({ ...wlForm, primaryColor: e.target.value })}
                  placeholder="#6C5CE7"
                  maxLength={7}
                  className="input-field text-sm w-32"
                />
                {wlForm.primaryColor && (
                  <button type="button" onClick={() => setWlForm({ ...wlForm, primaryColor: '' })} className="text-xs text-text-muted hover:text-status-failed">limpar</button>
                )}
                <span className="text-[11px] text-text-muted">aplica em botões, links e destaques do app</span>
              </div>

              <div className="flex items-center gap-3 mt-2">
                <button onClick={handleSaveBranding} disabled={wlSaving} className="btn-cta px-4 py-2 text-sm disabled:opacity-50">
                  {wlSaving ? 'Salvando...' : 'Salvar marca'}
                </button>
                {wlSaved && <span className="text-xs text-status-published font-medium">✓ Salvo</span>}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* MCP Connection */}
      <div className="mb-6">
        <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-3">Conexao MCP</p>
        <div className="card p-5">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-500/10 to-yellow-500/10 flex items-center justify-center flex-shrink-0">
              <Hexagon className="w-6 h-6 text-amber-600" strokeWidth={1.5} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <h3 className="text-sm font-bold text-text-primary">MCP Server</h3>
                <span className="badge badge-completed flex items-center gap-1">
                  <CheckCircle className="w-3 h-3" strokeWidth={2} />
                  Ativo
                </span>
              </div>
              <p className="text-xs text-text-secondary mb-3">
                Conecte ao Claude Desktop, Claude Code ou Cowork com a URL abaixo
              </p>
              <div className="space-y-2">
                <label className="block text-[11px] font-semibold text-text-muted">URL do MCP Server</label>
                <div className="flex items-center gap-2">
                  <input
                    value={editValues['MCP_URL'] ?? (settings['MCP_URL']?.hasValue ? settings['MCP_URL'].value : '')}
                    onChange={(e) => setEditValues((v) => ({ ...v, MCP_URL: e.target.value }))}
                    className="input-field text-xs font-mono"
                    placeholder="https://seu-servidor.sslip.io/mcp"
                  />
                  <button
                    onClick={handleSaveMcpUrl}
                    disabled={!editValues['MCP_URL'] || saving['MCP_URL']}
                    className="flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-semibold transition-colors disabled:opacity-40 bg-primary/10 text-primary hover:bg-primary/20"
                  >
                    {saving['MCP_URL'] ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : saved['MCP_URL'] ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
                  </button>
                  {settings['MCP_URL']?.hasValue && (
                    <button
                      onClick={copyMcpUrl}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary/10 text-primary text-xs font-semibold hover:bg-primary/20 transition-colors"
                    >
                      {mcpCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      {mcpCopied ? 'Copiado!' : 'Copiar'}
                    </button>
                  )}
                </div>
              </div>
              <p className="text-[11px] text-text-muted mt-2">
                40 tools disponiveis: posts, brands, design systems (58 inspiracoes), carrossel misto, imagem composta (IA + HTML), tarefas, projetos, modulos, imagens, legendas, templates HTML, video clips
              </p>

              {/* MCP Token */}
              <div className="mt-3 space-y-2">
                <label className="block text-[11px] font-semibold text-text-muted">Token de Acesso (MCP)</label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 bg-bg-main rounded-lg px-3 py-2 text-xs font-mono text-text-primary truncate">
                    {settings['MCP_TOKEN']?.hasValue ? settings['MCP_TOKEN'].value : 'Nao configurado'}
                  </code>
                  {settings['MCP_TOKEN']?.hasValue && (
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(settings['MCP_TOKEN']?.value || '');
                        setMcpCopied(true);
                        setTimeout(() => setMcpCopied(false), 2000);
                      }}
                      className="flex items-center gap-1 px-3 py-2 rounded-lg bg-primary/10 text-primary text-xs font-semibold hover:bg-primary/20 transition-colors"
                    >
                      {mcpCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      {mcpCopied ? 'Copiado!' : 'Copiar'}
                    </button>
                  )}
                </div>
              </div>

              {/* MCP JSON Config - npx (IDEs: Claude Code, Cursor, VS Code, Gemini) */}
              {settings['MCP_TOKEN']?.hasValue && (
                <div className="mt-4 p-4 rounded-lg bg-bg-main">
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-[11px] font-semibold text-text-muted">JSON de Configuracao (cole na IDE)</label>
                    <button
                      onClick={() => {
                        const mcpUrl = settings['MCP_URL']?.value || '';
                        const apiUrl = mcpUrl.replace(/\/mcp\/?$/, '').replace(/:\d+\/mcp\/?$/, '').replace(/mcp\./, 'api.');
                        const json = JSON.stringify({
                          mcpServers: {
                            openhive: {
                              command: 'npx',
                              args: ['-y', 'openhive-mcp-server@latest'],
                              env: {
                                OPENHIVE_API_URL: apiUrl || 'https://api.seu-servidor.com',
                                OPENHIVE_API_TOKEN: settings['MCP_TOKEN']?.value || 'seu-token-aqui',
                              },
                            },
                          },
                        }, null, 2);
                        navigator.clipboard.writeText(json);
                        setMcpCopied(true);
                        setTimeout(() => setMcpCopied(false), 2000);
                      }}
                      className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                    >
                      {mcpCopied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                      {mcpCopied ? 'Copiado!' : 'Copiar JSON'}
                    </button>
                  </div>
                  <pre className="text-[11px] text-text-secondary font-mono whitespace-pre overflow-x-auto">
{(() => {
  const mcpUrl = settings['MCP_URL']?.value || '';
  const apiUrl = mcpUrl.replace(/\/mcp\/?$/, '').replace(/:\d+\/mcp\/?$/, '').replace(/mcp\./, 'api.');
  return JSON.stringify({
    mcpServers: {
      openhive: {
        command: 'npx',
        args: ['-y', 'openhive-mcp-server@latest'],
        env: {
          OPENHIVE_API_URL: apiUrl || 'https://api.seu-servidor.com',
          OPENHIVE_API_TOKEN: settings['MCP_TOKEN']?.value || 'seu-token-aqui',
        },
      },
    },
  }, null, 2);
})()}
                  </pre>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* API Keys */}
      <div className="space-y-4 mb-8">
        <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-3">Contas do Instagram</p>
        <div className="card p-5 mb-6">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-pink-500/10 to-purple-500/10 flex items-center justify-center flex-shrink-0">
              <Camera className="w-6 h-6 text-pink-500" strokeWidth={1.5} />
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-sm font-bold text-text-primary">Instagram</h3>
                  <p className="text-xs text-text-secondary">Gerencie contas para publicacao automatica</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleConnectFacebook}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-white text-xs font-semibold transition-colors"
                    style={{ background: '#1877F2' }}
                    title="Entra com o Facebook e conecta suas contas de Instagram automaticamente"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Conectar (Login Facebook)
                  </button>
                  <button
                    onClick={() => setShowAddIg(!showAddIg)}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-primary/10 text-primary text-xs font-semibold hover:bg-primary/20 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Manual
                  </button>
                </div>
              </div>

              {/* Add account form */}
              {showAddIg && (
                <div className="p-4 rounded-lg bg-bg-main space-y-3 mb-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-text-muted mb-1">Access Token</label>
                    <input
                      value={igToken}
                      onChange={(e) => setIgToken(e.target.value)}
                      className="input-field text-xs"
                      placeholder="IGAA... (gere no Facebook Developer)"
                      type="password"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-text-muted mb-1">Instagram User ID</label>
                    <input
                      value={igUserId}
                      onChange={(e) => setIgUserId(e.target.value)}
                      className="input-field text-xs"
                      placeholder="17841480xxxxxxxxx"
                    />
                  </div>
                  <p className="text-[10px] text-text-muted">
                    O token sera trocado automaticamente por um long-lived (60 dias) se voce configurou o Facebook App ID e Secret abaixo.
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={handleAddIgAccount}
                      disabled={!igToken || !igUserId || igAdding}
                      className="btn-cta text-xs"
                    >
                      {igAdding ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Salvando...</> : 'Adicionar'}
                    </button>
                    <button onClick={() => { setShowAddIg(false); setIgToken(''); setIgUserId(''); }} className="btn-ghost text-xs">
                      Cancelar
                    </button>
                  </div>
                </div>
              )}

              {/* Account list */}
              {igAccounts.length === 0 && !showAddIg && (
                <p className="text-xs text-text-muted">Nenhuma conta adicionada. Clique em "Adicionar Conta".</p>
              )}
              {igAccounts.map((acc) => (
                <div key={acc.id} className="flex items-center gap-3 p-3 rounded-lg bg-bg-main mb-2">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-pink-400 to-purple-500 flex items-center justify-center text-white text-xs font-bold">
                    {(acc.username || '?')[0].toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-text-primary">@{acc.username || acc.instagramUserId}</p>
                      {acc.isDefault && (
                        <span className="px-1.5 py-0.5 rounded bg-primary/10 text-[10px] font-bold text-primary">PADRAO</span>
                      )}
                    </div>
                    <p className="text-[10px] text-text-muted">
                      Expira: {new Date(acc.expiresAt).toLocaleDateString('pt-BR')}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    {!acc.isDefault && (
                      <button
                        onClick={() => handleSetDefaultIg(acc.id)}
                        className="px-2 py-1 rounded text-[10px] font-semibold text-primary hover:bg-primary/10 transition-colors"
                      >
                        Tornar padrao
                      </button>
                    )}
                    <button
                      onClick={() => handleDeleteIg(acc.id)}
                      className="p-1.5 rounded text-text-muted hover:text-status-failed hover:bg-red-500/10 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-3">WhatsApp (Status)</p>
        <div className="card p-5 mb-6">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(37,211,102,0.12)' }}>
              <span className="text-2xl">🟢</span>
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-sm font-bold text-text-primary">WhatsApp</h3>
                  <p className="text-xs text-text-secondary">Conecte uma instancia (WuzAPI / DCRM API) para publicar no Status do WhatsApp</p>
                </div>
                <button
                  onClick={() => setShowAddWa(!showAddWa)}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-primary/10 text-primary text-xs font-semibold hover:bg-primary/20 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Adicionar Conexao
                </button>
              </div>

              {showAddWa && (
                <div className="p-4 rounded-lg bg-bg-main space-y-3 mb-3">
                  {/* FLUXO AUTOMATICO: so o nome -> conectar -> QR */}
                  <div>
                    <label className="block text-[11px] font-semibold text-text-muted mb-1">Nome / Empresa</label>
                    <input value={waForm.name} onChange={(e) => setWaForm({ ...waForm, name: e.target.value })} className="input-field text-xs" placeholder="Ex: Essenza" />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-text-muted mb-1">Telefone (opcional)</label>
                    <input value={waForm.phone} onChange={(e) => setWaForm({ ...waForm, phone: e.target.value })} className="input-field text-xs" placeholder="(87) 99999-9999" />
                  </div>

                  {waAdminCfg.hasAdminToken ? (
                    <p className="text-[10px] text-text-muted">✨ Clique em <b>Conectar</b> — a instancia e criada automaticamente e o QR aparece aqui. Escaneie no WhatsApp e pronto.</p>
                  ) : (
                    <p className="text-[10px] text-status-failed">⚠️ O conectar automatico precisa do <b>WUZAPI admin token</b> configurado (secao abaixo). Sem ele, use o modo avancado (host+token manual).</p>
                  )}
                  {waTest && <p className="text-[11px] font-medium">{waTest}</p>}

                  <div className="flex gap-2 flex-wrap">
                    <button onClick={handleProvisionWa} disabled={!waForm.name || waProvisioning || !waAdminCfg.hasAdminToken} className="btn-cta text-xs">
                      {waProvisioning ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Conectando...</> : <><QrCode className="w-3.5 h-3.5" /> Conectar (QR automatico)</>}
                    </button>
                    <button onClick={() => { setShowAddWa(false); setWaTest(''); setShowWaAdvanced(false); }} className="btn-ghost text-xs">Cancelar</button>
                    <button onClick={() => setShowWaAdvanced(!showWaAdvanced)} className="text-[11px] text-text-muted hover:text-text-primary underline ml-auto self-center">
                      {showWaAdvanced ? 'Ocultar modo avancado' : 'Avancado: colar host+token manual'}
                    </button>
                  </div>

                  {/* MODO AVANCADO: host + token manual (fallback) */}
                  {showWaAdvanced && (
                    <div className="pt-3 mt-1 border-t border-white/5 space-y-3">
                      <div>
                        <label className="block text-[11px] font-semibold text-text-muted mb-1">Host da API</label>
                        <input value={waForm.host} onChange={(e) => setWaForm({ ...waForm, host: e.target.value })} className="input-field text-xs" placeholder="https://wapi.digitalcrm.com.br" />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-text-muted mb-1">Token da instancia</label>
                        <input value={waForm.token} onChange={(e) => setWaForm({ ...waForm, token: e.target.value })} className="input-field text-xs" placeholder="token da instancia (painel wapi.digitalcrm.com.br)" type="password" />
                      </div>
                      <div className="flex gap-2">
                        <button onClick={handleAddWaConn} disabled={!waForm.name || !waForm.host || !waForm.token || waAdding} className="btn-ghost text-xs">
                          {waAdding ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Salvando...</> : 'Adicionar manual'}
                        </button>
                        <button onClick={handleTestWaConn} disabled={!waForm.host || !waForm.token} className="btn-ghost text-xs">Testar conexao</button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Config da plataforma: WUZAPI admin token (habilita o conectar automatico) */}
              <div className="mb-3">
                <button onClick={() => setShowWaAdminCfg(!showWaAdminCfg)} className="text-[11px] text-text-muted hover:text-text-primary flex items-center gap-1">
                  <Cloud className="w-3 h-3" /> Config WUZAPI (admin da plataforma) {waAdminCfg.hasAdminToken ? <span className="text-green-500 font-semibold">• configurado</span> : <span className="text-status-failed font-semibold">• pendente</span>}
                </button>
                {showWaAdminCfg && (
                  <div className="p-3 mt-2 rounded-lg bg-bg-main space-y-2">
                    <p className="text-[10px] text-text-muted">Token de admin do seu WUZAPI (painel wapi.digitalcrm.com.br). Com ele, cada cliente conecta so clicando — o sistema cria a instancia sozinho. Fica guardado uma vez, para toda a plataforma.</p>
                    <div>
                      <label className="block text-[11px] font-semibold text-text-muted mb-1">Host WUZAPI</label>
                      <input value={waAdminForm.host} onChange={(e) => setWaAdminForm({ ...waAdminForm, host: e.target.value })} className="input-field text-xs" placeholder="https://wapi.digitalcrm.com.br" />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-text-muted mb-1">Admin Token</label>
                      <input value={waAdminForm.adminToken} onChange={(e) => setWaAdminForm({ ...waAdminForm, adminToken: e.target.value })} className="input-field text-xs" placeholder={waAdminCfg.hasAdminToken ? '•••••• (ja configurado — preencha so para trocar)' : 'cole o admin token do WUZAPI'} type="password" />
                    </div>
                    <button onClick={handleSaveWaAdminCfg} disabled={waAdminSaving} className="btn-cta text-xs">
                      {waAdminSaving ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Salvando...</> : 'Salvar config'}
                    </button>
                  </div>
                )}
              </div>

              {waConns.length === 0 && !showAddWa && (
                <p className="text-xs text-text-muted">Nenhuma conexao. Clique em "Adicionar Conexao".</p>
              )}
              {waConns.map((c) => (
                <div key={c.id} className="flex items-center gap-3 p-3 rounded-lg bg-bg-main mb-2">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold" style={{ background: '#25D366' }}>
                    {(c.name || '?')[0].toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-text-primary">{c.name}</p>
                      {c.isDefault && <span className="px-1.5 py-0.5 rounded bg-primary/10 text-[10px] font-bold text-primary">PADRAO</span>}
                    </div>
                    <p className="text-[10px] text-text-muted">{c.phone || c.host}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => openWaQr(c.id, c.name)} className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold text-white transition-colors" style={{ background: '#25D366' }}>
                      <QrCode className="w-3.5 h-3.5" /> Conectar (QR)
                    </button>
                    {!c.isDefault && (
                      <button onClick={() => handleSetDefaultWa(c.id)} className="px-2 py-1 rounded text-[10px] font-semibold text-primary hover:bg-primary/10 transition-colors">Tornar padrao</button>
                    )}
                    <button onClick={() => handleDeleteWa(c.id)} className="p-1.5 rounded text-text-muted hover:text-status-failed hover:bg-red-500/10 transition-colors">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {waQr.open && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={closeWaQr}>
            <div className="bg-bg-card rounded-2xl p-6 max-w-sm w-full text-center" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold text-text-primary flex items-center gap-2">
                  <Smartphone className="w-4 h-4 text-primary" /> Conectar WhatsApp {waQr.name ? `— ${waQr.name}` : ''}
                </h3>
                <button onClick={closeWaQr} className="text-text-muted hover:text-text-primary"><XCircle className="w-5 h-5" /></button>
              </div>

              {waQr.loggedIn ? (
                <div className="py-8">
                  <CheckCircle className="w-14 h-14 text-green-500 mx-auto mb-3" />
                  <p className="text-sm font-bold text-text-primary">Conectado! ✅</p>
                  <p className="text-xs text-text-secondary mt-1">O número está pronto para publicar no Status.</p>
                  <button onClick={closeWaQr} className="btn-cta text-xs mt-4">Concluir</button>
                </div>
              ) : waQr.err ? (
                <div className="py-8">
                  <XCircle className="w-14 h-14 text-status-failed mx-auto mb-3" />
                  <p className="text-sm font-semibold text-text-primary">Não foi possível gerar o QR</p>
                  <p className="text-[11px] text-text-muted mt-1">{waQr.err}</p>
                  <button onClick={() => openWaQr(waQr.id, waQr.name)} className="btn-ghost text-xs mt-4">Tentar de novo</button>
                </div>
              ) : waQr.stalled ? (
                <div className="py-8">
                  <QrCode className="w-14 h-14 text-text-muted mx-auto mb-3" />
                  <p className="text-sm font-semibold text-text-primary">Ainda não conectou</p>
                  <p className="text-[11px] text-text-muted mt-1">O QR expirou. Confirme que liberou um aparelho no WhatsApp e gere um novo.</p>
                  <button onClick={() => openWaQr(waQr.id, waQr.name)} className="btn-cta text-xs mt-4">Gerar novo QR</button>
                </div>
              ) : (
                <>
                  <div className="bg-white rounded-xl p-3 inline-block mx-auto min-h-[232px] min-w-[232px] flex items-center justify-center">
                    {waQr.loading || !waQr.qr ? (
                      <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={waQr.qr} alt="QR WhatsApp" width={208} height={208} className="w-52 h-52" />
                    )}
                  </div>
                  <div className="mt-4 text-left text-xs text-text-secondary space-y-1">
                    <p className="font-semibold text-text-primary text-center mb-2">📲 Escaneie com o WhatsApp</p>
                    <p>1. Abra o WhatsApp no celular do número</p>
                    <p>2. <b>⋮ → Aparelhos conectados → Conectar um aparelho</b></p>
                    <p>3. Aponte a câmera para o QR acima</p>
                  </div>
                  <div className="mt-3 flex items-center justify-center gap-2 text-[11px] text-text-muted">
                    <Loader2 className="w-3 h-3 animate-spin" /> Aguardando leitura… (o QR se renova sozinho)
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-3">Contas Sociais</p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          {[
            { platform: 'FACEBOOK', label: 'Facebook', icon: '📘', color: 'from-blue-500/10 to-blue-600/10', textColor: 'text-blue-600' },
            { platform: 'LINKEDIN', label: 'LinkedIn', icon: '💼', color: 'from-sky-500/10 to-sky-600/10', textColor: 'text-sky-600' },
            { platform: 'X', label: 'X / Twitter', icon: '𝕏', color: 'from-gray-500/10 to-gray-600/10', textColor: 'text-gray-600' },
          ].map(({ platform, label, icon, color, textColor }) => {
            const platformAccounts = socialAccounts.filter((a) => a.platform === platform);
            return (
              <div key={platform} className="card p-4">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-lg">{icon}</span>
                  <h4 className={`text-sm font-bold ${textColor}`}>{label}</h4>
                  {platformAccounts.length > 0 && (
                    <span className="badge badge-completed text-[10px]">Conectado</span>
                  )}
                </div>
                {platform === 'LINKEDIN' && (
                  <button onClick={handleConnectLinkedIn} className="btn-cta text-xs w-full mb-2">Conectar via OAuth</button>
                )}
                {platform === 'X' && (
                  <button onClick={handleConnectX} className="btn-cta text-xs w-full mb-2">Conectar via OAuth</button>
                )}
                {platform === 'FACEBOOK' && (
                  <>
                    <button onClick={handleConnectFacebook} className="btn-cta text-xs w-full mb-1.5">Conectar (Login do Facebook)</button>
                    <button onClick={() => { setShowAddSocial(true); setSocialForm({ ...socialForm, platform: 'FACEBOOK' }); }} className="btn-ghost text-xs w-full mb-2">Adicionar Manualmente</button>
                  </>
                )}
                {platformAccounts.length === 0 && (
                  <p className="text-[10px] text-text-muted">Nenhuma conta conectada</p>
                )}
                {platformAccounts.map((acc) => (
                  <div key={acc.id} className="flex items-center gap-2 p-2 rounded-lg bg-bg-main mb-1.5">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-text-primary truncate">{acc.displayName || acc.username || acc.platformUserId}</p>
                      {acc.isDefault && <span className="text-[9px] text-primary font-bold">PADRAO</span>}
                    </div>
                    <div className="flex items-center gap-1">
                      {!acc.isDefault && (
                        <button onClick={() => handleSetDefaultSocial(acc.id)} className="text-[9px] text-primary hover:underline">Padrao</button>
                      )}
                      <button onClick={() => handleDeleteSocial(acc.id)} className="p-1 text-text-muted hover:text-red-500">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>

        {showAddSocial && (
          <div className="card p-5 mb-6">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-text-primary">Adicionar Conta Social</h3>
              <button onClick={() => setShowAddSocial(false)} className="btn-ghost text-xs">Cancelar</button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-text-muted mb-1">Plataforma</label>
                <select
                  value={socialForm.platform}
                  onChange={(e) => setSocialForm({ ...socialForm, platform: e.target.value })}
                  className="input-field text-xs"
                >
                  <option value="FACEBOOK">Facebook</option>
                  <option value="LINKEDIN">LinkedIn</option>
                  <option value="X">X / Twitter</option>
                  <option value="INSTAGRAM">Instagram</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-text-muted mb-1">Access Token</label>
                <input value={socialForm.accessToken} onChange={(e) => setSocialForm({ ...socialForm, accessToken: e.target.value })} className="input-field text-xs" placeholder="Token de acesso" type="password" />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-text-muted mb-1">Platform User ID</label>
                <input value={socialForm.platformUserId} onChange={(e) => setSocialForm({ ...socialForm, platformUserId: e.target.value })} className="input-field text-xs" placeholder="Page ID / Person URN / User ID" />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-text-muted mb-1">Username (opcional)</label>
                <input value={socialForm.username} onChange={(e) => setSocialForm({ ...socialForm, username: e.target.value })} className="input-field text-xs" placeholder="@username" />
              </div>
              {socialForm.platform === 'FACEBOOK' && (
                <div>
                  <label className="block text-[11px] font-semibold text-text-muted mb-1">Page ID</label>
                  <input value={socialForm.pageId} onChange={(e) => setSocialForm({ ...socialForm, pageId: e.target.value })} className="input-field text-xs" placeholder="Facebook Page ID" />
                </div>
              )}
            </div>
            <button onClick={handleAddSocialAccount} disabled={!socialForm.accessToken || !socialForm.platformUserId || socialAdding} className="btn-cta text-xs mt-3">
              {socialAdding ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Salvando...</> : 'Adicionar'}
            </button>
          </div>
        )}

        <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">Chaves de API</p>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {SERVICES.map((service) => {
          const Icon = service.icon;
          // Fields with a defaultValue (like the model selector) don't need to be saved to count as "connected"
          const allConnected = service.fields.every((f) => settings[f.key]?.hasValue || f.defaultValue);

          return (
            <div key={service.name} className="card p-5">
              <div className="flex items-start gap-4">
                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 ${service.iconBg}`}>
                  <Icon className={`w-6 h-6 ${service.iconColor}`} strokeWidth={1.5} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-sm font-bold text-text-primary">{service.name}</h3>
                    {allConnected ? (
                      <span className="badge badge-completed flex items-center gap-1">
                        <CheckCircle className="w-3 h-3" strokeWidth={2} />
                        Conectado
                      </span>
                    ) : (
                      <span className="badge badge-draft flex items-center gap-1">
                        <XCircle className="w-3 h-3" strokeWidth={2} />
                        Nao configurado
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-text-secondary mb-3">{service.description}</p>

                  <div className="space-y-3">
                    {service.fields.map((field) => {
                      const setting = settings[field.key];
                      const isEditing = editValues[field.key] !== undefined && editValues[field.key] !== '';

                      if (field.type === 'select') {
                        const currentValue = editValues[field.key] ?? setting?.value ?? field.defaultValue ?? '';
                        const selectedOption = field.options?.find((o) => o.value === currentValue);
                        return (
                          <div key={field.key}>
                            <label className="block text-[11px] font-semibold text-text-muted mb-1">{field.label}</label>
                            <div className="flex items-center gap-2">
                              <select
                                value={currentValue}
                                onChange={(e) => setEditValues((v) => ({ ...v, [field.key]: e.target.value }))}
                                className="input-field text-xs flex-1"
                              >
                                {field.options?.map((opt) => (
                                  <option key={opt.value} value={opt.value}>
                                    {opt.label}
                                  </option>
                                ))}
                              </select>
                              <button
                                onClick={() => handleSave(field.key)}
                                disabled={!isEditing || saving[field.key]}
                                className="flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-semibold transition-colors disabled:opacity-40 bg-primary/10 text-primary hover:bg-primary/20"
                              >
                                {saving[field.key] ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : saved[field.key] ? (
                                  <Check className="w-3.5 h-3.5" />
                                ) : (
                                  <Save className="w-3.5 h-3.5" />
                                )}
                              </button>
                            </div>
                            {selectedOption?.hint && (
                              <p className="text-[10px] text-text-muted mt-1">{selectedOption.hint}</p>
                            )}
                          </div>
                        );
                      }

                      return (
                        <div key={field.key}>
                          <label className="block text-[11px] font-semibold text-text-muted mb-1">{field.label}</label>
                          <div className="flex items-center gap-2">
                            <div className="relative flex-1">
                              <input
                                type={showValues[field.key] ? 'text' : 'password'}
                                value={editValues[field.key] ?? ''}
                                onChange={(e) => setEditValues((v) => ({ ...v, [field.key]: e.target.value }))}
                                className="input-field text-xs pr-8"
                                placeholder={setting?.hasValue ? setting.value : field.placeholder}
                                onKeyDown={(e) => e.key === 'Enter' && handleSave(field.key)}
                              />
                              <button
                                type="button"
                                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowValues((v) => ({ ...v, [field.key]: !v[field.key] })); }}
                                className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-text-muted hover:text-text-primary z-10 cursor-pointer"
                              >
                                {showValues[field.key] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                              </button>
                            </div>
                            <button
                              onClick={() => handleSave(field.key)}
                              disabled={!isEditing || saving[field.key]}
                              className="flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-semibold transition-colors disabled:opacity-40 bg-primary/10 text-primary hover:bg-primary/20"
                            >
                              {saving[field.key] ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : saved[field.key] ? (
                                <Check className="w-3.5 h-3.5" />
                              ) : (
                                <Save className="w-3.5 h-3.5" />
                              )}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        </div>
      </div>

      {/* Account */}
      <div className="space-y-4">
        <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">Conta</p>
        <div className="card p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-red-500/10 flex items-center justify-center">
                <LogOut className="w-5 h-5 text-status-failed" strokeWidth={1.5} />
              </div>
              <div>
                <p className="text-sm font-bold text-text-primary">Encerrar sessao</p>
                <p className="text-xs text-text-secondary">Sair da sua conta</p>
              </div>
            </div>
            <button
              onClick={logout}
              className="px-4 py-2 rounded-btn text-xs font-semibold bg-red-500/10 text-status-failed hover:bg-red-500/10 border border-red-500/20 transition-all"
            >
              Sair
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
