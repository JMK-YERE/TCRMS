# TCRMS — Tanzania Criminal Record Management System

**Status: development scaffold only — not approved or ready for operational use.**

TCRMS is being developed as a separate HTML/CSS/JavaScript frontend and a Spring Boot REST API.

## Repository layout

- `backend/` — Java 21, Spring Boot 3.5, REST API, Spring Security, PostgreSQL, Flyway.
- `frontend/` — static HTML, CSS and JavaScript prototype.
- `.github/workflows/verify.yml` — CI build/test workflow.

## Local prerequisites

- JDK 21
- Maven 3.6.3+
- PostgreSQL for running the full backend
- VS Code Live Server (or another local HTTP server) for the frontend

## Backend configuration

Set these environment variables locally; do not commit actual values or a `.env` file:

- `SPRING_DATASOURCE_URL` — JDBC URL, e.g. `jdbc:postgresql://localhost:5432/tcrms_dev`
- `SPRING_DATASOURCE_USERNAME`
- `SPRING_DATASOURCE_PASSWORD`
- Optional: `TCRMS_CORS_ALLOWED_ORIGINS` — comma-separated allowed frontend origins

Run from the repository root:

```bash
mvn -f backend/pom.xml test
mvn -f backend/pom.xml spring-boot:run
```

The public health endpoint is `GET http://localhost:8080/api/v1/health`. All other API paths are protected by default. Authentication and role provisioning are not implemented yet, so protected endpoints are intentionally not usable at this stage.

Serve `frontend/` at `http://localhost:5500` and open its `index.html`.

## Security and data handling

- Do not commit real personal information, criminal records, case files, credentials, tokens, or database connection strings.
- Do not treat an allegation, arrest, mention in a case, or unverified record as a conviction.
- Do not create a "repeat offender" flag until verified convictions and distinct cases are modelled with approved rules.
- No criminal-record domain tables or real-record CRUD endpoints are included in this initial scaffold.
- Before any operational use, require institutional/legal approval, a threat model, independent security review, least-privilege roles, MFA, immutable audit controls, encryption, retention rules, tested backups/restores, monitoring and incident response.

A successful GitHub commit or CI build does **not** certify this system as secure or production-ready.
