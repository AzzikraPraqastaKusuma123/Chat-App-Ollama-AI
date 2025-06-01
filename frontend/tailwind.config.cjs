// frontend/tailwind.config.cjs
const defaultTheme = require('tailwindcss/defaultTheme');

module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter var', ...defaultTheme.fontFamily.sans],
      },
      boxShadow: {
        'top': '0 -4px 6px -1px rgba(0, 0, 0, 0.08), 0 -2px 4px -2px rgba(0, 0, 0, 0.05)',
      }
    },
  },
  plugins: [],
};

