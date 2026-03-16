// @ts-check
import { defineConfig } from 'astro/config';

export default defineConfig({
  /* 1. Cambiamos a minúsculas para coincidir con el estándar de GitHub */
  site: 'https://czalbert6.github.io',

  /* 2. Base del repositorio intacta */
  base: '/extra-earth',

  /* 3. Genera sitio estático */
  output: 'static',

  /* 4. Forzamos el uso de barras diagonales al final. 
     Esto es CLAVE para que GitHub Pages encuentre carpetas internas. */
  trailingSlash: 'always',

  server: {
    port: 4321,
    host: true
  },

  build: {
    /* 5. Crea carpetas (ej: /modulos/principal-2-1/index.html). 
       Es la forma más compatible con los servidores de GitHub. */
    format: 'directory'
  },

  prefetch: {
    prefetchAll: true
  }
});