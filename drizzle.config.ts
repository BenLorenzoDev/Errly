import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: 'src/server/db/schema.ts',
  out: 'drizzle',
  dbCredentials: {
    url: process.env.ERRLY_DB_PATH || './data/errly.db',
  },
});
