const { verifyAccessToken, verifyAgentToken } = require('../auth/security');
const { requirePermission: assertPermission } = require('../auth/rbac');

function getBearerToken(req) {
  const header = req.headers.authorization;
  if (!header) {
    return null;
  }

  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return null;
  }

  return token;
}

function authenticateRequest(config) {
  return (req, res, next) => {
    const token = getBearerToken(req);
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    try {
      const claims = verifyAccessToken(token, {
        jwtSecret: config.jwtSecret,
        issuer: config.jwtIssuer,
        audience: config.jwtAudience
      });

      req.auth = {
        userId: claims.sub,
        email: claims.email,
        role: claims.role,
        permissions: claims.permissions || []
      };

      return next();
    } catch (error) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired token'
      });
    }
  };
}

function requirePermission(permission) {
  return (req, res, next) => {
    try {
      if (!req.auth) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
      }

      assertPermission(req.auth.permissions, permission);
      return next();
    } catch (error) {
      return res.status(403).json({
        success: false,
        message: error.message
      });
    }
  };
}

function authenticateAgentRequest(config) {
  return (req, res, next) => {
    const token = getBearerToken(req);
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Agent authentication required'
      });
    }

    try {
      const claims = verifyAgentToken(token, {
        jwtSecret: config.agentJwtSecret,
        issuer: config.jwtIssuer,
        audience: config.agentJwtAudience
      });

      req.agentAuth = {
        agentId: claims.sub,
        serverId: claims.serverId
      };

      return next();
    } catch (error) {
      return res.status(401).json({
        success: false,
        message: 'Invalid agent token'
      });
    }
  };
}

module.exports = {
  authenticateRequest,
  authenticateAgentRequest,
  requirePermission
};
