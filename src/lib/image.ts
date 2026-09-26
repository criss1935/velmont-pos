/**
 * Reduce la imagen a un máximo de 1600px y la reencoda a JPEG ~0.8. Una foto de
 * cámara de tablet pasa de varios MB a unos cientos de KB sin pérdida visible en
 * un ticket ni en la galería del detalle.
 */
export async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) return file
  try {
    const bitmap = await createImageBitmap(file)
    const max = 1600
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height))
    const width = Math.round(bitmap.width * scale)
    const height = Math.round(bitmap.height * scale)

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(bitmap, 0, 0, width, height)
    bitmap.close()

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.8),
    )
    if (!blob) return file

    return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' })
  } catch {
    // Si el navegador no puede procesarla, se sube tal cual.
    return file
  }
}
