# Veridian Wallet — E2E Test Automation Assessment

> Exercise 1 — assessment of the current end-to-end testing solution: audit,
> open questions, and a proposed path. Figures are measured from `main`; runtime
> and effort figures are labelled observed/inferred.

**Bottom line:** a 121-scenario suite gated to **1** scenario, on a KERIA backend
that already exists in the repo but CI never starts. The fix is to wire and
stabilize what's already here, then re-centre testing on risk — not a rebuild.

*Terms: **KERIA** = the KERI cloud-agent backend the wallet pairs with;
**signify** = the client SDK that talks to it; **OOBI** = the out-of-band
handshake that connects two parties; **ACDC** = a verifiable credential.*

## Verdict

- **Healthy:** the test architecture (Page Object Model, `data-testid`, tags) and
  the backend infra (`docker-compose.yaml` with KERIA + witnesses + cred-issuance;
  a signify-ts harness in `tests/helpers/`) are sound and already in the repo.
- **Broken (operational):** the suite is gated to 1 of 121 scenarios, the KERIA
  stack is never started in CI, and the device suite is flaky and slow.
- **Broken (strategic):** the suite covers happy-path journeys while the wallet's
  highest-risk behaviours — recovery, offline, adversarial — go untested.

The central reframe: the current suite audits *functional journeys of a test
artifact*; a key-custody wallet needs testing organized around *risk* — what must
never break, ranked by blast radius.

## Highest-risk gaps — "what must never break"

Product-risk view (the suite-mechanics view is the Weaknesses table below):

| Journey | Blast radius | Coverage today |
|---|---|---|
| **Recovery** (18-word restore) | Permanent, unrecoverable loss of identity/funds | UI-only (seed display/verify); no KERIA-backed restore at any tier |
| **Key/seed handling & at-rest storage** | Key compromise | Device-only, never adversarially tested |
| **Multisig signing authority** | A transaction approved without proper authority | Happy-path only |
| **Credential authenticity** (issue/verify ACDC) | Accept a forged/invalid credential | Not covered at any tier (no `.issue`/`.grant`/`.admit`/`ipex` anywhere in `tests/`) |
| **Offline / degraded network** | Stuck or half-committed ops, data loss | One connect-URL-unreachable error string |

*(`welcome-back` has "retry in N min" lockout scenarios, but those are
passcode-attempt rate-limiting, not network resilience — no test manipulates the
network.)*

## Strengths (keep)

- **Page Object Model** — 31 `*.screen.ts` + 12 `*.modal.ts` page-object classes,
  domain-organized; selectors decoupled from steps.
- **`data-testid` selectors** — stable against layout/copy churn; the right choice
  for a WebView app.
- **Tag taxonomy** (`@smoke @onboarding …`) — the mechanism for a tiered/fast gate
  already exists, just under-used.
- **Backend infrastructure already exists** — root `docker-compose.yaml` stands up
  KERIA + witnesses + cred-issuance; `docker-assets/keria` + `keria-config`
  bootstrap; `.env.example` documents the host-topology split;
  `tests/helpers/virtual-wallet.ts` / `backend-helpers.ts` are a working signify-ts
  harness; `ssi-agent-urls.helper.ts` resolves the base URL per tier.
- **High fidelity where it runs** — the real Capacitor build on a real emulator
  covers the native↔WebView boundary lower tiers cannot.

The architecture and infra are sound; the defects are operational, integrative,
and strategic — cheaper to fix than structural rot.

## Weaknesses (evidence from `main`)

| # | Attribute | Finding | Evidence |
|---|---|---|---|
| 1 | **Coverage-as-gated** | PR gate runs **1 of 121** scenarios; the one it runs is the only agent-less journey | `e2e-pr-check.yaml` → `onboarding-intro.feature` (0 agent refs) |
| 2 | **Cloud-agent not wired to CI** | the e2e job exports `KERIA_IP=10.0.2.2` and runs `build:e2e`, but never `docker compose up` — the existing KERIA stack is never started, so no agent journey can be gated | `e2e-pr-check.yaml` vs `docker-compose.yaml` |
| 3 | **Pyramid shape** | **ice-cream cone** (top-heavy): 121 e2e : **0** integration tests : ~1,400 unit cases; the signify primitives exist in `tests/helpers/` but run only from the device tier | `tests/`, `src/**/*.test.*` |
| 4 | **Resilience** | KERIA is a remote, fallible dependency; no offline/partition/latency/half-commit journey exists (one connect-URL error aside) | feature files |
| 5 | **Adversarial integrity** | no security/abuse tier for a key-custody wallet (tamper, malformed OOBI, replay, duplicity, key-extraction) | `tests/` |
| 6 | **Risk targeting** | the highest-blast-radius journeys (recovery, credential authenticity) are the least covered; prioritization tracks suite visibility, not user harm | risk table above |
| 7 | **Determinism** | 43 `browser.pause()` sleeps; `specFileRetries: 0`; `waitforTimeout: 1500ms`; plus a structurally unstable webview attach (below) | `wdio.config.ts` |
| 8 | **Feedback latency** | full onboarding re-run per scenario (~50s, observed); `maxInstances: 1` (serial); unpinned `appium` + uiautomator2 driver; only npm/gradle dep caches (no AVD/build cache) | 30 `Background:` blocks, wdio config |
| 9 | **iOS** | `workflow_dispatch`-only on a single **self-hosted macOS/ARM64** runner; KERIA not wired in; Node 18 vs 20 drift | `e2e-mobile-tests.yaml` |
| 10 | **Observability / operating model** | no report on the gate, and no suite-health feedback loop (flake-rate trend, ownership, quarantine-drain) — the mechanism by which 121 decayed to 1 | `e2e-pr-check.yaml` |

**Determinism is structural, not just sleeps.** Beyond the 43 `browser.pause()`
calls, `wdio.config.ts` force-stops Chrome/Messaging and races `getContexts()`
against manual timeouts to survive a hanging CDP bridge — evidence the
native↔WebView context switch itself is unstable (consistent with old-WebView /
Chrome-version quirks; the race is fact, the root-cause attribution inferred).
Swapping `pause()` for `waitUntil` is necessary but not sufficient; a single,
hardened context-switch helper is the real fix.

**Synthesis:** a large suite delivering near-zero continuous signal — gated to one
scenario because it is slow and flaky, pulled off CI rather than stabilized, while
the backend it depends on sits unused. *(121 counts Scenario Outline examples; 120
authored blocks.)* The decay from 121→1 is itself a process signal: nobody owned
suite health.

## Open Questions

A useful clarifying question asks for what cannot be derived in-repo. I read
**"cloud agent integration" as the KERIA backend** (not cloud execution agents /
device farms) and design accordingly — flag if wrong. Questions are split by
urgency; each leads with a recommendation and the fact to confirm.

**Design-affecting (I'd raise these in a GitHub discussion):**

1. **Gherkin/Cucumber — who reads the scenarios?** *Rec:* if engineers-only (no
   requirement-IDs in features), drop BDD for typed WDIO/Playwright — the
   gherkin→step glue is otherwise pure cost. *Confirm:* a non-engineer audience
   (compliance, audit, product) for whom they're a contract?
2. **Device/OS matrix.** *Rec:* emulator for the smoke gate, a small
   cloud-device-farm matrix nightly. *Confirm:* required cert list
   (market/regulatory); device-farm budget + a flake owner?
3. **iOS.** *Rec:* revive into CI off the single self-hosted Mac, or formally
   declare manual with a tracked owner. *Confirm:* in scope now, or deferred?

**Assumptions to confirm (inferred, not verified in-repo):**

4. **Cred-issuance test scope.** `cred-issuance` is build-from-source in the
   compose, but no e2e issues a credential today; current journeys need only
   `keria + witnesses`. *Confirm:* is credential issuance a target e2e journey?
5. **KERIA version stability.** The dev compose pins a throwaway branch-fix tag;
   production composes float on `:main`. *Confirm:* stable API per release
   (→ digest-pin + contract testing viable) or active churn (→ real-agent only)?
6. **Test environment.** *Confirm:* ephemeral KERIA per run only, or is there a
   shared/staging agent the suite should also target?

**Broader / structural (don't block current work; shape the system long-term):**

7. **Release cadence** — shipping frequency drives the per-PR-smoke / nightly /
   pre-release split and how much regression runs when.
8. **Per-customer / white-label** — any per-tenant branding, configuration, or
   KERIA endpoint variation? If so, e2e needs a config-matrix + per-brand smoke,
   not a single build.
9. **Upgrade / migration** — must an encrypted, at-rest key store survive app
   upgrades? A distinct, high-blast-radius class — upgrades are where wallets
   routinely lose keys.
10. **Regulatory / certification regime** (eIDAS, etc.) — drives traceability and
    audit artifacts, and ties back to the Gherkin question.

## Proposed path — risk-first shift left (pyramid × trophy hybrid)

**Two axes.** *Irreducibility* decides placement: a test runs on a device only if
nothing lower can exercise it (the native↔WebView bridge, real WebView, OS
prompts, full-stack KERIA). The *risk table* decides what to build first. I'd also
add **adversarial integrity** (security/abuse) as a first-class quality attribute.

| Tier | Today | Runs on | Owns | Speed |
|---|---|---|---|---|
| **Unit** | ✅ large (~1,400 cases) | jest, jsdom | pure logic; OOBI/ACDC parser fuzzing | ms |
| **Component** | ✅ present (RTL in `src`) | RTL, mocked store/router | single-component render/interaction | ms |
| **UI-integration** | ⚠️ partial — real store common, real router rare | RTL + real Redux + real router | multi-component flows, navigation, wiring | ms |
| **Integration (headless)** | ⚠️ primitives only — `virtual-wallet.ts` exists but is driven from the device tier; no headless tier | Node + signify + real KERIA (docker), no UI | protocol invariants (rotation, threshold, duplicity, recovery idempotency) incl. property/model-based + adversarial inputs; resilience/fault-injection | seconds |
| **E2E (device)** | ⚠️ over-built — 121 scenarios, gated to 1 | emulator + Appium + real KERIA | *irreducible only* — native bridge + one golden flow | minutes |

The unit base is already large; the gap is the empty middle (the headless
integration tier), and the primitives to fill it already exist in `tests/helpers/`. The work is
mostly **reorganizing existing assets**, not building from scratch.

### Immediate (highest leverage)

**1. Connect the existing KERIA stack to CI — the explicit ask.** The
infrastructure already exists; the gap is integration, not provisioning.

- **Start the stack** with `docker compose up`, not GitHub service containers:
  `cred-issuance` builds from source, and service containers accept pre-built
  images only. (If issuance is *not* a target journey, `keria + witnesses` alone
  suffice — see Q4.)
- **Bootstrap, don't just start.** A TCP port check on 3901/3903 ≠ a bootable
  agent; gate on a real readiness check (an OOBI-resolve or `/boot` handshake via a
  throwaway signify client) and pre-provision witnesses/OOBI seeding (the repo's
  `kli witness demo` + `backer-oobis.json` show the shape).
- **Pin the KERIA image by digest** — the dev tag is a throwaway branch-fix build
  and prod floats on `:main`, neither reproducible for a security-sensitive SUT.
- **Isolate each run** with `down -v` on the `keria-data` volume (a multisig
  ceremony must start from a clean agent); use explicit teardown in `if: always()`.
- **Reuse the existing topology** — `10.0.2.2` (emulator) vs `127.0.0.1` (Node) is
  already resolved in `ssi-agent-urls.helper.ts`; don't hardcode it.
- **CI safety:** gate report-publishing to same-repo runs (fork PRs get a
  read-only token); add a concurrency group + cancel-in-progress on `pull_request`.

**2. Add a headless integration tier by elevating the existing harness.**
`virtual-wallet.ts` + `backend-helpers.ts` already drive signify against KERIA.
Extract them into a headless Node tier whose value is doing what the device tier
*cannot*: asserting protocol **invariants** — key-rotation continuity,
signing-threshold enforcement, duplicity (conflicting-key-event) rejection,
recovery idempotency — including property/model-based and adversarial inputs. This
covers the credential and recovery risk gaps and is largely a refactor (effort
inferred, not measured). Delete device tests that merely duplicate unit coverage
(e.g. password rules already in `passwordStrengthChecker.test.ts`).

**3. Add a resilience tier (this bridges to Exercise 2).** A wallet on a remote
agent must be tested for failure, not just success. Real-KERIA-in-docker is the
ideal fault-injection substrate: `docker kill`/`pause`/`stop`+`start` the
container, drop or delay the network, and assert offline UX, queued/half-committed
operations, and resync-on-reconnect. This is a first-class journey class here, and
exactly the substrate Exercise 2 (offline testing with ephemeral docker) calls for.

**4. Make e2e deterministic.** Replace sleeps with condition waits; consolidate the
native↔WebView attach into one hardened helper (the real flake fix); add bounded
`specFileRetries` as a quarantine *signal*, not a crutch. Raising `waitforTimeout`
is only a stopgap.

### Follow-on

- **Cadence:** an `@smoke` device subset gates PRs (blocking, minutes); lower tiers
  run full per-PR; the full device matrix + long flows run nightly; the broadest OS
  matrix runs pre-release.
- **Dev-only seed hook** to kill the ~50s per-scenario onboarding — a *threat-model*
  item (it fabricates key/agent state in a security wallet), so it must be
  dead-code-eliminated in prod (`ENVIRONMENT !== "prod"` + Terser) *and* guarded by
  a CI assertion that fails the build if any seed hook ships in a release bundle.
- **One deep device golden flow** (onboard → identifier → connection → credential →
  recovery) as a *fidelity firewall*: its mandate is catching headless↔device
  divergence — native crypto/keychain, WebView-engine quirks, OS prompts — the
  things only true on glass, exactly where a wallet's key storage lives.
- **An operating model** so the suite can't decay to 1-of-121 again: track
  flake-rate trend, mean-time-to-signal, and journey coverage; name a suite owner
  with a quarantine-drain SLA; make "a new feature merges with its appropriate-tier
  test" a required gate (shift-left as culture, not just a tier diagram).
- **Parallelize across CI jobs, not within the runner.** `maxInstances: 1` likely
  stays — one Appium/WebView session per emulator is the practical ceiling. The
  realistic win is **CI-matrix fan-out**: N parallel jobs, each a self-contained
  runner (its own emulator + its own ephemeral KERIA) running an independent
  feature subset, so shards can't corrupt each other's agent state. Lower tiers
  parallelize freely in-process. Do this only after stabilizing (sharding a flaky
  suite multiplies flake), and note the bigger latency win is still moving work off
  the device tier, not fanning it out.

**Scaling the device tier — demand-driven, not build-for-build's-sake.** Today's
hosted single-emulator runner is the right call for a smoke gate. Climb this ladder
only when a concrete requirement forces it — broader device/API coverage, real
throughput pressure, persistent flake, or a release cadence the current setup can't
feed — never because a farm is impressive. Each rung is a deliberate ops-vs-cost
trade, and the key constraint: a grid/farm **cannot** run on ephemeral hosted
runners — it needs dedicated, persistent, KVM-capable infrastructure (or a paid
device cloud).

| Option | Where it runs | Pros | Cons |
| --- | --- | --- | --- |
| **GitHub-hosted emulator-runner** *(today)* | ephemeral runner, 1 emulator/job | zero infra/cost; matrix fan-out; fine as a smoke gate | 1 emulator/job; ~2-core, slow boot; flaky; no device variety |
| **Self-hosted KVM runners** | your VMs / bare-metal | more cores → faster + stabler; same `emulator-runner` flow; full control | you run + patch them; fixed capacity; self-hosted-runner security surface |
| **Selenoid** *(Aerokube)* | docker grid on one KVM host | open-source/free; lightweight; parallel sessions/host; VNC/video; one grid endpoint | single-host scaling ceiling; Android support heavier; you operate it |
| **Moon** *(Aerokube)* | k8s grid, KVM nodes | horizontal autoscale; on-demand; many API/device profiles in parallel; video | commercial above a small free tier; needs a standing KVM-node cluster; ops-heavy |
| **Managed device cloud** *(BrowserStack / Sauce / AWS Device Farm / Firebase)* | their infra | zero infra; real devices + emulators; wide matrix instantly | pay-per-minute; data leaves your env; session queues |

### CI/CD wiring (table stakes)

- Make the smoke gate a **required status check** with branch protection.
- **Pin Appium and the uiautomator2 driver**; add AVD-snapshot reuse + gradle
  `--parallel`/`--build-cache` (npm/gradle dependency caches already exist).
- **Publish artifacts** on the gate (allure + on-failure screenshot/page-source,
  with retention) and feed the suite-health metrics above, not just per-run triage.
- **Budget the nightly matrix** explicitly (runner-minutes × device count).

### Deliberately deferred

Named so the omission is a decision, not a blind spot: performance/cold-start,
accessibility, localization, and **consumer-driven contract testing** between
wallet and KERIA. The last is the strongest alternative to standing up a real KERIA
every run — a Pact-style contract gives a *deterministic* middle tier decoupled
from KERIA version drift, and is often *required* to deterministically produce the
failure cases the resilience tier needs. Worth weighing once KERIA's release-churn
(Q5) is known.

**Net effect:** point the pyramid at risk (recovery, credential authenticity,
offline, adversarial), wire and elevate what already exists (the dormant KERIA
stack, the signify harness), thin and stabilize the device tier, and wrap it in an
operating model — yielding risk-aligned coverage, faster feedback, and lower flake
than the current 121-scenario ice-cream cone.

---

*Sources:* [Veridian Overview](https://docs.veridian.id/) ·
[Onboarding](https://docs.veridian.id/onboarding) ·
[Identifiers](https://docs.veridian.id/apis/identifiers) ·
[Groups](https://docs.veridian.id/apis/groups) ·
[OOBIs](https://docs.veridian.id/foundations/oobis) ·
[KERIA stack](https://docs.veridian.id/stack)
