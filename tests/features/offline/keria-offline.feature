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
