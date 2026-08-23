// Runs before any test file's own module code (via Jest's `setupFiles`),
// which matters because src/config/config.js reads process.env once at
// require() time — setting these inside a test's beforeAll is too late,
// since `require('../src/app')` at the top of a test file already pulled
// in and froze the config by then.
process.env.NODE_ENV = 'test';
process.env.DB_CLIENT = 'sqlite3';
process.env.DB_FILE = ':memory:';
process.env.JWT_SECRET = 'test-secret';
process.env.SESSION_SECRET = 'test-session-secret';
// seeds/seeds_data.js randomizes the admin password by default (production
// safety); tests that log in as the seeded admin need it deterministic.
process.env.SEED_ADMIN_PASSWORD = 'admin123!';
