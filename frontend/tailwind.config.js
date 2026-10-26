/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        medical: {
          50: '#EAF2FB',
          100: '#CFE1F6',
          200: '#A6C8EE',
          300: '#74A8E2',
          400: '#3F85D3',
          500: '#1E6BC0',
          600: '#1565C0',
          700: '#0F4E96',
          800: '#0C3D75',
          900: '#0A2F5A',
        },
        teal: {
          50: '#E4F5F2',
          100: '#BEEDE7',
          200: '#8FDCD2',
          300: '#5AC8BB',
          400: '#2EB4A5',
          500: '#009688',
          600: '#00897B',
          700: '#00786C',
          800: '#005F56',
          900: '#004740',
        },
        ink: {
          900: '#0F172A',
          800: '#1E293B',
          700: '#334155',
          600: '#475569',
          500: '#64748B',
          400: '#94A3B8',
          300: '#CBD5E1',
          200: '#E2E8F0',
          100: '#F1F5F9',
          50: '#F8FAFC',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(15, 23, 42, 0.04), 0 8px 24px -12px rgba(15, 23, 42, 0.18)',
        lift: '0 12px 32px -12px rgba(15, 23, 42, 0.28)',
        focus: '0 0 0 3px rgba(21, 101, 192, 0.25)',
      },
      borderRadius: {
        xl2: '1rem',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: 0, transform: 'translateY(4px)' },
          to: { opacity: 1, transform: 'translateY(0)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 180ms ease-out',
        shimmer: 'shimmer 1.6s infinite',
      },
    },
  },
  plugins: [],
}
