Feature: Group Profile Multisig (Initiator and Members)

  Background:
    Given user tap Get Started button on Onboarding screen
    And user generate passcode on Passcode screen
    And user skip Biometric popup if it exist
    And skip Create Password screen
    And user is on Connect to Veridian screen
    And user navigates to SSI Agent Advanced Setup screen
    And SSI Agent URLs are cleared
    When user enters boot URL "default"
    And user enters connect URL "default"
    And user tap Validate button on SSI Agent Details screen

  @onboarding @profile @group @multisig @alice-initiator
  Scenario Outline: Initiator creates <required>-of-<recovery> multisig group and it becomes active
    Given IPEX Alice creates a group profile as initiator
    And IPEX the following members resolve each others' OOBIs and create member ids:
      | name     |
      | <members> |
    When IPEX Alice pastes all member OOBIs on the Scan tab
    And IPEX Alice initiates the group identifier
    And IPEX Alice sets required and recovery signers to <required> and <recovery>
    And IPEX Alice sends the group requests
    And IPEX all members accept the group invitation
    Then IPEX the group status becomes "Active" when the group is ready
    When IPEX Alice connects the active group to the credential issuer
    And IPEX the credential issuer offers a "Rare EVO 2024 Attendee" credential to Alice's group
    Then IPEX Alice receives the offered credential as the initiator
    When IPEX the credential issuer requests presentation of the "Rare EVO 2024 Attendee" credential from Alice's group
    Then IPEX Alice presents the requested credential as the initiator

    Examples:
      | required | recovery | members        |
     | 1        | 2        | Bob            |
    # | 2        | 2        | Bob            |
   #  | 2        | 3        | Bob,Charlie    |
     #| 3        | 3        | Bob,Charlie    |
