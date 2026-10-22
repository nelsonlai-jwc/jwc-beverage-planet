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

## Database

Schema, row-level security and the invite sign-up hook live in `supabase/migrations/` (one file per module: identity, materials, recipes, menus/calibration/cost/audit). File names match the versions applied to the Supabase project, so add new changes as new migration files rather than editing old ones.

- Permissions are enforced in the database (RLS). Status changes such as approve, publish and copy go through `SECURITY DEFINER` functions; direct API writes can only create and edit drafts.
- Accounts are created only from an invitation: an Admin calls `create_invitation(email, role, outlet_ids)`, sends the link `/en/invite/{token}` (English by default; the page has a language switch), and the `on_auth_user_created` trigger checks the token when the person signs up.
- Supabase Auth must have **Confirm email** turned off, because the invite link already proves the email address.
- `src/types/database.ts` is generated from the schema (Supabase `generate_typescript_types`); regenerate it after each migration.
