// @ts-check
import { defineConfig } from 'astro/config';

export default defineConfig({

  /* URL de tu sitio en GitHub Pages */
  site: 'https://CZalbert6.github.io',

  /* Nombre EXACTO del repositorio */
  base: '/extra-earth',

  /* Genera sitio estático para GitHub Pages */
  output: 'static',

  /* Configuración del servidor de desarrollo */
  server: {
    port: 4321,
    host: true
  },

  /* Build */
  build: {
    format: 'directory'
  },

  /* Prefetch opcional (mejora navegación) */
  prefetch: {
    prefetchAll: true
  }

});