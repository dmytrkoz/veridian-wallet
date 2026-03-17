export const CF_CREDENTIAL_ISSUANCE_ALIAS = "CF Credential Issuance";
export const RARE_EVO_SCHEMA_SAID = "EJxnJdxkHbRw2wVFNe4IUOPLt8fEtg9Sr3WyTjlgKoIb";
export const QVI_SCHEMA_SAID = "EBfdlu8R27Fbx-ehrqwImnK-8Cm79sqbAQ4MmvEAYqao";
export const LE_SCHEMA_SAID = "ENPXp1vQzRF6JwIuS-mp2U8Uf1MoADoP_GqQ62VsDZWY";
export const F_EMPLOYEE_SCHEMA_SAID = "EL9oOWU_7zQn_rD--Xsgi3giCWnFDaNvFMUGTOZx1ARO";
export const RARE_EVO_SCHEMA_NAME = "Rare EVO 2024 Attendee";

export const ACDC_SCHEMAS: Record<string, string> = {
  "Foundation Employee": F_EMPLOYEE_SCHEMA_SAID,
  "Qualified vLEI Issuer Credential": QVI_SCHEMA_SAID,
  "Rare EVO 2024 Attendee": RARE_EVO_SCHEMA_SAID,
  "Legal Entity vLEI Credential": LE_SCHEMA_SAID,
} as const;
