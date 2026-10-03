# Nota sobre el prompt de shadcn / Calendar

El proyecto AutoSale actual es una aplicación estática con HTML, CSS y JavaScript. No usa React, TypeScript, Tailwind ni la estructura de shadcn, por lo que copiar directamente `calendar.tsx` a `/components/ui` haría que el proyecto actual no funcione.

En V2.6 se aplicó el lenguaje visual del componente (tarjetas, bordes, estados hover/focus y controles de fecha/hora más claros) usando la arquitectura existente.

Si más adelante se decide migrar todo el sistema a React/TypeScript/shadcn, una ruta razonable es:

```bash
npm create vite@latest autosale-crm -- --template react-ts
cd autosale-crm
npm install
npx shadcn@latest init
npx shadcn@latest add button
npm install @radix-ui/react-slot class-variance-authority
```

La carpeta estándar recomendada por shadcn es `/components/ui`. Mantener los componentes UI en esa ruta permite que los imports del tipo `@/components/ui/button` y `@/components/ui/calendar` funcionen de forma consistente.

Después se puede migrar el calendario y el resto de los componentes pantalla por pantalla, sin mezclar dos arquitecturas dentro de la versión de producción actual.
