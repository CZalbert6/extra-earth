// utils/permisos.js
export function verificarPermisosModulo(nombreModulo) {
  const permisos = JSON.parse(localStorage.getItem('permisos') || '[]');
  const modulo = permisos.find(p => p.strnombremodulo === nombreModulo);
  
  if (!modulo) {
    return {
      tieneAcceso: false,
      permisos: {
        agregar: false,
        editar: false,
        consulta: false,
        eliminar: false,
        detalle: false
      }
    };
  }

  return {
    tieneAcceso: true,
    permisos: {
      agregar: modulo.bitagregar || false,
      editar: modulo.biteditar || false,
      consulta: modulo.bitconsulta || false,
      eliminar: modulo.biteliminar || false,
      detalle: modulo.bitdetalle || false
    }
  };
}

export function redirectSinPermiso() {
  window.location.href = '/extra-earth/error?code=403&message=No%20tienes%20permiso%20para%20acceder%20a%20este%20módulo';
}