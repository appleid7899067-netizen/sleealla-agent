# Repo Prep — GM1122

Prepared for the next GitHub push/deploy pass.

## Target
- Repository: `appleid7899067-netizen/sleealla-agent`
- Branch: `GM1122`
- Project: QX / Sleealla Agent

## QX baseline
- Vite + Tailwind CSS frontend
- `npm run dev`
- `npm run dev:mock`
- `npm run build`
- `npm run preview`
- Source layout: `src/components`, `src/js`, `src/partials`, `src/api`

## Before production push
1. Fix native ESM `__dirname` usage in `vite.config.js`.
2. Add `terser` if `build.minify` remains `terser`.
3. Add `public/favicon.svg` or remove the favicon reference.
4. Replace mock API implementation with the real backend when ready.
5. Never commit real API keys; keep secrets out of `.env`.
6. Run `npm install` and `npm run build` before deployment.

## Existing server deployment note
The Express service must be deployed as a Render Web Service, not a Static Site. Use `npm install` as Build Command and `npm start` as Start Command. GitHub supports creating/updating repository files through its contents API when the token has repository Contents write permission. citeturn0search0turn0search1
