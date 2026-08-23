const request = require('supertest');
const { buildControlPlane } = require('../platform/control-plane/src');

describe('Platform control plane', () => {
  let runtime;

  beforeAll(async () => {
    runtime = await buildControlPlane({
      config: {
        jwtSecret: 'test-secret',
        bootstrapAdminEmail: 'owner@example.com',
        bootstrapAdminPassword: 'Passw0rd!',
        databaseFilename: ':memory:'
      }
    });
  });

  afterAll(async () => {
    if (runtime && runtime.close) {
      await runtime.close();
    }
  });

  test('logs in with bootstrap owner credentials', async () => {
    const response = await request(runtime.app)
      .post('/api/v1/auth/login')
      .send({
        email: 'owner@example.com',
        password: 'Passw0rd!'
      })
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.token).toBeDefined();
    expect(response.body.user.email).toBe('owner@example.com');
  });

  test('rejects invalid credentials', async () => {
    const response = await request(runtime.app)
      .post('/api/v1/auth/login')
      .send({
        email: 'owner@example.com',
        password: 'wrong-password'
      })
      .expect(401);

    expect(response.body.success).toBe(false);
  });

  test('returns current user profile for valid bearer token', async () => {
    const login = await request(runtime.app)
      .post('/api/v1/auth/login')
      .send({
        email: 'owner@example.com',
        password: 'Passw0rd!'
      });

    const response = await request(runtime.app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${login.body.token}`)
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.user.role).toBe('owner');
  });

  test('creates a server through the protected api', async () => {
    const login = await request(runtime.app)
      .post('/api/v1/auth/login')
      .send({
        email: 'owner@example.com',
        password: 'Passw0rd!'
      });

    const response = await request(runtime.app)
      .post('/api/v1/servers')
      .set('Authorization', `Bearer ${login.body.token}`)
      .send({
        name: 'prod-1',
        provider: 'self_hosted',
        hostname: 'prod-1.example.com',
        tags: ['production'],
        capabilities: ['node', 'nginx']
      })
      .expect(201);

    expect(response.body.success).toBe(true);
    expect(response.body.data.name).toBe('prod-1');
    expect(response.body.data.provider).toBe('self_hosted');
  });

  test('lists bootstrap and created servers', async () => {
    const login = await request(runtime.app)
      .post('/api/v1/auth/login')
      .send({
        email: 'owner@example.com',
        password: 'Passw0rd!'
      });

    const response = await request(runtime.app)
      .get('/api/v1/servers')
      .set('Authorization', `Bearer ${login.body.token}`)
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(Array.isArray(response.body.data)).toBe(true);
    expect(response.body.data.length).toBeGreaterThanOrEqual(1);
  });

  test('issues an enrollment token and registers an agent', async () => {
    const login = await request(runtime.app)
      .post('/api/v1/auth/login')
      .send({
        email: 'owner@example.com',
        password: 'Passw0rd!'
      });

    const servers = await request(runtime.app)
      .get('/api/v1/servers')
      .set('Authorization', `Bearer ${login.body.token}`);

    const enrollment = await request(runtime.app)
      .post(`/api/v1/servers/${servers.body.data[0].id}/enrollment-tokens`)
      .set('Authorization', `Bearer ${login.body.token}`)
      .expect(201);

    expect(enrollment.body.success).toBe(true);
    expect(enrollment.body.data.token).toBeDefined();

    const registration = await request(runtime.app)
      .post('/api/v1/agents/register')
      .send({
        enrollmentToken: enrollment.body.data.token,
        hostname: 'agent-1.example.com',
        version: '1.0.0',
        capabilities: ['metrics', 'deploy']
      })
      .expect(201);

    expect(registration.body.success).toBe(true);
    expect(registration.body.token).toBeDefined();
    expect(registration.body.agent.serverId).toBe(servers.body.data[0].id);
  });

  test('accepts agent heartbeat with agent bearer token', async () => {
    const login = await request(runtime.app)
      .post('/api/v1/auth/login')
      .send({
        email: 'owner@example.com',
        password: 'Passw0rd!'
      });

    const servers = await request(runtime.app)
      .get('/api/v1/servers')
      .set('Authorization', `Bearer ${login.body.token}`);

    const enrollment = await request(runtime.app)
      .post(`/api/v1/servers/${servers.body.data[0].id}/enrollment-tokens`)
      .set('Authorization', `Bearer ${login.body.token}`);

    const registration = await request(runtime.app)
      .post('/api/v1/agents/register')
      .send({
        enrollmentToken: enrollment.body.data.token,
        hostname: 'agent-heartbeat.example.com',
        version: '1.0.1',
        capabilities: ['metrics']
      });

    const heartbeat = await request(runtime.app)
      .post('/api/v1/agents/heartbeat')
      .set('Authorization', `Bearer ${registration.body.token}`)
      .send({
        version: '1.0.2',
        capabilities: ['metrics', 'deploy']
      })
      .expect(200);

    expect(heartbeat.body.success).toBe(true);
    expect(heartbeat.body.data.version).toBe('1.0.2');
  });

  test('creates and fetches a job through protected apis', async () => {
    const login = await request(runtime.app)
      .post('/api/v1/auth/login')
      .send({
        email: 'owner@example.com',
        password: 'Passw0rd!'
      });

    const servers = await request(runtime.app)
      .get('/api/v1/servers')
      .set('Authorization', `Bearer ${login.body.token}`);

    const created = await request(runtime.app)
      .post('/api/v1/jobs')
      .set('Authorization', `Bearer ${login.body.token}`)
      .send({
        type: 'app.deploy',
        resourceType: 'server',
        resourceId: servers.body.data[0].id,
        targetServerId: servers.body.data[0].id,
        input: {
          release: '2026.05.22'
        }
      })
      .expect(201);

    expect(created.body.success).toBe(true);
    expect(created.body.data.type).toBe('app.deploy');

    const fetched = await request(runtime.app)
      .get(`/api/v1/jobs/${created.body.data.id}`)
      .set('Authorization', `Bearer ${login.body.token}`)
      .expect(200);

    expect(fetched.body.success).toBe(true);
    expect(fetched.body.data.id).toBe(created.body.data.id);
  });

  test('creates and lists apps, databases, certificates, and backups', async () => {
    const login = await request(runtime.app)
      .post('/api/v1/auth/login')
      .send({
        email: 'owner@example.com',
        password: 'Passw0rd!'
      });

    const servers = await request(runtime.app)
      .get('/api/v1/servers')
      .set('Authorization', `Bearer ${login.body.token}`);

    const serverId = servers.body.data[0].id;

    const createdApp = await request(runtime.app)
      .post('/api/v1/apps')
      .set('Authorization', `Bearer ${login.body.token}`)
      .send({
        name: 'my-app',
        serverId,
        runtime: 'node',
        sourceType: 'git',
        domains: ['my-app.example.com'],
        deployRoot: '/var/www/my-app'
      })
      .expect(201);

    expect(createdApp.body.success).toBe(true);
    expect(createdApp.body.data.name).toBe('my-app');

    const createdDatabase = await request(runtime.app)
      .post('/api/v1/databases')
      .set('Authorization', `Bearer ${login.body.token}`)
      .send({
        serverId,
        name: 'appdb',
        engine: 'postgres'
      })
      .expect(201);

    expect(createdDatabase.body.success).toBe(true);
    expect(createdDatabase.body.data.name).toBe('appdb');

    const createdCertificate = await request(runtime.app)
      .post('/api/v1/certificates')
      .set('Authorization', `Bearer ${login.body.token}`)
      .send({
        serverId,
        domains: ['my-app.example.com'],
        provider: 'letsencrypt'
      })
      .expect(201);

    expect(createdCertificate.body.success).toBe(true);
    expect(createdCertificate.body.data.provider).toBe('letsencrypt');

    const createdBackup = await request(runtime.app)
      .post('/api/v1/backups')
      .set('Authorization', `Bearer ${login.body.token}`)
      .send({
        serverId,
        targetResourceType: 'app',
        targetResourceId: createdApp.body.data.id,
        storageProvider: 'local'
      })
      .expect(201);

    expect(createdBackup.body.success).toBe(true);
    expect(createdBackup.body.data.targetResourceType).toBe('app');

    const apps = await request(runtime.app)
      .get('/api/v1/apps')
      .set('Authorization', `Bearer ${login.body.token}`)
      .expect(200);

    const databases = await request(runtime.app)
      .get('/api/v1/databases')
      .set('Authorization', `Bearer ${login.body.token}`)
      .expect(200);

    const certificates = await request(runtime.app)
      .get('/api/v1/certificates')
      .set('Authorization', `Bearer ${login.body.token}`)
      .expect(200);

    const backups = await request(runtime.app)
      .get('/api/v1/backups')
      .set('Authorization', `Bearer ${login.body.token}`)
      .expect(200);

    expect(apps.body.data.some((item) => item.id === createdApp.body.data.id)).toBe(true);
    expect(databases.body.data.some((item) => item.id === createdDatabase.body.data.id)).toBe(true);
    expect(certificates.body.data.some((item) => item.id === createdCertificate.body.data.id)).toBe(true);
    expect(backups.body.data.some((item) => item.id === createdBackup.body.data.id)).toBe(true);
  });
});
