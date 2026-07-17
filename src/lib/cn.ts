/**
 * Une clases condicionalmente, descartando lo falsy.
 *
 * Acepta `unknown` en vez de `string | false | null` porque el patrón habitual
 * (`prefix && styles.hasPrefix`) puede producir un `0` cuando `prefix` es un
 * ReactNode numérico — y `0` es falsy, así que debe descartarse igual que
 * `false`, no provocar un error de tipos.
 */
export function cn(...parts: unknown[]): string {
  return parts.filter((part): part is string => typeof part === 'string' && part !== '').join(' ')
}
