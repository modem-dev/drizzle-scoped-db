# Security Policy

Please report suspected vulnerabilities privately. Do not open a public issue for security reports.

Use GitHub private vulnerability reporting if it is enabled for this repository, or contact the maintainers through the security contact listed on the organization profile.

`drizzle-scoped-db` is an application-layer scoping helper, not a complete database isolation system. It adds typed guardrails for supported Drizzle query-builder calls through the scoped wrapper.

Strict mode is enabled by default: tenant-scoped queries must include an explicit scoped `where` predicate, or they throw before execution. This helps catch mistakes in human-written, generated, or agent-authored code.

It works best with tenant/scope columns, scoped rules, tenant-aware indexes, and relationships or constraints that reject invalid cross-tenant references. RLS and database permissions can be layered with scoped handles when you need enforcement outside the typed query-builder path.
