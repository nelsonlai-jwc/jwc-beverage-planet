# JWC Beverage Planet

Beverage R&D and prep data platform. Next.js (App Router, TypeScript) + Supabase + Vercel; UI with React, three.js and GLSL. Languages: en, zh-CN (next-intl).

## Local setup

1. Node.js 20 or later.
2. `npm install`
3. `cp .env.example .env.local` and fill in the Supabase URL and anon key.
4. `npm run dev`, then open http://localhost:3000 (redirects to `/en` or `/zh-CN`).

## Layout

- `src/app/[locale]/` – pages, one route tree per language
- `src/i18n/` – next-intl routing and request config
- `messages/` – translation files (`en.json`, `zh-CN.json`)
- `src/lib/supabase/` – Supabase clients for browser and server
- `src/shaders/` – `.glsl` / `.vert` / `.frag` files, imported as strings
- `supabase/` – Supabase CLI config and SQL migrations
