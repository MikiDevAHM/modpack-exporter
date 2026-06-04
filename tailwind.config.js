/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/**/*.{tsx,ts,jsx,js,html}'],
  theme: {
    extend: {
      fontFamily: { sans: ['Inter', 'ui-sans-serif', 'system-ui'] },
    },
  },
  plugins: [],
};
