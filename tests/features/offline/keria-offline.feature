Feature: Offline behaviour on KERIA network failure

  Proves the wallet detects loss of its KERIA cloud agent, surfaces the offline
  screen, and auto-recovers once connectivity returns. The outage is simulated by
  cutting the app<->KERIA connection at the Toxiproxy layer (keria stays UP): the
  app's poller hits the failed fetch, flips offline, and the AppOffline overlay
  mounts; on restore the reconnect loop re-onlines and the overlay unmounts.

  # @offline: backend routing marker - selects the toxiproxy fault-injection leg.
  @offline @smoke @nightly
  Scenario: KERIA outage shows the offline screen and recovers on reconnect
    Given user is onboarded (seed)
    When the KERIA backend goes offline
    Then the app shows the offline screen
    When the KERIA backend comes back online
    Then the app leaves the offline screen

  # Resilience: a connection drop DURING an operation (the DistributedReliability
  # contract) - the queued create is retried on reconnect and still converges.
  @offline @nightly
  Scenario: Connection drops mid-creation - the profile still completes on reconnect
    Given user is onboarded (seed) at profile setup
    When Alice creates an individual profile "AliceRecover" with a mid-creation KERIA outage
    Then the individual profile "AliceRecover" eventually shows as complete

  # Resilience: rapid connection instability (cut<->restore storm) must not leave
  # the app stuck - it settles back online.
  @offline @nightly
  Scenario: Rapid connection flapping settles back online
    Given user is onboarded (seed)
    When the KERIA connection flaps
    Then the app settles back online
