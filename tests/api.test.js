const request = require('supertest');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const ServerPanelApp = require('../src/app');
const database = require('../src/config/database');

describe('ServerPanel Pro API Tests', () => {
  let app;
  let server;
  let adminToken;
  let userToken;
  let testUser;

  beforeAll(async () => {
    // Set test environment
    process.env.NODE_ENV = 'test';
    process.env.DB_CLIENT = 'sqlite3';
    process.env.DB_FILE = ':memory:';
    
    // Create app instance
    const appInstance = new ServerPanelApp();
    app = appInstance.app;
    
    // Run migrations
    await database.migrate.latest();
    
    // Create test users
    const adminPassword = await bcrypt.hash('testadmin123!', 12);
    const userPassword = await bcrypt.hash('testuser123!', 12);
    
    const [adminId] = await database('users').insert({
      username: 'testadmin',
      email: 'admin@test.com',
      password_hash: adminPassword,
      role: 'admin',
      permissions: JSON.stringify([
        'system:read', 'system:write', 'system:execute',
        'files:read', 'files:write', 'files:delete',
        'users:read', 'users:write', 'users:delete',
        'services:read', 'services:write'
      ]),
      is_active: true
    });
    
    const [userId] = await database('users').insert({
      username: 'testuser',
      email: 'user@test.com',
      password_hash: userPassword,
      role: 'user',
      permissions: JSON.stringify(['files:read', 'monitoring:read']),
      is_active: true
    });
    
    // Generate tokens
    adminToken = jwt.sign(
      { id: adminId, username: 'testadmin', role: 'admin' },
      process.env.JWT_SECRET || 'test-secret',
      { expiresIn: '1h' }
    );
    
    userToken = jwt.sign(
      { id: userId, username: 'testuser', role: 'user' },
      process.env.JWT_SECRET || 'test-secret',
      { expiresIn: '1h' }
    );
    
    testUser = { id: userId, username: 'testuser', role: 'user' };
  });

  afterAll(async () => {
    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
    await database.destroy();
  });

  describe('Health Check', () => {
    test('GET /health should return OK', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);
        
      expect(response.body.status).toBe('OK');
      expect(response.body.timestamp).toBeDefined();
      expect(response.body.uptime).toBeDefined();
    });
  });

  describe('Authentication', () => {
    describe('POST /api/auth/login', () => {
      test('should login with valid credentials', async () => {
    describe('DELETE /api/system/processes/:pid', () => {
      test('should validate PID parameter', async () => {
        const response = await request(app)
          .delete('/api/system/processes/invalid')
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(400);
          
        expect(response.body.success).toBe(false);
        expect(response.body.errors).toBeDefined();
      });

      test('should require admin role for process termination', async () => {
        const response = await request(app)
          .delete('/api/system/processes/1234')
          .set('Authorization', `Bearer ${userToken}`)
          .expect(403);
          
        expect(response.body.success).toBe(false);
      });

      test('should prevent killing critical processes', async () => {
        const response = await request(app)
          .delete('/api/system/processes/1') // PID 1 is init
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(403);
          
        expect(response.body.success).toBe(false);
        expect(response.body.message).toContain('critical');
      });
    });

    describe('GET /api/system/services', () => {
      test('should return services list', async () => {
        const response = await request(app)
          .get('/api/system/services')
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(200);
          
        expect(response.body.success).toBe(true);
        expect(response.body.data).toBeInstanceOf(Array);
      });
    });

    describe('POST /api/system/services/:name/:action', () => {
      test('should validate service action', async () => {
        const response = await request(app)
          .post('/api/system/services/testservice/invalidaction')
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(400);
          
        expect(response.body.success).toBe(false);
        expect(response.body.errors).toBeDefined();
      });

      test('should validate service name', async () => {
        const response = await request(app)
          .post('/api/system/services//start')
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(400);
          
        expect(response.body.success).toBe(false);
      });
    });

    describe('POST /api/system/execute', () => {
      test('should require admin role', async () => {
        const response = await request(app)
          .post('/api/system/execute')
          .set('Authorization', `Bearer ${userToken}`)
          .send({ command: 'echo test' })
          .expect(403);
          
        expect(response.body.success).toBe(false);
      });

      test('should validate command input', async () => {
        const response = await request(app)
          .post('/api/system/execute')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({}) // No command
          .expect(400);
          
        expect(response.body.success).toBe(false);
        expect(response.body.errors).toBeDefined();
      });

      test('should block dangerous commands', async () => {
        const response = await request(app)
          .post('/api/system/execute')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ command: 'rm -rf /' })
          .expect(403);
          
        expect(response.body.success).toBe(false);
        expect(response.body.message).toContain('dangerous');
      });

      test('should execute safe commands', async () => {
        const response = await request(app)
          .post('/api/system/execute')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ command: 'echo "test"' })
          .expect(200);
          
        expect(response.body.success).toBe(true);
        expect(response.body.data.stdout).toContain('test');
      });
    });
  });

  describe('File Management', () => {
    describe('GET /api/files/browse', () => {
      test('should browse root directory', async () => {
        const response = await request(app)
          .get('/api/files/browse')
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(200);
          
        expect(response.body.success).toBe(true);
        expect(response.body.data.currentPath).toBeDefined();
        expect(response.body.data.items).toBeInstanceOf(Array);
      });

      test('should validate path parameter', async () => {
        const response = await request(app)
          .get('/api/files/browse?path=../../../etc/passwd')
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(403);
          
        expect(response.body.success).toBe(false);
        expect(response.body.message).toContain('Access denied');
      });

      test('should handle showHidden parameter', async () => {
        const response = await request(app)
          .get('/api/files/browse?showHidden=true')
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(200);
          
        expect(response.body.success).toBe(true);
      });
    });

    describe('GET /api/files/read', () => {
      test('should require file path', async () => {
        const response = await request(app)
          .get('/api/files/read')
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(400);
          
        expect(response.body.success).toBe(false);
        expect(response.body.errors).toBeDefined();
      });

      test('should validate file path', async () => {
        const response = await request(app)
          .get('/api/files/read?path=/etc/passwd')
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(403);
          
        expect(response.body.success).toBe(false);
      });
    });

    describe('POST /api/files/write', () => {
      test('should validate input data', async () => {
        const response = await request(app)
          .post('/api/files/write')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({}) // Missing required fields
          .expect(400);
          
        expect(response.body.success).toBe(false);
        expect(response.body.errors).toBeDefined();
      });

      test('should require write permission', async () => {
        const response = await request(app)
          .post('/api/files/write')
          .set('Authorization', `Bearer ${userToken}`)
          .send({
            path: '/tmp/test.txt',
            content: 'test content'
          })
          .expect(403);
          
        expect(response.body.success).toBe(false);
      });
    });

    describe('POST /api/files/mkdir', () => {
      test('should validate directory path', async () => {
        const response = await request(app)
          .post('/api/files/mkdir')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({}) // Missing path
          .expect(400);
          
        expect(response.body.success).toBe(false);
        expect(response.body.errors).toBeDefined();
      });
    });

    describe('DELETE /api/files/delete', () => {
      test('should validate target path', async () => {
        const response = await request(app)
          .delete('/api/files/delete')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({}) // Missing path
          .expect(400);
          
        expect(response.body.success).toBe(false);
      });

      test('should prevent deletion of critical paths', async () => {
        const response = await request(app)
          .delete('/api/files/delete')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ path: '/' })
          .expect(403);
          
        expect(response.body.success).toBe(false);
        expect(response.body.message).toContain('critical');
      });
    });

    describe('POST /api/files/move', () => {
      test('should validate source and destination', async () => {
        const response = await request(app)
          .post('/api/files/move')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ source: '/tmp/test' }) // Missing destination
          .expect(400);
          
        expect(response.body.success).toBe(false);
        expect(response.body.errors).toBeDefined();
      });
    });

    describe('POST /api/files/copy', () => {
      test('should validate source and destination', async () => {
        const response = await request(app)
          .post('/api/files/copy')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ destination: '/tmp/test' }) // Missing source
          .expect(400);
          
        expect(response.body.success).toBe(false);
        expect(response.body.errors).toBeDefined();
      });
    });

    describe('GET /api/files/search', () => {
      test('should require search query', async () => {
        const response = await request(app)
          .get('/api/files/search')
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(400);
          
        expect(response.body.success).toBe(false);
        expect(response.body.errors).toBeDefined();
      });

      test('should validate search parameters', async () => {
        const response = await request(app)
          .get('/api/files/search?query=test&type=invalid')
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(400);
          
        expect(response.body.success).toBe(false);
      });

      test('should perform basic search', async () => {
        const response = await request(app)
          .get('/api/files/search?query=test&maxResults=10')
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(200);
          
        expect(response.body.success).toBe(true);
        expect(response.body.data.results).toBeInstanceOf(Array);
      });
    });
  });

  describe('Error Handling', () => {
    test('should handle 404 routes', async () => {
      const response = await request(app)
        .get('/api/nonexistent')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
        
      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('not found');
    });

    test('should handle malformed JSON', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .set('Content-Type', 'application/json')
        .send('{"invalid": json}')
        .expect(400);
        
      expect(response.body.success).toBe(false);
    });

    test('should handle missing Content-Type', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({ username: 'test', password: 'test' })
        .expect(400);
    });
  });

  describe('Rate Limiting', () => {
    test('should apply rate limits to API endpoints', async () => {
      // Make many requests quickly
      const promises = Array(20).fill().map(() => 
        request(app)
          .get('/api/system/stats')
          .set('Authorization', `Bearer ${adminToken}`)
      );
      
      const responses = await Promise.all(promises);
      
      // Some requests should be rate limited
      const rateLimited = responses.some(r => r.status === 429);
      expect(rateLimited).toBe(true);
    });
  });

  describe('Security Headers', () => {
    test('should include security headers', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);
        
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['x-frame-options']).toBeDefined();
      expect(response.headers['x-xss-protection']).toBeDefined();
    });
  });

  describe('Database Operations', () => {
    test('should handle database connection errors', async () => {
      // Temporarily break database connection
      const originalQuery = database.raw;
      database.raw = jest.fn().mockRejectedValue(new Error('Database error'));
      
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          username: 'testadmin',
          password: 'testadmin123!'
        })
        .expect(500);
        
      expect(response.body.success).toBe(false);
      
      // Restore database connection
      database.raw = originalQuery;
    });

    test('should handle concurrent requests safely', async () => {
      // Make multiple concurrent authentication requests
      const promises = Array(10).fill().map(() => 
        request(app)
          .post('/api/auth/login')
          .send({
            username: 'testadmin',
            password: 'testadmin123!'
          })
      );
      
      const responses = await Promise.all(promises);
      
      // All should succeed or fail gracefully
      responses.forEach(response => {
        expect([200, 401, 429]).toContain(response.status);
      });
    });
  });

  describe('Input Validation', () => {
    test('should sanitize SQL injection attempts', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          username: "admin'; DROP TABLE users; --",
          password: 'testpassword'
        })
        .expect(401); // Should fail authentication, not crash
        
      expect(response.body.success).toBe(false);
    });

    test('should handle XSS attempts in input', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          username: '<script>alert("xss")</script>',
          password: 'testpassword'
        })
        .expect(400); // Should be rejected by validation
        
      expect(response.body.success).toBe(false);
    });

    test('should validate file paths for directory traversal', async () => {
      const response = await request(app)
        .get('/api/files/browse?path=../../../../etc')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(403);
        
      expect(response.body.success).toBe(false);
    });
  });

  describe('Performance', () => {
    test('should respond quickly to health checks', async () => {
      const start = Date.now();
      
      await request(app)
        .get('/health')
        .expect(200);
        
      const duration = Date.now() - start;
      expect(duration).toBeLessThan(100); // Should respond in under 100ms
    });

    test('should handle multiple concurrent requests', async () => {
      const start = Date.now();
      
      const promises = Array(5).fill().map(() => 
        request(app)
          .get('/api/system/stats')
          .set('Authorization', `Bearer ${adminToken}`)
      );
      
      const responses = await Promise.all(promises);
      
      const duration = Date.now() - start;
      expect(duration).toBeLessThan(2000); // Should complete in under 2 seconds
      
      // All requests should succeed
      responses.forEach(response => {
        expect([200, 429]).toContain(response.status); // 200 or rate limited
      });
    });
  });

  describe('Monitoring Integration', () => {
    test('should record system metrics', async () => {
      const response = await request(app)
        .get('/api/system/stats')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
        
      expect(response.body.data.timestamp).toBeDefined();
      expect(response.body.data.cpu.usage).toBeDefined();
      expect(response.body.data.memory.usage).toBeDefined();
    });
  });

  describe('Configuration Management', () => {
    test('should validate environment variables', () => {
      expect(process.env.NODE_ENV).toBe('test');
      expect(process.env.JWT_SECRET || 'test-secret').toBeDefined();
    });
  });
});

// Integration tests for complex workflows
describe('Integration Tests', () => {
  let app;
  let adminToken;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    const appInstance = new ServerPanelApp();
    app = appInstance.app;
    
    await database.migrate.latest();
    await database.seed.run();
    
    // Login as admin
    const loginResponse = await request(app)
      .post('/api/auth/login')
      .send({
        username: 'admin',
        password: 'admin123!'
      });
      
    adminToken = loginResponse.body.token;
  });

  afterAll(async () => {
    await database.destroy();
  });

  describe('Complete File Management Workflow', () => {
    test('should create, list, modify, and delete files', async () => {
      const testPath = '/tmp/serverpanel-test';
      
      // 1. Create directory
      await request(app)
        .post('/api/files/mkdir')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ path: testPath })
        .expect(200);
      
      // 2. List directory contents
      const listResponse = await request(app)
        .get(`/api/files/browse?path=${encodeURIComponent(testPath)}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
        
      expect(listResponse.body.data.currentPath).toBe(testPath);
      
      // 3. Create a file
      const testFile = `${testPath}/test.txt`;
      await request(app)
        .post('/api/files/write')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          path: testFile,
          content: 'Hello, ServerPanel Pro!'
        })
        .expect(200);
      
      // 4. Read the file
      const readResponse = await request(app)
        .get(`/api/files/read?path=${encodeURIComponent(testFile)}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
        
      expect(readResponse.body.data.content).toBe('Hello, ServerPanel Pro!');
      
      // 5. Copy the file
      const copyPath = `${testPath}/test-copy.txt`;
      await request(app)
        .post('/api/files/copy')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          source: testFile,
          destination: copyPath
        })
        .expect(200);
      
      // 6. Move the copy
      const movePath = `${testPath}/test-moved.txt`;
      await request(app)
        .post('/api/files/move')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          source: copyPath,
          destination: movePath
        })
        .expect(200);
      
      // 7. Search for files
      const searchResponse = await request(app)
        .get(`/api/files/search?query=test&path=${encodeURIComponent(testPath)}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
        
      expect(searchResponse.body.data.results.length).toBeGreaterThan(0);
      
      // 8. Clean up - delete directory
      await request(app)
        .delete('/api/files/delete')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          path: testPath,
          recursive: true
        })
        .expect(200);
    });
  });

  describe('System Monitoring Workflow', () => {
    test('should retrieve comprehensive system information', async () => {
      // Get system info
      const infoResponse = await request(app)
        .get('/api/system/info')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
        
      expect(infoResponse.body.data.system.platform).toBeDefined();
      expect(infoResponse.body.data.cpu.cores).toBeGreaterThan(0);
      expect(infoResponse.body.data.memory.total).toBeGreaterThan(0);
      
      // Get current stats
      const statsResponse = await request(app)
        .get('/api/system/stats')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
        
      expect(parseFloat(statsResponse.body.data.cpu.usage)).toBeGreaterThanOrEqual(0);
      expect(parseFloat(statsResponse.body.data.memory.usage)).toBeGreaterThanOrEqual(0);
      
      // Get process list
      const processResponse = await request(app)
        .get('/api/system/processes')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
        
      expect(processResponse.body.data.processes).toBeInstanceOf(Array);
      expect(processResponse.body.data.total).toBeGreaterThan(0);
    });
  });

  describe('User Management Workflow', () => {
    test('should manage user lifecycle', async () => {
      // Note: This would require implementing user management endpoints
      // For now, we'll just verify the existing users from seeds
      
      const verifyResponse = await request(app)
        .get('/api/auth/verify')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
        
      expect(verifyResponse.body.user.role).toBe('admin');
      expect(verifyResponse.body.user.permissions).toContain('system:write');
    });
  });
}); request(app)
          .post('/api/auth/login')
          .send({
            username: 'testadmin',
            password: 'testadmin123!'
          })
          .expect(200);
          
        expect(response.body.success).toBe(true);
        expect(response.body.token).toBeDefined();
        expect(response.body.user.username).toBe('testadmin');
        expect(response.body.user.role).toBe('admin');
      });

      test('should reject invalid credentials', async () => {
        const response = await request(app)
          .post('/api/auth/login')
          .send({
            username: 'testadmin',
            password: 'wrongpassword'
          })
          .expect(401);
          
        expect(response.body.success).toBe(false);
        expect(response.body.message).toContain('Invalid');
      });

      test('should validate input format', async () => {
        const response = await request(app)
          .post('/api/auth/login')
          .send({
            username: 'ab', // Too short
            password: '123'  // Too short
          })
          .expect(400);
          
        expect(response.body.success).toBe(false);
        expect(response.body.errors).toBeDefined();
      });

      test('should handle rate limiting', async () => {
        // Make multiple failed attempts
        const promises = Array(6).fill().map(() => 
          request(app)
            .post('/api/auth/login')
            .send({
              username: 'testadmin',
              password: 'wrongpassword'
            })
        );
        
        const responses = await Promise.all(promises);
        
        // Last request should be rate limited
        const lastResponse = responses[responses.length - 1];
        expect(lastResponse.status).toBe(429);
      });
    });

    describe('GET /api/auth/verify', () => {
      test('should verify valid token', async () => {
        const response = await request(app)
          .get('/api/auth/verify')
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(200);
          
        expect(response.body.success).toBe(true);
        expect(response.body.user.username).toBe('testadmin');
      });

      test('should reject invalid token', async () => {
        const response = await request(app)
          .get('/api/auth/verify')
          .set('Authorization', 'Bearer invalidtoken')
          .expect(401);
          
        expect(response.body.success).toBe(false);
      });

      test('should require authorization header', async () => {
        const response = await request(app)
          .get('/api/auth/verify')
          .expect(401);
          
        expect(response.body.success).toBe(false);
      });
    });

    describe('POST /api/auth/logout', () => {
      test('should logout successfully', async () => {
        const response = await request(app)
          .post('/api/auth/logout')
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(200);
          
        expect(response.body.success).toBe(true);
      });
    });
  });

  describe('System Management', () => {
    describe('GET /api/system/info', () => {
      test('should return system information for admin', async () => {
        const response = await request(app)
          .get('/api/system/info')
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(200);
          
        expect(response.body.success).toBe(true);
        expect(response.body.data.system).toBeDefined();
        expect(response.body.data.cpu).toBeDefined();
        expect(response.body.data.memory).toBeDefined();
      });

      test('should deny access for unauthorized user', async () => {
        await request(app)
          .get('/api/system/info')
          .expect(401);
      });

      test('should check permissions', async () => {
        // Create user without system:read permission
        const limitedUserPassword = await bcrypt.hash('testlimited123!', 12);
        const [limitedUserId] = await database('users').insert({
          username: 'testlimited',
          email: 'limited@test.com',
          password_hash: limitedUserPassword,
          role: 'user',
          permissions: JSON.stringify(['files:read']), // No system:read
          is_active: true
        });
        
        const limitedToken = jwt.sign(
          { id: limitedUserId, username: 'testlimited', role: 'user' },
          process.env.JWT_SECRET || 'test-secret',
          { expiresIn: '1h' }
        );
        
        const response = await request(app)
          .get('/api/system/info')
          .set('Authorization', `Bearer ${limitedToken}`)
          .expect(403);
          
        expect(response.body.success).toBe(false);
        expect(response.body.message).toContain('permission');
      });
    });

    describe('GET /api/system/stats', () => {
      test('should return system statistics', async () => {
        const response = await request(app)
          .get('/api/system/stats')
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(200);
          
        expect(response.body.success).toBe(true);
        expect(response.body.data.timestamp).toBeDefined();
        expect(response.body.data.cpu).toBeDefined();
        expect(response.body.data.memory).toBeDefined();
        expect(typeof response.body.data.cpu.usage).toBe('string');
      });
    });

    describe('GET /api/system/processes', () => {
      test('should return process list', async () => {
        const response = await request(app)
          .get('/api/system/processes')
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(200);
          
        expect(response.body.success).toBe(true);
        expect(response.body.data.processes).toBeInstanceOf(Array);
        expect(response.body.data.total).toBeDefined();
      });
    });

    describe('DELETE /api/system/processes/:pid', () => {
      test('should validate PID parameter', async () => {
        const response = await