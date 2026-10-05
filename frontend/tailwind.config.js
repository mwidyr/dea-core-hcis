/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      // Design tokens taken from the CORE prototype (V113)
      colors: {
        brand: { DEFAULT: '#d84a4a', soft: '#fff0f0' },
        ok: { DEFAULT: '#2e9d65', soft: '#edf8f2' },
        warn: { DEFAULT: '#c68a2a', soft: '#fff7e8' },
        info: { DEFAULT: '#4f7fc6', soft: '#eef4ff' },
        violet: { DEFAULT: '#7a68b6', soft: '#f3f0ff' },
        line: '#e7e8eb',
        muted: '#7c8189',
        surface: '#f6f7f9',
      },
      fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] },
      boxShadow: { card: '0 7px 22px rgba(29,33,40,.05)' },
    },
  },
  plugins: [],
}
