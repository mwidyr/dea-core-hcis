/** @type {import('tailwindcss').Config} */

// Every colour is a CSS variable holding an "R G B" triplet (see src/index.css), so one set of
// class names serves both themes and Tailwind's opacity utilities (bg-brand/20 …) keep working.
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      // Design tokens from the CORE prototype (V113), final "CORE navy" theme
      colors: {
        'on-brand': v('on-brand'), // text/icons on a brand-coloured fill
        brand: { DEFAULT: v('brand'), hover: v('brand-hover'), soft: v('brand-soft') }, // actions, active states
        danger: { DEFAULT: v('danger'), soft: v('danger-soft') }, // errors, delete, overdue, rejected
        ok: { DEFAULT: v('ok'), soft: v('ok-soft') },
        warn: { DEFAULT: v('warn'), soft: v('warn-soft') },
        info: { DEFAULT: v('info'), soft: v('info-soft') },
        violet: { DEFAULT: v('violet'), soft: v('violet-soft') },
        line: v('line'),
        muted: v('muted'),
        ink: v('ink'), // body text
        surface: v('surface'), // page background
        panel: v('panel'), // cards, modals, inputs
        sunken: v('sunken'), // table headers, hover rows
        tint: v('tint'), // chips, disabled fields
      },
      fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] },
      boxShadow: { card: '0 8px 26px rgb(var(--shadow) / .06)' },
    },
  },
  plugins: [],
}
