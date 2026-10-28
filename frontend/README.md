# Loop web application

React, TypeScript, Vite, React Router, TanStack Query, React Hook Form and Zod.

Install from the repository root. From this directory: `npm run dev`, `npm test`, `npm run typecheck`, `npm run build`.

The development server proxies /api to localhost:4000. Open http://localhost:5173 so the configured origin matches. Use the API terminal for development OTPs.

Access tokens exist only in memory; HttpOnly refresh cookies restore the session. All timestamps display in the configured application timezone (Asia/Kolkata by default). The backend remains the authority for price, availability, ownership and payment state.

See [root README](../README.md) for the complete setup and payment sandbox flow.
