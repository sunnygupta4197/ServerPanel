# Product Requirements Document

## Product Name

ServerPanel Platform

## Product Summary

ServerPanel Platform is a secure hosting control plane for managing Linux
servers, websites, applications, databases, SSL certificates, backups, logs,
and team access from a single interface. It is designed as a modern replacement
for legacy hosting panels while remaining safe enough for production use.

## Problem

Current hosting panels are often:

- difficult to operate safely at scale
- overloaded with legacy workflows
- weak at app-centric deployment flows
- hard to audit and permission correctly
- inconsistent in backup, recovery, and failure handling

The current ServerPanel prototype demonstrates demand, but it does not yet meet
production requirements for security, operational reliability, or product
clarity.

## Users

### Primary

- solo developers managing one or more VPS instances
- agencies hosting and maintaining client applications
- small businesses running internal and public apps

### Secondary

- managed hosting operators
- internal platform teams

## Product Goals

- Make Linux application hosting dramatically easier than raw SSH.
- Replace common shared-hosting and server-admin panel workflows.
- Provide safe-by-default operations for app, database, SSL, backup, and file
  management.
- Support multi-server management through a secure agent model.
- Offer clear auditability for all privileged actions.

## Non-Goals for V1

- email hosting
- DNS hosting from scratch
- Windows server management
- reseller billing
- plugin marketplace
- Kubernetes orchestration

## V1 Capabilities

- user authentication, MFA, session management
- teams, roles, scoped permissions
- server registration and health heartbeat
- application and site lifecycle management
- domain attachment and web server config generation
- SSL issuance and renewal
- runtime and process control for Node, Python, and PHP apps
- PostgreSQL and MySQL provisioning
- file browsing and scoped file editing
- scheduled backups, retention, and restore flows
- logs, metrics, health checks, and alerting
- job history, progress tracking, and audit log

## Success Metrics

- first application deployed in under 10 minutes
- first server connected in under 5 minutes
- 100 percent of privileged operations recorded in audit log
- zero direct arbitrary shell execution from public API requests
- restore workflow validated in staging before GA

## Product Principles

- safe defaults beat broad unsafe freedom
- app workflows beat raw system exposure
- expert controls should exist, but behind stronger policy gates
- failures must be visible, replayable, and recoverable
- every action should have an owner, status, and audit trail
