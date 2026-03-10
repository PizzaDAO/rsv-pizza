/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        theme: {
          bg: 'var(--bg-main)',
          card: 'var(--bg-card)',
          'card-hover': 'var(--bg-card-hover)',
          surface: 'var(--bg-surface)',
          'surface-hover': 'var(--bg-surface-hover)',
          input: 'var(--bg-input)',
          header: 'var(--bg-header)',
          text: 'var(--text-primary)',
          'text-secondary': 'var(--text-secondary)',
          'text-muted': 'var(--text-muted)',
          'text-faint': 'var(--text-faint)',
          stroke: 'var(--stroke)',
          'stroke-hover': 'var(--stroke-hover)',
          accent: 'var(--accent)',
          'accent-hover': 'var(--accent-hover)',
          success: 'var(--success)',
          warning: 'var(--warning)',
          error: 'var(--error)',
        },
      },
    },
  },
  plugins: [],
};
