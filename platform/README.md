# ServerPanel Platform Rebuild

This directory contains the new product foundation for rebuilding ServerPanel
from a prototype into a production-grade hosting control plane.

The existing root application remains in place as legacy/prototype code. New
platform work should be added here so we can build clear trust boundaries,
stronger security guarantees, and a cleaner deployment architecture.

## Structure

- `docs/`
  Product and architecture documents that define scope and delivery.
- `shared/`
  Shared contracts, enums, and validation helpers used by the control plane and
  the server agent.
- `control-plane/`
  Backend control plane foundations: domain model, job system model, and policy
  definitions.
- `agent/`
  Agent-side execution contracts and action registry stubs.

## Build Principles

- Never let arbitrary web requests execute arbitrary shell commands.
- Model all privileged operations as typed actions with validation.
- Move long-running and risky tasks into tracked jobs.
- Treat Linux as the v1 primary target.
- Keep the control plane unprivileged; the agent owns privileged execution.
