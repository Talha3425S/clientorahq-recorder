import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'   // add this line

// https://vite.dev/config/
export default defineConfig({

  plugins: [react(), tailwindcss()],          // add tailwindcss() here

})
