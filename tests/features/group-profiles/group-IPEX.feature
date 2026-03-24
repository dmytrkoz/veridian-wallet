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

#  @onboarding @profile @group @multisig @alice-initiator @ipex
#  Scenario Outline: Initiator creates <required>-of-<recovery> multisig group and it becomes active
#    Given Alice creates a group profile as initiator for <required>-of-<recovery> group "MultisigGroup"
#    And the following members resolve each others' OOBIs and create member ids:
#      | name     |
#      | <members> |
#    When Alice pastes all member OOBIs on the Scan tab
#    And Alice initiates the group identifier
#    And Alice sets required and recovery signers to <required> and <recovery>
#    And Alice sends the group requests
#    And all members accept the group invitation
#    Then the group status becomes "Active" when the group is ready
#    When IPEX Alice connects the credential issuer
#    And IPEX the credential issuer offers a "<acdc>" credential to Alice's group
#    Then IPEX Alice receives the offered credential as the initiator
#    And all members join the multisig admit
#    Then IPEX Alice presents the "<acdc>" credential as the initiator
#
#    Examples:
#      | required | recovery | members        | acdc                   |
#      | 1        | 2        | Bob            | Rare EVO 2024 Attendee |

  @onboarding @profile @group @multisig @alice-initiator @ipex @verifier
  Scenario Outline: Initiator creates <required>-of-<recovery> multisig group, receives credential and presents to verifier
    Given Alice creates a group profile as initiator for <required>-of-<recovery> group "MultisigGroup"
    And the following members resolve each others' OOBIs and create member ids:
      | name     |
      | <members> |
    When Alice pastes all member OOBIs on the Scan tab
    And Alice initiates the group identifier
    And Alice sets required and recovery signers to <required> and <recovery>
    And Alice sends the group requests
    And all members accept the group invitation
    Then the group status becomes "Active" when the group is ready
    When IPEX Alice connects the credential issuer
    And IPEX the credential issuer offers a "<acdc>" credential to Alice's group
    Then IPEX Alice receives the offered credential as the initiator
    And all members join the multisig admit
    Then IPEX Alice presents the "<acdc>" credential as the initiator
    When the verifier connects to Alice's group
    And the verifier requests a presentation of "<acdc>" from Alice's group
    Then IPEX Alice approves the presentation request
    And all members join the multisig grant
    Then the verifier receives the presented credential

    Examples:
      | required | recovery | members        | acdc                   |
      | 2        | 2        | Bob            | Rare EVO 2024 Attendee |
#      | 2        | 3        | Bob,Charlie    | Rare EVO 2024 Attendee |
#      | 3        | 3        | Bob,Charlie    | Rare EVO 2024 Attendee |
