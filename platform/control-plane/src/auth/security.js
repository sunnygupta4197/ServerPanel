const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Role, ROLE_PERMISSIONS } = require('../../../shared/src');
const { assertObject, assertOneOf, assertString } = require('../../../shared/src/assert');

function hashPassword(plainTextPassword, rounds = 12) {
  assertString(plainTextPassword, 'plainTextPassword');
  return bcrypt.hash(plainTextPassword, rounds);
}

function verifyPassword(plainTextPassword, passwordHash) {
  assertString(plainTextPassword, 'plainTextPassword');
  assertString(passwordHash, 'passwordHash');
  return bcrypt.compare(plainTextPassword, passwordHash);
}

function issueAccessToken(subject, options) {
  assertObject(subject, 'subject');
  assertString(subject.userId, 'subject.userId');
  assertString(subject.email, 'subject.email');
  assertOneOf(subject.role, 'subject.role', Object.values(Role));
  assertObject(options, 'options');
  assertString(options.jwtSecret, 'options.jwtSecret');

  return jwt.sign(
    {
      sub: subject.userId,
      email: subject.email,
      role: subject.role,
      permissions: ROLE_PERMISSIONS[subject.role]
    },
    options.jwtSecret,
    {
      expiresIn: options.expiresIn || '15m',
      issuer: options.issuer || 'ServerPanel Platform',
      audience: options.audience || 'serverpanel-control-plane'
    }
  );
}

function verifyAccessToken(token, options) {
  assertString(token, 'token');
  assertObject(options, 'options');
  assertString(options.jwtSecret, 'options.jwtSecret');

  return jwt.verify(token, options.jwtSecret, {
    issuer: options.issuer || 'ServerPanel Platform',
    audience: options.audience || 'serverpanel-control-plane'
  });
}

function issueAgentToken(subject, options) {
  assertObject(subject, 'subject');
  assertString(subject.agentId, 'subject.agentId');
  assertString(subject.serverId, 'subject.serverId');
  assertObject(options, 'options');
  assertString(options.jwtSecret, 'options.jwtSecret');

  return jwt.sign(
    {
      sub: subject.agentId,
      serverId: subject.serverId,
      type: 'agent'
    },
    options.jwtSecret,
    {
      expiresIn: options.expiresIn || '12h',
      issuer: options.issuer || 'ServerPanel Platform',
      audience: options.audience || 'serverpanel-agent'
    }
  );
}

function verifyAgentToken(token, options) {
  assertString(token, 'token');
  assertObject(options, 'options');
  assertString(options.jwtSecret, 'options.jwtSecret');

  const claims = jwt.verify(token, options.jwtSecret, {
    issuer: options.issuer || 'ServerPanel Platform',
    audience: options.audience || 'serverpanel-agent'
  });

  if (claims.type !== 'agent') {
    throw new Error('Invalid agent token type');
  }

  return claims;
}

module.exports = {
  hashPassword,
  issueAgentToken,
  issueAccessToken,
  verifyAgentToken,
  verifyAccessToken,
  verifyPassword
};
