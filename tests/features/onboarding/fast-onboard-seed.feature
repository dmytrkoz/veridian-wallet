Feature: Fast onboard via seed fixture

  Proves the dev-only fast-onboard fixture: instead of the ~50s UI onboarding
  precondition, the app is seeded programmatically (~19s, deterministic) and
  lands on the current Home dashboard — then exercises a current-UX screen.

  @seed @fixture
  Scenario: Seeded onboarding (empty) lands on the Home screen
    Given user is onboarded (seed)
    Then user can see the Home screen

  @seed @fixture
  Scenario: Seeded onboarding with an identifier lands on the Home screen
    Given user is onboarded (seed) with an identifier
    Then user can see the Home screen

  @seed @fixture
  Scenario: Seeded onboarding can reach a current post-onboarding screen
    Given user is onboarded (seed) with an identifier
    When user taps the Connections tab
    Then user can see the Connections screen
