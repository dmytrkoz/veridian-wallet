Feature: Fast onboard via seed fixture

  Dev-only fast-onboard seed (~19s vs ~50s UI onboarding); covers two distinct
  post-onboarding states.

  @seed @fixture @nightly
  Scenario: Seeded onboarding with no profile lands on Profile Setup
    Given user is onboarded (seed) at profile setup
    Then user can see the Profile Setup screen with no profile

  @seed @fixture @nightly
  Scenario: Seeded onboarding with one individual profile shows that profile
    Given user is onboarded (seed) with an identifier "Alice"
    Then user can see exactly one individual profile named "Alice"
