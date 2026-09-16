import cors from '@fastify/cors';
import Fastify from 'fastify';
import { config } from './config.js';
import { db } from './db/index.js';
import { registerRoutes } from './routes/index.js';
import { startScheduler } from './scheduler.js';

async function main(): Promise<void> {
  db(); // crée le fichier et applique le schéma au démarrage

  const app = Fastify({ logger: { level: 'info' } });
  // L'app mobile appelle le backend depuis l'appareil : pas d'origine fixe.
  await app.register(cors, { origin: true });
  await registerRoutes(app);

  await app.listen({ port: config.port, host: config.host });
  startScheduler();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
