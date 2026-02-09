/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './ui/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        'juice-cyan': '#5CEBDF',
        'juice-orange': '#F5A623',
        'juice-dark': '#1a1a1a',
        'juice-dark-lighter': '#2a2a2a',
      },
    },
  },
  plugins: [],
}
