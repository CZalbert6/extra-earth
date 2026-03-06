// @ts-check
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  // URL de tu sitio en GitHub Pages
  site: 'https://CZalbert6.github.io',
  
  // Nombre exacto de tu repositorio para que las rutas funcionen
  base: '/extra-earth',
  
  // Fuerza a Astro a generar archivos estáticos para GitHub Pages
  output: 'static',
  
  server: {
    // Esto ayuda a que el servidor local sea más estable
    port: 4321,
    host: true
  }
});