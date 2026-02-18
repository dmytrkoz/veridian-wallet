Feature: Group Profile Multisig (Initiator and members)

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
  Scenario: Initiator creates 1-of-2 group with one member (Bob) and group becomes active
    Given Alice creates a group profile as initiator for "Alice" with single-sig member id and groupId from Salter in her OOBI
    And Bob has resolved Alice's OOBI and created his member id with the same groupId copy-pasted into his OOBI
    When Alice pastes Bob's OOBI on the Scan tab
    And Alice initiates the group identifier
    And Alice sets required and recovery signers to 1 and 1
    And Alice sends the group requests
    And the group status becomes "Active" when the group is ready

  @onboarding @profile @group @multisig @alice-initiator @threshold-2of2
  Scenario: Initiator creates 2-of-2 signing threshold group with one member (Bob) and group becomes active
    Given Alice creates a group profile as initiator for "MultisigGroup" with single-sig member id and groupId from Salter in her OOBI
    And Bob has resolved Alice's OOBI and created his member id with the same groupId copy-pasted into his OOBI
    When Alice pastes Bob's OOBI on the Scan tab
    And Alice initiates the group identifier
    And Alice sets required and recovery signers to 2 and 2
    And Alice sends the group requests
    And Bob accepts the group invitation
    And the group status becomes "Active" when the group is ready

  @onboarding @profile @group @multisig @alice-initiator @threshold-2of3
  Scenario: Initiator creates 2-of-3 signing threshold group with two members (Bob and Charlie) and group becomes active
    Given Alice creates a group profile as initiator for "Alice" with single-sig member id and groupId from Salter in her OOBI
    And Bob has resolved Alice's OOBI and created his member id with the same groupId copy-pasted into his OOBI
    And Charlie has resolved Alice's OOBI and created his member id with the same groupId copy-pasted into his OOBI
    When Alice pastes Bob's OOBI on the Scan tab
    And Alice pastes Charlie's OOBI on the Scan tab
    And Alice initiates the group identifier
    And Alice sets required and recovery signers to 2 and 3
    And Alice sends the group requests
    And Bob accepts the group invitation
    And Charlie accepts the group invitation
    And the group status becomes "Active" when the group is ready
