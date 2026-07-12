import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Backgrounds — driven by CSS variables (auto dark mode)
        'bg-main': 'var(--bg-main)',
        'bg-card': 'var(--bg-card)',
        'bg-card-hover': 'var(--bg-card-hover)',

        // Primary (roxo) — DEFAULT via CSS var (white-label). Fallback = roxo original.
        // Canais RGB p/ suportar as variacoes de opacidade (bg-primary/10 etc).
        primary: {
          DEFAULT: 'rgb(var(--color-primary-rgb, 108 92 231) / <alpha-value>)',
          light: '#A29BFE',
          dark: '#5A4BD1',
        },

        // Accent
        'accent-pink': '#E84393',
        'accent-orange': '#FDCB6E',

        // Status
        'status-scheduled': '#0984E3',
        'status-published': '#00B894',
        'status-draft': 'var(--text-secondary)',
        'status-failed': '#D63031',

        // Text — driven by CSS variables
        'text-primary': 'var(--text-primary)',
        'text-secondary': 'var(--text-secondary)',
        'text-muted': 'var(--text-muted)',

        // Border — driven by CSS variable
        border: 'var(--border)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      boxShadow: {
        sm: '0 1px 3px var(--shadow-color, rgba(0,0,0,0.04)), 0 1px 2px var(--shadow-color, rgba(0,0,0,0.06))',
        md: '0 4px 12px var(--shadow-color, rgba(0,0,0,0.05)), 0 2px 4px var(--shadow-color, rgba(0,0,0,0.04))',
        lg: '0 10px 30px var(--shadow-color, rgba(0,0,0,0.08))',
        'cta': '0 4px 14px rgba(108, 92, 231, 0.3)',
        'cta-hover': '0 6px 20px rgba(108, 92, 231, 0.4)',
      },
      borderRadius: {
        'card': '16px',
        'btn': '12px',
        'badge': '6px',
        'thumb': '10px',
        'input': '10px',
      },
      fontSize: {
        'page-title': ['28px', { lineHeight: '1.2', fontWeight: '700' }],
        'section-title': ['18px', { lineHeight: '1.4', fontWeight: '700' }],
        'card-number': ['36px', { lineHeight: '1.1', fontWeight: '700' }],
        'card-label': ['13px', { lineHeight: '1.4', fontWeight: '600' }],
      },
      animation: {
        'fade-in': 'fadeIn 0.3s ease-out',
        'slide-up': 'slideUp 0.3s ease-out',
      },
      keyframes: {
        fadeIn: {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        slideUp: {
          from: { opacity: '0', transform: 'translateY(12px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
};

export default config;
