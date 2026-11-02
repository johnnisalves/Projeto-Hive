import Link from 'next/link';

export function PaginaLegal({ titulo, atualizado, children }: { titulo: string; atualizado: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-6 py-12">
        <p className="text-sm font-semibold tracking-wide text-primary">DisparaAI</p>
        <h1 className="mt-2 text-3xl font-bold">{titulo}</h1>
        <p className="mt-1 text-sm opacity-60">Última atualização: {atualizado}</p>
        <div className="mt-8 space-y-6 leading-relaxed [&_h2]:mt-8 [&_h2]:text-xl [&_h2]:font-semibold [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-6">
          {children}
        </div>
        <div className="mt-12 flex gap-6 border-t border-white/10 pt-6 text-sm opacity-70">
          <Link href="/termos" className="hover:underline">Termos de Serviço</Link>
          <Link href="/privacidade" className="hover:underline">Política de Privacidade</Link>
        </div>
      </div>
    </div>
  );
}
