import { PasscodeScreen } from "../onboarding/passcode.screen";

export class IdentifiersCredentialPasscodeScreen extends PasscodeScreen {
    get verifyPasscodeTitle() {
        return $('[data-testid="verify-passcode-title"]');
    }
}

export default new IdentifiersCredentialPasscodeScreen();
