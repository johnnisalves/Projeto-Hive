import './globals.css';
import { LayoutContent } from '../components/LayoutContent';
import { AuthProvider } from '../components/AuthProvider';
import { ThemeProvider } from '../components/ThemeProvider';
import { ConfirmProvider } from '../components/ConfirmModal';
import { BrandProvider } from '../components/BrandProvider';

export const metadata = {
  title: 'DisparaAI - Plataforma de Conteudo com IA',
  description: 'DisparaAI - Crie, agende e publique conteudo com inteligencia artificial.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('theme')||'dark';document.documentElement.classList.toggle('dark',t==='dark')}catch(e){}})()`,
          }}
        />
      </head>
      <body className="bg-bg-main text-text-primary min-h-screen">
        <ThemeProvider>
          <ConfirmProvider>
            <AuthProvider>
              {/* Dentro do AuthProvider: a lista de empresas so pode ser
                  buscada depois que existe sessao. */}
              <BrandProvider>
                <LayoutContent>{children}</LayoutContent>
              </BrandProvider>
            </AuthProvider>
          </ConfirmProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
