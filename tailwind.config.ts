import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink:     '#1f1b16',
        bg1:     '#f7efe3',
        bg2:     '#efe1c7',
        panel:   '#fff8ee',
        accent:  '#0f6b5f',
        accent2: '#e07a2f',
        muted:   '#6b5d4a',
        border:  '#e1cbb1',
      },
      fontFamily: {
        sans: ['"Space Grotesk"', '"IBM Plex Sans"', '"Segoe UI"', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
