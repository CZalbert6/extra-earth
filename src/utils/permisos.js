export function verificarPermisosModulo(nombreModulo) {
  try {
    // 1. Obtenemos tanto los permisos como al usuario actual
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    const permisos = JSON.parse(localStorage.getItem('permisos') || '[]');

    // 2. MODO ADMINISTRADOR (God Mode)
    // Revisamos las formas comunes en las que tu DB podría identificar al admin
    const isAdmin = user.esAdmin === true || user.bitadministrador === true || user.bitadministrador === 1 || user.idperfil === 1;

    if (isAdmin) {
      return {
        tieneAcceso: true,
        permisos: {
          agregar: true,
          editar: true,
          consulta: true,
          eliminar: true,
          detalle: true
        }
      };
    }

    // 3. USUARIOS NORMALES: Búsqueda a prueba de errores de dedo
    // Usamos toLowerCase() y trim() para que "Usuario" y "usuario " coincidan perfectamente
    const modulo = permisos.find(p => 
      (p.strnombremodulo || "").toLowerCase().trim() === (nombreModulo || "").toLowerCase().trim()
    );
    
    // Si no está en su lista de permisos, lo bloqueamos
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

    // Si sí tiene permisos asignados, le damos los que le tocan
    return {
      // Tiene acceso a la pantalla si al menos tiene permiso para consultar
      tieneAcceso: true, 
      permisos: {
        agregar: !!modulo.bitagregar,
        editar: !!modulo.biteditar,
        consulta: !!modulo.bitconsulta,
        eliminar: !!modulo.biteliminar,
        detalle: !!modulo.bitdetalle
      }
    };

  } catch (error) {
    console.error("Error validando permisos:", error);
    // Si algo falla catastróficamente, bloqueamos por seguridad
    return {
      tieneAcceso: false,
      permisos: { agregar: false, editar: false, consulta: false, eliminar: false, detalle: false }
    };
  }
}

export function redirectSinPermiso() {
  window.location.href = '/extra-earth/error?code=403&message=No%20tienes%20permiso%20para%20acceder%20a%20este%20módulo';
}