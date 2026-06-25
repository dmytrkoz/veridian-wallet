import {config as sharedConfig} from "./wdio.appium.config.js";

export const config = {
  ...sharedConfig,
  ...{
    // Bypass wdio-appium-service: start appium manually on 4723.
    // The service's stderr handler treats appium startup WARN lines as fatal,
    // breaking the readiness handshake and causing ECONNREFUSED races.
    services: [],
    capabilities: sharedConfig.capabilities.map((capability) => ({
      ...capability,
      "appium:deviceName": process.env.AVD_NAME || "Galaxy S24 Ultra",
    })),
  },
};
