# Platform Reference

This bundled reference makes the skill portable across repositories. It is a
distilled copy of the current standard platform expectations.

## Relevance for AI agents and operators (read first)

**This document is the canonical description of target-host architecture** for every environment where this platform is deployed: filesystem layout under `/srv`, backup roots, shared services (e.g. Traefik, GitLab), users/roles, and how **Ansible inventory** relates to declared host roles.

Treat it as **mandatory context** when planning or changing **deployment, compose, ingress, backups, disaster recovery, or host provisioning**—including:

- **Disaster recovery:** how backups are rooted and rotated on production hosts, and how recovery is expected to work from those paths.
- **Standby / cold hosts:** hosts that **do not** run the application in steady state but are **prepared** to receive a deployment and **restore the latest received backup** from a failed primary (e.g. lost datacenter, planned migration, or change of hosting provider for commercial reasons).
- **Migration and failover:** any work that assumes “where files live,” “who runs compose,” or “how traffic attaches” must stay consistent with this reference unless you are explicitly documenting an approved deviation.

If a proposal conflicts with this file, **call out the conflict** and align with stakeholders before recommending implementation.

## Runtime Platform

- Application deployments live under `/srv/deployments/<application>`.
- Standard backup roots are:
  - `/srv/local-backup`
  - `/srv/latest-backup`
  - `/srv/incoming-backup`
  - `/srv/scratch`
- Backup roots must share a filesystem; `/srv/deployments` should preferably
  share it as well.
- Default compose filename for new aligned work is `compose.yml`. Existing
  projects may carry documented exceptions during transition.

## Users And Privileges

- `root`: break-glass, recovery, bootstrap only
- `ansible`: preferred automation SSH identity
- `appadmin`: runtime owner and compose operator
- Routine compose-based deployments should not run as root.

## Shared Services And Host Roles

- Self-hosted GitLab is a shared service, not a per-app or per-host install.
- GitLab runs only on designated primary and cold-standby hosts.
- A self-hosted registry may be colocated with GitLab.
- Active host roles belong first in architecture manifests and are then
  projected into Ansible inventory, `host_vars`, and `group_vars`.
- Ansible roles implement declared host roles; they are not the only source of
  truth for role activation.

## Ingress And TLS

- Each aligned host has one standalone Traefik stack.
- Public or routed services expose themselves through labels.
- Aligned app stacks do not embed their own Traefik.
- Certificates default to Traefik ACME / Let's Encrypt.
- Multiple FQDNs may point to the same routed service.

## Repository And Workflow Model

- Repository origin may be GitHub or self-hosted GitLab.
- Default branch is `main`.
- Standard promotion path is:
  - (`dev`)
  - `test`
  - `demo`
  - (`preprod`)
  - `prod` via `main`
- Hotfix path is:
  - `hotfix`
  - `prod` via `main`
- Authorized release maintainers may skip intermediate stages deliberately.
- Releases landing on `main` require a matching Git tag.
- Git submodules are allowed; CI must initialize them when used.

## Collaboration Rules

- Multi-contributor work with multiple distinct authenticated identities uses a
  PR or MR plus at least one review before merge.
- AI-authored commits under the same human login may follow the single-
  contributor path.
- Single-contributor flows may skip PR or MR gating and keep reviews non-
  blocking.

## Runner And Registry Defaults

- Self-hosted runners, when used, run as containers.
- Preferred self-hosted runner execution mode is Docker socket mount.
- DinD is an allowed exception when explicitly required.
- GitHub and GitLab runners use separate registrations.
- Not every host needs active runners.

### Public repositories

- Prefer provider-native runners for ordinary build and test jobs.
- Prefer provider-native registries or public registries such as `ghcr.io` for
  public image publication.
- Self-hosted runners remain allowed when private deployment reachability or
  specialized dependencies require them.
- Self-hosted registries remain optional for public repositories.

### Private or internal repositories

- Self-hosted deployment runners are acceptable when deployments need private
  platform reachability.
- A self-hosted registry remains the preferred default when platform operations
  expect private image distribution.

## Workflow Capability Defaults

- A fixed `amd64` build-only or build-and-push workflow is an acceptable
  default.
- Projects may expose architecture selection inputs when multi-arch output is
  needed.
- Allowed architecture values should stay explicit, typically `amd64` and
  optionally `arm64`.
- Projects may keep the registry target fixed or expose a documented registry
  selector.

## Secrets And Configuration

- Real `.env` files must not be committed.
- Commit only examples or schemas such as `.env.example`, `example.env`, or
  `mandatory.env`.
- `.env` should sit beside the compose file and use mode `0600`.
- `.env` content may be added manually or rendered from host-scoped Ansible
  Vault.
- CI secrets should stay minimal and job-specific.
- Dummy or test-only secrets are acceptable for non-deployment tests.
- Check `.gitignore` coverage before relying on local secret files.

## Deployment And Ansible

- Preferred automation transport identity is `ansible`.
- Compose actions run as `appadmin`.
- Default deployment assets live in the same repository in a repo-local Ansible
  tree such as `ansible/` or `ops/ansible/`.
- A pinned shared operations repository is an allowed alternative when
  intentionally shared across projects.
- Build and test jobs may run on native or self-hosted runners.
- Ansible-driven deployment jobs should run on a designated deployment runner
  with target-network reachability.
- The deployment runner executes checked-out inventory, roles, and playbooks
  locally unless the project documents a different model.

## Backup And Recovery

- `latest-backup/<application>/` must contain one archive plus one checksum.
- The archive must support worst-case recovery onto a freshly aligned host or a
  standby or failover host.
- Recovery material should include:
  - persisted data
  - configuration
  - required secrets
  - restore automation
  - installation or deployment scripts needed for recovery
- DNS TTL assumptions for failover planning use 300 seconds.

## Minimum Validation

- `docker compose config`
- `docker compose up -d`
- `docker compose ps`
- Host-header validation for Traefik-routed services
- Additional app-specific health checks as needed

## Definition Of Done For Deploy

- Deployment is not done just because containers start.
- Completion requires verified automated, human, or hybrid end-to-end testing
  at the required depth for that project and environment.
