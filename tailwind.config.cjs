/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './src/renderer/**/*.{html,tsx,ts,jsx,js}',
    './src/renderer/index.html'
  ],
  theme: {
    extend: {
      colors: {
        highlight: {
          DEFAULT: '#7e3af2' // purple-600-ish
        }
      }
    },
  },
  plugins: [],
};
