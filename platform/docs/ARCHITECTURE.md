# System Architecture

## Overview

The platform is split into a control plane and a server agent.

```text
Users -> Web UI / API -> Control Plane -> Job Queue -> Agent -> Host OS
                               |              |
                               |              -> Job logs / progress
                               -> Product DB
```

## Components

### Control Plane

Responsibilities:

- authentication and MFA
- authorization and RBAC
- audit logging
- server registry
- job orchestration
- configuration and desired state storage
- application, database, backup, and certificate workflows

The control plane must not execute raw privileged system commands directly.

### Agent

Responsibilities:

- authenticate with the control plane
- expose inventory and health data
- accept typed actions only
- execute privileged operations through an allowlisted registry
- stream job progress and artifacts

The agent is the only component allowed to touch privileged host operations.

### Job System

Responsibilities:

- queue long-running work
- capture progress and logs
- support retries and cancellation
- preserve deterministic state transitions

Examples:

- provision application runtime
- create database and user
- issue certificate
- rotate logs
- create backup
- restore backup

## Trust Boundaries

### Boundary 1: User to Control Plane

- protected by auth, MFA, sessions, rate limiting, RBAC
- all requests validated at schema level

### Boundary 2: Control Plane to Agent

- authenticated with agent registration credentials
- mutual trust model with certificate or signed token rotation
- every request uses typed action payloads

### Boundary 3: Agent to Host OS

- all operations flow through validated action handlers
- no generic "run arbitrary shell" interface in v1
- action policies restrict path, service, package, and runtime access

## Security Requirements

- encrypt secrets at rest
- rotate registration credentials
- audit all privileged actions
- scope file access to approved roots
- treat terminal access as a separately governed advanced capability
- reject undeclared action types

## Data Model Areas

- identities and roles
- teams and memberships
- servers and agent status
- applications and releases
- domains and certificates
- databases and credentials
- backup policies and recovery points
- jobs and job events
- audit events

## Delivery Strategy

- Linux first
- single server flow first
- multi-server orchestration second
- agency/team workflows third
