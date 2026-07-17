# Velmont POS

Punto de venta para el cuidado de calzado. Tablet Android + impresora térmica.

## Puesta en marcha

```bash
npm install
cp .env.example .env   # rellenar con los datos del proyecto Supabase
npm run dev
```

La base de datos ya está aplicada en el proyecto Supabase `velmont-pos`. Para
recrearla en otro proyecto, correr en orden los archivos de `supabase/migrations/`
y luego `supabase/seed.sql`.

## Acceso inicial

`admin@velmont.mx` / `Velmont2026` — **cambiar antes de producción.**

## Uso desde la tablet

`npm run dev` levanta el server con `host: true`. Desde la tablet, entrar a
`http://IP-DE-LA-PC:5173`. Para producción, `npm run build` y servir `dist/` (o
desplegar en Vercel/Netlify). Al ser PWA, se puede "Agregar a la pantalla de
inicio" para que abra en pantalla completa como una app.

## Documentación técnica

Ver `CLAUDE.md` para arquitectura, reglas de diseño y pendientes.
