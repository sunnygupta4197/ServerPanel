const { issueAccessToken, verifyPassword } = require('../auth/security');

function createAuthService({ config, store }) {
  return {
    async login({ email, password }) {
      const user = await store.findUserByEmail(email);
      if (!user || user.status !== 'active') {
        return null;
      }

      const validPassword = await verifyPassword(password, user.passwordHash);
      if (!validPassword) {
        return null;
      }

      const updatedUser = await store.updateUserLastLogin(user.id);
      await store.appendAuditEvent({
        actorUserId: user.id,
        action: 'auth.login',
        resourceType: 'user',
        resourceId: user.id,
        metadata: { email: user.email }
      });

      const token = issueAccessToken(
        {
          userId: user.id,
          email: user.email,
          role: user.role
        },
        {
          jwtSecret: config.jwtSecret,
          issuer: config.jwtIssuer,
          audience: config.jwtAudience
        }
      );

      return {
        token,
        user: updatedUser
      };
    }
  };
}

module.exports = {
  createAuthService
};
