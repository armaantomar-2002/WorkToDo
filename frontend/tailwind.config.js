/** Colours come from CSS variables (src/index.css) so light and dark themes share one set of class names. */
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        page: v('page'), surface: v('surface'), 'surface-2': v('surface-2'), line: v('line'), ink: v('ink'), muted: v('muted'),
        primary: v('primary'), 'primary-fg': v('primary-fg'),
        terracotta: { DEFAULT: v('terracotta'), soft: v('terracotta-soft'), ink: v('terracotta-ink') },
        olive: { DEFAULT: v('olive'), soft: v('olive-soft'), ink: v('olive-ink') },
        dusty: { DEFAULT: v('dusty'), soft: v('dusty-soft'), ink: v('dusty-ink') },
        amber: { DEFAULT: v('amber'), soft: v('amber-soft'), ink: v('amber-ink') },
      },
      fontFamily: { serif: ['"Lora Variable"', 'Lora', 'Georgia', 'serif'], sans: ['"Inter Variable"', 'Inter', 'system-ui', 'sans-serif'] },
      borderRadius: { card: '14px' },
      boxShadow: { card: '0 1px 2px rgb(60 50 40 / 0.05)', pop: '0 10px 30px rgb(60 50 40 / 0.14)' },
    },
  },
  plugins: [],
};
