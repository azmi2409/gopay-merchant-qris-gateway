import { createAdminApp } from './app';

try {
  process.loadEnvFile();
} catch {
  // Production deployments inject environment variables directly.
}

const required = ['ADMIN_PASSWORD', 'ADMIN_SESSION_SECRET', 'ADMIN_API_KEY'] as const;
for (const key of required) {
  if ((process.env[key] || '').length < (key === 'ADMIN_PASSWORD' ? 12 : 32)) {
    throw new Error(`${key} is required and too short`);
  }
}

const port = Number(process.env.ADMIN_PORT || 3100);
createAdminApp().listen(port, () => process.stdout.write(`Admin panel listening on ${port}\n`));
