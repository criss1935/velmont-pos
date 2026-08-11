import { next } from '@vercel/functions'

/**
 * Basic Auth delante de TODA la app, incluida /login.
 *
 * Es una capa extra sobre la sesión de Supabase, no un reemplazo: la sesión de
 * Supabase vive en localStorage del navegador, invisible para este middleware
 * (corre en el edge, solo ve la request), así que no puede validar "¿hay
 * sesión?" — el guard real contra eso ya está en <App /> (src/App.tsx), que no
 * renderiza ninguna pantalla sin `profile`. Lo que esta capa evita es que
 * alguien con la URL (que va a ser semi-pública aunque no esté enlazada desde
 * el sitio principal) pueda siquiera cargar el bundle o ver la pantalla de
 * login.
 *
 * Sin BASIC_AUTH_USER/BASIC_AUTH_PASS configuradas, no bloquea — para no
 * tumbar el panel si se despliega antes de setear las env vars en Vercel.
 */
export default function middleware(request: Request) {
  const expectedUser = process.env.BASIC_AUTH_USER
  const expectedPass = process.env.BASIC_AUTH_PASS

  if (!expectedUser || !expectedPass) {
    return next()
  }

  const header = request.headers.get('authorization')

  if (header?.startsWith('Basic ')) {
    const decoded = atob(header.slice(6))
    const separator = decoded.indexOf(':')
    const user = decoded.slice(0, separator)
    const pass = decoded.slice(separator + 1)

    if (user === expectedUser && pass === expectedPass) {
      return next()
    }
  }

  return new Response('Autenticación requerida.', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Velmont Admin", charset="UTF-8"' },
  })
}

export const config = {
  runtime: 'edge',
  // Todo menos los assets del manifest/PWA que el navegador pide sin credenciales
  // al instalar el ícono de la app — bloquearlos no protege nada (son estáticos
  // y públicos por diseño) y sí rompe la instalación como PWA en la tablet.
  matcher: ['/((?!manifest\\.webmanifest|brand/).*)'],
}
