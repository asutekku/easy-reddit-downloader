export interface UserAgentSettings {
  userAgent: string;
  language: string;
  timezone: string;
  headers: {
    "Accept-Language": string;
    "Accept-Encoding": string;
    Referer: string;
    DNT: string;
    "Upgrade-Insecure-Requests": string;
    Accept: string;
    Connection: string;
  };
}

export const countryCodeMap = {
  eur: "en-gb",
  jap: "ja-jp",
  usa: "en-us",
  fi: "fi-fi",
  cn: "zh-cn",
};

export type CountryCode = keyof typeof countryCodeMap;
export type MappedCode = typeof countryCodeMap[CountryCode];
