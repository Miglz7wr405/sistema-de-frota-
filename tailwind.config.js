/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './track.html', './driver.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: { DEFAULT: '#1769E8', soft: '#E8F0FD' },
        navy: '#10243D',
        background: '#F5F7FA',
        surface: '#FFFFFF',
        muted: '#64748B',
        border: '#E2E8F0',
        success: { DEFAULT: '#16A36A', text: '#0F7A4F', soft: '#E7F6EF' },
        warning: { DEFAULT: '#B45309', soft: '#FEF3C7' },
        danger: { DEFAULT: '#C62828', soft: '#FDECEC' },
      },
      borderRadius: { card: '14px' },
      fontFamily: { sans: ['Inter', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'] },
    },
  },
  plugins: [],
};
