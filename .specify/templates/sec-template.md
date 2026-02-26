# [NNN]-sec-[slug]

> **Document Type:** Security Review (Lightweight)  
> **Audience:** LLM agents, human reviewers  
> **Status:** Draft | In Review | Approved | Flagged for Deep Review  
> **Last Updated:** YYYY-MM-DD <!-- @auto -->  
> **Reviewer:** [name] <!-- @human-required -->  
> **Risk Level:** Low | Medium | High | Critical <!-- @human-required -->

---

## Review Tier Legend

| Marker | Tier | Speckit Behavior |
|--------|------|------------------|
| 🔴 `@human-required` | Human Generated | Prompt human to author; blocks until complete |
| 🟡 `@human-review` | LLM + Human Review | LLM drafts → prompt human to confirm/edit; blocks until confirmed |
| 🟢 `@llm-autonomous` | LLM Autonomous | LLM completes; no prompt; logged for audit |
| ⚪ `@auto` | Auto-generated | System fills (timestamps, links); no prompt |

---

## Severity Definitions

| Level | Label | Definition |
|-------|-------|------------|
| 🔴 | **Critical** | Immediate exploitation risk; data breach or system compromise likely |
| 🟠 | **High** | Significant risk; exploitation possible with moderate effort |
| 🟡 | **Medium** | Notable risk; exploitation requires specific conditions |
| 🟢 | **Low** | Minor risk; limited impact or unlikely exploitation |

---

## Linkage ⚪ `@auto`

| Document | ID | Relationship |
|----------|-----|--------------|
| Parent PRD | [NNN]-prd-[slug].md | Feature being reviewed |
| Architecture Review | [NNN]-ar-[slug].md | Technical implementation |

---

## Purpose

This is a **lightweight security review** intended to catch obvious security concerns early in the product lifecycle. It is NOT a comprehensive threat model. Full threat modeling should occur during implementation when infrastructure-as-code and concrete implementations exist.

**This review answers three questions:**
1. What does this feature expose to attackers?
2. What data does it touch, and how sensitive is that data?
3. What's the impact if something goes wrong?

**Scope of this review:**
- ✅ Attack surface identification
- ✅ Data classification
- ✅ High-level CIA assessment
- ❌ Detailed threat enumeration (deferred to implementation)
- ❌ Penetration testing (deferred to implementation)
- ❌ Compliance audit (separate process)

---

## Feature Security Summary

### One-line Summary 🔴 `@human-required`
> [What does this feature do from a security perspective?]

### Risk Assessment 🔴 `@human-required`
> **Risk Level:** [Low | Medium | High | Critical]  
> **Justification:** [One sentence justification]

---

## Attack Surface Analysis

### Exposure Points 🟡 `@human-review`

<!-- 
IMPORTANT: If ANY exposure points are listed, DELETE the "None" row.
If there is NO external exposure, keep ONLY the "None" row and delete all others.
Do not leave contradictory rows.
-->

What entry points does this feature create or modify?

| Exposure Type | Details | Authentication | Authorization | Notes |
|---------------|---------|----------------|---------------|-------|
| Public Internet Endpoint | [e.g., API at /api/v1/resource] | [Yes/No - method] | [Yes/No - method] | |
| Internal Network Endpoint | [e.g., gRPC service] | [Yes/No - method] | [Yes/No - method] | |
| User Input Field | [e.g., file upload, form field] | — | — | [Validation?] |
| Webhook/Callback | [e.g., receives events from X] | [Yes/No - method] | — | |
| Scheduled Job | [e.g., cron, Lambda schedule] | — | — | |
| Message Queue Consumer | [e.g., SQS, Kafka topic] | — | — | |
| **None** | **Feature has no external exposure** | — | — | |

### Attack Surface Diagram 🟢 `@llm-autonomous`

```mermaid
flowchart LR
    subgraph External
        A[Internet Users]
        B[External APIs]
        C[Webhooks]
    end
    
    subgraph Boundary
        FW[Auth/Firewall]
    end
    
    subgraph Feature
        E1[Endpoint 1]
        E2[Endpoint 2]
        P[Processing]
    end
    
    subgraph Data Stores
        DB[(Database)]
        S3[(Object Store)]
    end
    
    A -->|HTTPS| FW
    FW -->|Authenticated| E1
    B -->|API Key| E2
    C -->|Webhook Secret| E2
    E1 --> P
    E2 --> P
    P --> DB
    P --> S3
```

### Exposure Checklist 🟢 `@llm-autonomous`

Quick validation of common exposure risks:

- [ ] **Internet-facing endpoints require authentication**
- [ ] **No sensitive data in URL parameters** (query strings logged, cached, leaked via referrer)
- [ ] **File uploads validated** (type, size, content) if applicable
- [ ] **Rate limiting configured** for public endpoints
- [ ] **CORS policy is restrictive** (not `*`) if applicable
- [ ] **No debug/admin endpoints exposed** in production
- [ ] **Webhooks validate signatures** if receiving external events

---

## Data Flow Analysis

### Data Inventory 🟡 `@human-review`

<!-- 
Cross-reference with PRD Data Model. 
For EVERY entity in the PRD Data Model, assign a classification here.
Use PRD Glossary terms consistently.
-->

What data does this feature collect, process, store, or transmit?

| Data Element | PRD Entity | Classification | Source | Destination | Retention | Encrypted Rest | Encrypted Transit | Residency |
|--------------|------------|----------------|--------|-------------|-----------|----------------|-------------------|-----------|
| [e.g., User email] | User.email | Confidential | User input | PostgreSQL | 2 years | Yes | Yes | [Region/Any] |
| [e.g., API logs] | — | Internal | System | CloudWatch | 30 days | Yes | Yes | US |
| [e.g., Payment token] | Payment.token | Restricted | Stripe API | Memory only | None | N/A | Yes | N/A |

### Data Classification Reference 🟢 `@llm-autonomous`

| Level | Label | Description | Examples | Handling Requirements |
|-------|-------|-------------|----------|----------------------|
| 1 | **Public** | No impact if disclosed | Marketing content, public docs | No special handling |
| 2 | **Internal** | Minor impact if disclosed | Internal configs, non-sensitive logs | Access controls, no public exposure |
| 3 | **Confidential** | Significant impact if disclosed | PII, user data, credentials | Encryption, audit logging, access controls |
| 4 | **Restricted** | Severe impact if disclosed | Payment data, health records, secrets | Encryption, strict access, compliance requirements |

### Data Flow Diagram 🟢 `@llm-autonomous`

<!-- Diagram node names should match Data Inventory elements -->

```mermaid
flowchart TD
    subgraph Input
        U[User] -->|PII: name, email| F[Feature]
        API[External API] -->|Tokens| F
    end
    
    subgraph Processing
        F -->|Validated| P[Processor]
        P -->|Transformed| V[Validator]
    end
    
    subgraph Storage
        V -->|Confidential| DB[(Database)]
        V -->|Internal| LOG[(Logs)]
    end
    
    subgraph Output
        DB -->|Filtered PII| R[Response to User]
        DB -->|Anonymized| AN[Analytics]
    end
    
    style DB fill:#f96,stroke:#333
    style U fill:#9f9,stroke:#333
```

### Data Handling Checklist 🟢 `@llm-autonomous`

- [ ] **No Restricted data stored unless absolutely required**
- [ ] **Confidential data encrypted at rest**
- [ ] **All data encrypted in transit (TLS 1.2+)**
- [ ] **PII has defined retention policy**
- [ ] **Logs do not contain Confidential/Restricted data** (or are properly secured)
- [ ] **Secrets are not hardcoded** (use secret manager)
- [ ] **Data minimization applied** (only collect what's needed)
- [ ] **Data residency requirements documented** (if applicable)

---

## Third-Party & Supply Chain 🟡 `@human-review`

<!-- 
List all NEW external services, libraries, or dependencies introduced by this feature.
Existing/approved dependencies don't need to be listed.
-->

### New External Services

| Service | Purpose | Data Shared | Communication | Approved? |
|---------|---------|-------------|---------------|-----------|
| [e.g., Stripe API] | Payment processing | Payment tokens | HTTPS/TLS 1.3 | [Yes/No/Pending] |
| [e.g., SendGrid] | Email delivery | User emails | HTTPS/TLS 1.2 | [Yes/No/Pending] |

### New Libraries/Dependencies

| Library | Version | License | Purpose | Security Check |
|---------|---------|---------|---------|----------------|
| [e.g., serde] | 1.0.x | MIT/Apache | Serialization | [✅ Approved / ⚠️ Review / ❌ Blocked] |
| [e.g., reqwest] | 0.11.x | MIT/Apache | HTTP client | [✅ Approved / ⚠️ Review / ❌ Blocked] |

### Supply Chain Checklist

- [ ] **All new services use encrypted communication**
- [ ] **Service agreements/ToS reviewed** (if applicable)
- [ ] **Dependencies have acceptable licenses** (MIT, Apache, BSD preferred)
- [ ] **Dependencies are actively maintained** (recent commits, responsive maintainers)
- [ ] **No known critical vulnerabilities** in dependency versions

---

## CIA Impact Assessment

If this feature is compromised, what's the impact?

### Confidentiality 🟡 `@human-review`

> **What could be disclosed?**

| Asset at Risk | Classification | Exposure Scenario | Impact | Likelihood |
|---------------|----------------|-------------------|--------|------------|
| [e.g., User emails] | Confidential | SQL injection, access control bypass | Medium | Low |
| [e.g., Internal config] | Internal | Log exposure, error messages | Low | Medium |

**Confidentiality Risk Level:** [Low | Medium | High]

### Integrity 🟡 `@human-review`

> **What could be modified or corrupted?**

| Asset at Risk | Modification Scenario | Impact | Likelihood |
|---------------|----------------------|--------|------------|
| [e.g., User profile] | Unauthorized update via IDOR | Medium | Low |
| [e.g., Transaction record] | Tampering via API manipulation | High | Low |

**Integrity Risk Level:** [Low | Medium | High]

### Availability 🟡 `@human-review`

> **What could be disrupted?**

| Service/Function | Disruption Scenario | Impact | Likelihood |
|------------------|---------------------|--------|------------|
| [e.g., API endpoint] | DoS via resource exhaustion | Medium | Medium |
| [e.g., Database] | Connection pool exhaustion | High | Low |

**Availability Risk Level:** [Low | Medium | High]

### CIA Summary 🟢 `@llm-autonomous`

<!-- Simple table replaces quadrant chart for LLM clarity -->

| Dimension | Risk Level | Primary Concern | Mitigation Priority |
|-----------|------------|-----------------|---------------------|
| **Confidentiality** | [Low/Med/High] | [Top concern] | [High/Medium/Low] |
| **Integrity** | [Low/Med/High] | [Top concern] | [High/Medium/Low] |
| **Availability** | [Low/Med/High] | [Top concern] | [High/Medium/Low] |

**Overall CIA Risk:** [Low | Medium | High] — *[One sentence summary]*

---

## Trust Boundaries 🟡 `@human-review`

Where does trust change in this feature?

```mermaid
flowchart TD
    subgraph Untrusted
        U[User Input]
        EXT[External Service Response]
    end
    
    subgraph Trust Boundary 1
        AUTH[Authentication]
        VAL[Input Validation]
    end
    
    subgraph Trusted - Application
        APP[Application Logic]
    end
    
    subgraph Trust Boundary 2
        AUTHZ[Authorization Check]
    end
    
    subgraph Trusted - Data
        DB[(Data Store)]
    end
    
    U --> AUTH
    AUTH --> VAL
    VAL --> APP
    EXT --> VAL
    APP --> AUTHZ
    AUTHZ --> DB
```

### Trust Boundary Checklist 🟢 `@llm-autonomous`

- [ ] **All input from untrusted sources is validated**
- [ ] **External API responses are validated** (don't trust external services blindly)
- [ ] **Authorization checked at data access, not just entry point**
- [ ] **Service-to-service calls are authenticated** (not just network isolation)

---

## Known Risks & Mitigations 🟡 `@human-review`

| ID | Risk Description | Severity | Mitigation | Status | Owner |
|----|------------------|----------|------------|--------|-------|
| R1 | [Describe the risk] | [Low/Med/High/Crit] | [How it's addressed] | [Open/Mitigated/Accepted] | [who] |
| R2 | [Describe the risk] | [Low/Med/High/Crit] | [How it's addressed] | [Open/Mitigated/Accepted] | [who] |

### Risk Acceptance 🔴 `@human-required`

If risks are being accepted rather than mitigated:

| Risk ID | Accepted By | Date | Justification | Review Date |
|---------|-------------|------|---------------|-------------|
| R1 | [name] | YYYY-MM-DD | [Why accepting] | YYYY-MM-DD |

---

## Security Requirements 🟡 `@human-review`

<!-- 
Each requirement should trace to a PRD Acceptance Criteria where possible.
Specify how each requirement will be verified.
-->

Based on this review, the implementation MUST satisfy:

### Authentication & Authorization

| Req ID | Requirement | PRD AC | Verification Method |
|--------|-------------|--------|---------------------|
| SEC-1 | All /api/* endpoints require valid JWT | AC-1 | Integration Test |
| SEC-2 | Resource access must validate ownership | AC-2 | Integration Test |

### Data Protection

| Req ID | Requirement | PRD AC | Verification Method |
|--------|-------------|--------|---------------------|
| SEC-3 | User PII encrypted with AES-256 at rest | — | Manual Review |
| SEC-4 | Logs must not contain email addresses | — | Unit Test |

### Input Validation

| Req ID | Requirement | PRD AC | Verification Method |
|--------|-------------|--------|---------------------|
| SEC-5 | File uploads limited to 10MB, image types only | AC-3 | Integration Test |
| SEC-6 | All string inputs sanitized for XSS | — | Unit Test |

### Operational Security

| Req ID | Requirement | PRD AC | Verification Method |
|--------|-------------|--------|---------------------|
| SEC-7 | Failed auth attempts logged with IP | — | Manual Review |
| SEC-8 | Rate limit: 100 req/min per user | M-2 | Load Test |

---

## Compliance Considerations 🟡 `@human-review`

Does this feature have regulatory implications?

<!-- If not applicable, mark N/A and provide brief justification -->

| Regulation | Applicable? | Relevant Requirements | N/A Justification |
|------------|-------------|----------------------|-------------------|
| GDPR | [Yes/No/N/A] | [e.g., Right to deletion, consent] | [Why N/A if applicable] |
| CCPA | [Yes/No/N/A] | [e.g., Data disclosure] | [Why N/A if applicable] |
| SOC 2 | [Yes/No/N/A] | [e.g., Access controls, logging] | [Why N/A if applicable] |
| HIPAA | [Yes/No/N/A] | [e.g., PHI handling] | [Why N/A if applicable] |
| PCI-DSS | [Yes/No/N/A] | [e.g., Payment data handling] | [Why N/A if applicable] |
| Other | [Yes/No/N/A] | [Specify] | [Why N/A if applicable] |

---

## Review Findings

### Issues Identified 🟡 `@human-review`

| ID | Finding | Severity | Category | Recommendation | Status |
|----|---------|----------|----------|----------------|--------|
| F1 | [What was found] | [Low/Med/High/Crit] | [Exposure/Data/CIA/Supply Chain] | [What to do] | [Open/Resolved] |
| F2 | [What was found] | [Low/Med/High/Crit] | [Exposure/Data/CIA/Supply Chain] | [What to do] | [Open/Resolved] |

### Positive Observations 🟢 `@llm-autonomous`

- [Security-positive aspect of the design]
- [Another good security practice observed]

---

## Open Questions 🟡 `@human-review`

- [ ] **Q1:** [Unresolved security question]
- [ ] **Q2:** [Unresolved security question]

---

## Changelog ⚪ `@auto`

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 0.1 | YYYY-MM-DD | [name] | Initial review |
| 0.2 | YYYY-MM-DD | [name] | Updated after PRD revision |

---

## Review Sign-off 🔴 `@human-required`

| Role | Name | Date | Decision |
|------|------|------|----------|
| Security Reviewer | [name] | YYYY-MM-DD | [Approved / Approved with conditions / Rejected] |
| Feature Owner | [name] | YYYY-MM-DD | [Acknowledged] |

### Conditions for Approval (if applicable) 🔴 `@human-required`

- [ ] [Condition that must be met before implementation proceeds]
- [ ] [Another condition]

---

## Security Requirements Traceability 🟢 `@llm-autonomous`

<!-- Ensures all security requirements map to verification -->

| SEC Req ID | PRD Req ID | PRD AC ID | Test Type | Test Location |
|------------|------------|-----------|-----------|---------------|
| SEC-1 | M-1 | AC-1 | Integration | tests/auth_test.rs |
| SEC-2 | M-1 | AC-2 | Integration | tests/authz_test.rs |
| SEC-3 | — | — | Manual | Security checklist |

---

## Review Checklist 🟢 `@llm-autonomous`

Before marking as Approved:
- [ ] Attack surface documented with auth/authz status for each exposure
- [ ] Exposure Points table has no contradictory rows (None vs. actual endpoints)
- [ ] All PRD Data Model entities appear in Data Inventory
- [ ] All data elements are classified using the 4-tier model
- [ ] Third-party dependencies and services are listed
- [ ] CIA impact is assessed with Low/Medium/High ratings
- [ ] Trust boundaries are identified
- [ ] Security requirements have verification methods specified
- [ ] Security requirements trace to PRD ACs where applicable
- [ ] No Critical/High findings remain Open
- [ ] Compliance N/A items have justification
- [ ] Risk acceptance has named approver and review date
