function getControlPlaneConfig(overrides = {}) {
  return {
    port: overrides.port || process.env.CONTROL_PLANE_PORT || 4100,
    jwtSecret: overrides.jwtSecret || process.env.CONTROL_PLANE_JWT_SECRET || 'change-this-control-plane-secret',
    jwtIssuer: overrides.jwtIssuer || process.env.CONTROL_PLANE_JWT_ISSUER || 'ServerPanel Platform',
    jwtAudience: overrides.jwtAudience || process.env.CONTROL_PLANE_JWT_AUDIENCE || 'serverpanel-control-plane',
    agentJwtSecret: overrides.agentJwtSecret || process.env.CONTROL_PLANE_AGENT_JWT_SECRET || 'change-this-agent-secret',
    agentJwtAudience: overrides.agentJwtAudience || process.env.CONTROL_PLANE_AGENT_JWT_AUDIENCE || 'serverpanel-agent',
    bootstrapAdminEmail: overrides.bootstrapAdminEmail || process.env.CONTROL_PLANE_BOOTSTRAP_ADMIN_EMAIL || 'owner@serverpanel.local',
    bootstrapAdminPassword: overrides.bootstrapAdminPassword || process.env.CONTROL_PLANE_BOOTSTRAP_ADMIN_PASSWORD || 'ChangeMe123!',
    bootstrapTeamName: overrides.bootstrapTeamName || process.env.CONTROL_PLANE_BOOTSTRAP_TEAM_NAME || 'Default Team',
    databaseClient: overrides.databaseClient || process.env.CONTROL_PLANE_DB_CLIENT || 'sqlite3',
    databaseFilename: overrides.databaseFilename || process.env.CONTROL_PLANE_DB_FILE || 'data/platform-control-plane.db',
    enrollmentTokenTtlMinutes: overrides.enrollmentTokenTtlMinutes || Number(process.env.CONTROL_PLANE_ENROLLMENT_TOKEN_TTL_MINUTES || 30)
  };
}

module.exports = {
  getControlPlaneConfig
};
