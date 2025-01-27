import { UserAgentSettings, countryCodeMap, CountryCode, MappedCode } from "../types/userAgent";

export class UserAgentService {
    private static readonly defaultUserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36";
    private static readonly userAgents = [
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
    ];

    private static readonly defaultSettings: UserAgentSettings = {
        userAgent: UserAgentService.defaultUserAgent,
        language: "en-US,en;q=0.9",
        timezone: "UTC",
        headers: {
            "Accept-Language": "en-US,en;q=0.9",
            "Accept-Encoding": "gzip, deflate, br",
            "Referer": "https://www.google.com/",
            "DNT": "1",
            "Upgrade-Insecure-Requests": "1",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8",
            "Connection": "keep-alive"
        }
    };

    public static getRandomUserAgent(): string {
        const index = Math.floor(Math.random() * UserAgentService.userAgents.length);
        return UserAgentService.userAgents[index]!;
    }

    public static getSettings(countryCode: CountryCode = 'usa'): UserAgentSettings {
        const mappedCode: MappedCode = countryCodeMap[countryCode];
        const languageString = mappedCode ? `en-US,en;q=0.9,${mappedCode};q=0.8` : 'en-US,en;q=0.9';
        const settings: UserAgentSettings = {
            ...UserAgentService.defaultSettings,
            userAgent: this.getRandomUserAgent(),
            language: languageString,
        };

        settings.headers["Accept-Language"] = settings.language;

        switch (mappedCode) {
            case "en-gb":
                settings.timezone = "Europe/London";
                break;
            case "ja-jp":
                settings.timezone = "Asia/Tokyo";
                break;
            case "en-us":
                settings.timezone = "America/New_York";
                break;
            case "fi-fi":
                settings.timezone = "Europe/Helsinki";
                break;
            case "zh-cn":
                settings.timezone = "Asia/Shanghai";
                break;
        }

        return settings;
    }

    public static getAxiosConfig(countryCode: CountryCode = 'usa') {
        const settings = this.getSettings(countryCode);
        return {
            headers: {
                ...settings.headers,
                "User-Agent": settings.userAgent
            }
        };
    }
}
