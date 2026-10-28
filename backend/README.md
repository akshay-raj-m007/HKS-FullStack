# Loop API

Install from the repository root: `npm install && npm run setup && npm run migrate && npm run seed`.

From this directory: `npm run dev`, `npm test`, `npm run typecheck`, `npm run build`, `npm start`.

The API binds to 127.0.0.1:4000. OTPs are printed only by the development console adapter. See [root README](../README.md) for environment variables, routes, security, payment setup and operational limitations.

Prisma 6 is pinned to preserve the schema-based SQLite configuration. Patched transitive tooling dependencies are declared in the root package overrides and validated with migration/build checks. Tests use their own database and generate fresh session secrets.

To create a schema migration during development: `npx prisma migrate dev --name descriptive_change`. Review generated SQL and preserve the interval/state triggers.
