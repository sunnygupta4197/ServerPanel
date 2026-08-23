function createCertificateService({ store }) {
  return {
    async listCertificates() {
      return store.listCertificates();
    },
    async createCertificate(input, actorUserId) {
      const certificate = await store.createCertificate(input);
      await store.appendAuditEvent({
        actorUserId,
        action: 'certificate.create',
        resourceType: 'certificate',
        resourceId: certificate.id,
        metadata: { serverId: certificate.serverId, domains: certificate.domains }
      });
      return certificate;
    }
  };
}

module.exports = {
  createCertificateService
};
