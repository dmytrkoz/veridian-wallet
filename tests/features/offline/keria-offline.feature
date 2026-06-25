Feature: Offline behaviour on KERIA network failure

  Proves the wallet detects loss of its KERIA cloud agent, surfaces the offline
  screen, and auto-recovers once connectivity returns. The outage is simulated
  by stopping the ephemeral KERIA container: the app's poller hits the failed
  fetch, flips offline, and the AppOffline overlay mounts; on restore the
  reconnect loop re-onlines and the overlay unmounts.

  @offline
  Scenario: KERIA outage shows the offline screen and recovers on reconnect
    Given user is onboarded (seed)
    When the KERIA backend goes offline
    Then the app shows the offline screen
    When the KERIA backend comes back online
    Then the app leaves the offline screen
