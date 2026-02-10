# Backend helpers API for E2E tests

This folder contains the **API contract** that E2E tests use to talk to KERIA/Signify backend helpers. The contract is in `backend-api.contract.ts`.

## Who does what

| Role | Responsibility |
|------|----------------|
| **Test author** | Imports the contract types and calls the API (e.g. `setupBackendUser("Bob")`, `bob.getOobi({ groupId, groupName })`). Does not depend on implementation details. |
| **Dev / architect** | Implements helpers that satisfy the contract (e.g. `remote-bob.helper.ts` for `IBackendUser`, and a separate module for `IRemoteInitiator`). Can change internals as long as the public API matches the contract. |

## Personas

1. **Backend user (Bob-style)** – `IBackendUser` + `setupBackendUser(alias)`  
   - Used when the **app user is the initiator** (e.g. Alice) and the backend is a **member** that only provides an OOBI.  
   - Scenario: *Alice creates 1-of-2 group with one member (Bob) and group becomes active* (`onboarding-group-profile.feature`).  
   - Tests call: `setupBackendUser("Bob")`, then `bob.getOobi({ alias, groupId, groupName })`, and optionally `reset()` in an After hook.

2. **Remote initiator** – `IRemoteInitiator` + `setupRemoteInitiator()`  
   - Used when the **backend is the initiator** and the **app is the joiner**.  
   - Scenario: *Wallet joins a group proposed by remote initiator* (joiner flow).  
   - Tests call: `setupRemoteInitiator()`, then `ensureJoinerInKeria(joinerAid)`, `createGroup(groupName)`, `proposeGroupToJoiner(groupId, joinerAid)`, and optionally `waitForOperation(opId)`.

## URL config

Helpers receive KERIA URLs from `getKeriaUrlsForTestRunner()` in `ssi-agent-urls.helper.ts`. The contract does not define where config comes from; implementations use that helper (or an injected `KeriaConfig`) so tests work against the same host/ports.

## Contract file

- **`backend-api.contract.ts`** – TypeScript interfaces and type aliases only (no implementation). Both tests and helper implementations depend on this file.
