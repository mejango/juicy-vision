/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    screens: {
      'xs': '480px',
      'sm': '640px',
      'md': '768px',
      'lg': '1024px',
      'xl': '1280px',
      '2xl': '1536px',
    },
    extend: {
      colors: {
        'juice-orange': '#F5A623',
        'juice-cyan': '#5CEBDF',
        'juice-dark': '#1a1a1a',
        'juice-dark-lighter': '#2a2a2a',
        'juice-light': '#f5f5f5',
        'juice-light-darker': '#e5e5e5',
        // Chart colors
        'chart': {
          'primary': '#F5A623',     // juice-orange
          'secondary': '#5CEBDF',   // juice-cyan
          'tertiary': '#10b981',    // emerald
          'quaternary': '#f59e0b',  // amber
          'axis': '#666666',        // axis labels
          'grid': '#999999',        // grid lines
        },
        // Chain colors (reserved for identification)
        'chain': {
          'ethereum': '#627EEA',
          'optimism': '#FF0420',
          'base': '#0052FF',
          'arbitrum': '#28A0F0',
        },
      },
      fontFamily: {
        sans: ['JetBrains Mono', 'Menlo', 'monospace'],
        mono: ['JetBrains Mono', 'Menlo', 'monospace'],
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'bounce-subtle': 'bounce-subtle 2s ease-in-out infinite',
        'fade-in': 'fade-in 0.3s ease-out forwards',
      },
      keyframes: {
        'bounce-subtle': {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-5px)' },
        },
        'fade-in': {
          '0%': { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        }
      }
    },
  },
  plugins: [],
}
