## ArenaBuddy

Electron + React + Tailwind + Vite + TypeScript + Electron starter scaffold.

### Getting Started
1. Install dependencies: `npm install`
2. Start development: `npm run dev`
	 - Electron main (ts-node) + Vite dev server + Tailwind watch
3. Build production: `npm run build`
4. Run built app: `npm start`

### Scripts
- `dev` - parallel main, renderer, tailwind
- `build` - tailwind (minified), Vite build, compile main process
- `start` - run Electron using built output
- `lint` - ESLint
- `typecheck` - TypeScript project refs

### Structure
```
src/
	main/        Electron main & preload (to dist/main)
	renderer/    React + Tailwind (to dist/renderer)
dist/          Build output
```

### Tailwind
`index.css` uses `@tailwind` directives; built CSS emitted as `output.css` and linked in `index.html`.

### Security Notes
- Preload isolates context; extend allowed APIs via `contextBridge`
- Add explicit IPC channels instead of exposing broad functionality
- Tighten CSP before production ship

### Roadmap Ideas
- Packaging (electron-builder/electron-forge)
- Auto updates (electron-updater)
- State management (Zustand/Redux) if needed
- End-to-end tests (Playwright)

---
Generated scaffold.
