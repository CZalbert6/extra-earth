// @ts-check
import { defineConfig } from 'astro/config';

export default defineConfig({
  // URL de tu sitio en GitHub Pages
  site: 'https://CZalbert6.github.io',
  
  // Nombre exacto de tu repositorio para que las rutas funcionen
  base: '/extra-earth',
  
  // Fuerza a Astro a generar archivos estáticos
  output: 'static',
  
  server: {
    port: 4321,
    host: true
  }
});