/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        'juice-orange': '#F5A623',
        'juice-cyan': '#5CEBDF',
        'juice-dark': '#1a1a1a',
        'juice-dark-lighter': '#2a2a2a',
        'juice-light': '#f5f5f5',
        'juice-light-darker': '#e5e5e5',
      },
      fontFamily: {
        sans: ['JetBrains Mono', 'Menlo', 'monospace'],
        mono: ['JetBrains Mono', 'Menlo', 'monospace'],
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'bounce-subtle': 'bounce-subtle 2s ease-in-out infinite',
      },
      keyframes: {
        'bounce-subtle': {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-5px)' },
        }
      }
    },
  },
  plugins: [],
}
