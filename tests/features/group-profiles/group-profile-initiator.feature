Feature: Group Profile Multisig (Initiator and Members)

  Background:
    Given user is onboarded (seed) at profile setup

  @onboarding @profile @group @multisig @initiator
  Scenario Outline: Initiator creates <required>-of-<recovery> multisig group and it becomes active
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

    Examples:
      | required | recovery | members        |
      | 1        | 2        | Bob            |
      | 2        | 2        | Bob            |
      | 2        | 3        | Bob,Charlie    |
      | 3        | 3        | Bob,Charlie    |
