const http = require('http');
const { getControlPlaneConfig } = require('./config');
const { createDatabaseClient } = require('./persistence/db');
const { createMemoryStore } = require('./store/memory-store');
const { createPersistentStore } = require('./store/persistent-store');
const { createControlPlaneApp } = require('./http/app');

async function buildControlPlane(options = {}) {
  const config = getControlPlaneConfig(options.config);
  let store = options.store;
  let knex = options.knex || null;

  if (!store) {
    if (options.useMemoryStore) {
      store = await createMemoryStore(config);
    } else {
      knex = knex || createDatabaseClient(config);
      store = await createPersistentStore({ knex, config });
    }
  }

  const app = createControlPlaneApp({ config, store });
  const server = http.createServer(app);

  return {
    app,
    config,
    close: async () => {
      if (store && typeof store.close === 'function') {
        await store.close();
      } else if (knex) {
        await knex.destroy();
      }
    },
    server,
    store
  };
}

async function startControlPlane(options = {}) {
  const runtime = await buildControlPlane(options);

  await new Promise((resolve) => {
    runtime.server.listen(runtime.config.port, resolve);
  });

  return runtime;
}

module.exports = {
  buildControlPlane,
  startControlPlane
};
