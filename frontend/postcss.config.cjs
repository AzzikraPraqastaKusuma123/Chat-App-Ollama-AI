// frontend/postcss.config.cjs
module.exports = {
  plugins: {
    '@tailwindcss/postcss': {}, // <--- PERUBAHAN DI SINI: Gunakan '@tailwindcss/postcss'
    'autoprefixer': {},
  },
};