import fs from "fs";
import path from "path";
import { UserConfig } from "../types/config";
import { RuntimeConfig } from "../types/runtime";
import { SortTime, SortType } from "../types/types";
import { LogService } from "./LogService";

export class ConfigService {
  private defaultConfig: UserConfig;
  private runtimeConfig: RuntimeConfig;
  private logger: LogService;

  constructor(defaultConfig: UserConfig) {
    this.defaultConfig = defaultConfig;
    this.runtimeConfig = this.initializeRuntimeConfig(defaultConfig);
    this.logger = new LogService(this.runtimeConfig);
  }

  private initializeRuntimeConfig(config: UserConfig): RuntimeConfig {
    return {
      ...config,
      subredditList: config.testingMode ? config.testingModeOptions.subredditList : [],
      numberOfPosts: config.testingMode ? config.testingModeOptions.numberOfPosts : 0,
      sorting: config.testingMode ? config.testingModeOptions.sorting : "top",
      time: config.testingMode ? config.testingModeOptions.time : "all",
      repeatForever: config.testingMode ? config.testingModeOptions.repeatForever : false,
      timeBetweenRuns: config.testingMode ? config.testingModeOptions.timeBetweenRuns : 0,
      downloadDirectory: config.testingMode ? config.testingModeOptions.downloadDirectory : "./downloads",
    };
  }

  public async loadUserConfig(): Promise<void> {
    if (fs.existsSync("user_config.json")) {
      try {
        const userConfig = require("../../user_config.json") as UserConfig;
        this.runtimeConfig = {
          ...userConfig,
          ...this.initializeRuntimeConfig(userConfig),
        };
        this.validateConfig();
      } catch (error) {
        this.logger.logError("Error loading user config: " + error);
        throw error;
      }
    } else {
      await this.createDefaultConfig();
    }
  }

  private async createDefaultConfig(): Promise<void> {
    try {
      await fs.promises.copyFile("user_config_DEFAULT.json", "user_config.json");
      this.logger.log("user_config.json was created. Edit it to manage user options.", true);
      this.runtimeConfig = {
        ...this.defaultConfig,
        ...this.initializeRuntimeConfig(this.defaultConfig),
      };
    } catch (error) {
      this.logger.logError("Error creating default config: " + error);
      throw error;
    }
  }

  private validateConfig(): void {
    let warnTheUser = false;
    let quitApplication = false;
    const { file_naming_scheme: scheme } = this.runtimeConfig;

    const enabledOptions = [scheme.showDate === true, scheme.showAuthor === true, scheme.showTitle === true].filter(Boolean).length;

    if (enabledOptions === 0) {
      quitApplication = true;
    } else if (enabledOptions < 2) {
      warnTheUser = true;
    }

    if (warnTheUser) {
      this.logger.logWarning("WARNING: Your file naming scheme (user_config.json) is poorly set, we recommend changing it.");
    }

    if (quitApplication) {
      this.logger.logError(
        "ALERT: Your file naming scheme (user_config.json) does not have any options set. You can not download posts without filenames. Aborting."
      );
      process.exit(1);
    }

    if (quitApplication || warnTheUser) {
      this.logger.logError(
        "Read about recommended naming schemes here - https://github.com/josephrcox/easy-reddit-downloader/blob/main/README.md#File-naming-scheme"
      );
    }
  }

  public updateRuntimeConfig(updates: Partial<RuntimeConfig>): void {
    this.runtimeConfig = {
      ...this.runtimeConfig,
      ...updates,
    };
  }

  public getRuntimeConfig(): RuntimeConfig {
    return { ...this.runtimeConfig };
  }

  public setSubredditList(subreddits: string[]): void {
    this.runtimeConfig.subredditList = subreddits;
  }

  public setNumberOfPosts(count: number): void {
    this.runtimeConfig.numberOfPosts = count === 0 ? Number.MAX_SAFE_INTEGER : count;
  }

  public setSorting(sorting: SortType): void {
    this.runtimeConfig.sorting = sorting;
  }

  public setTime(time: SortTime): void {
    this.runtimeConfig.time = time;
  }

  public setRepeatForever(repeat: boolean): void {
    this.runtimeConfig.repeatForever = repeat;
  }

  public setTimeBetweenRuns(time: number): void {
    this.runtimeConfig.timeBetweenRuns = Math.max(0, time);
  }

  public setDownloadDirectory(directory: string): void {
    this.runtimeConfig.downloadDirectory = directory || "./downloads";
  }

  public getLogger(): LogService {
    return this.logger;
  }

  public async saveScrapeState(subreddits: string[], lastPostId: string | null): Promise<void> {
    try {
      const config = this.getRuntimeConfig();
      const currentDate = new Date().toISOString().split('T')[0]!; // Get just the date part
      const subredditString = subreddits.join('_');
      const scrapeStateDir = path.join(process.cwd(), 'scrape_states');
      
      if (!fs.existsSync(scrapeStateDir)) {
        fs.mkdirSync(scrapeStateDir, { recursive: true });
      }

      // Find existing state file for today
      const files = await fs.promises.readdir(scrapeStateDir);
      // Find existing state file for today
      const todayFile = files.find(file => 
        file.startsWith(currentDate) && 
        file.includes(subredditString) &&
        file.endsWith('_state.json')
      ) || `${currentDate}_${subredditString}_state.json`;

      const fileName = todayFile;
      const filePath = path.join(scrapeStateDir, fileName);

      const scrapeState: UserConfig = {
        ...config,
        last_post_id: lastPostId || undefined,
        scrape_finished: lastPostId === null // If lastPostId is null, the scrape was finished
      };

      await fs.promises.writeFile(filePath, JSON.stringify(scrapeState, null, 2));
      this.logger.log(`Updated scrape state in ${fileName}`, true);
    } catch (error) {
      this.logger.logError(`Failed to save scrape state: ${error}`);
    }
  }

  public async findLastScrapeState(subreddits: string[]): Promise<UserConfig | null> {
    try {
      const scrapeStateDir = path.join(process.cwd(), 'scrape_states');
      if (!fs.existsSync(scrapeStateDir)) {
        return null;
      }

      const subredditSet = new Set(subreddits);
      const files = await fs.promises.readdir(scrapeStateDir);
      console.log(files);
      
      // Filter and sort files by timestamp (newest first)
      const relevantFiles = files
        .filter(file => {
          const fileSubreddits = file.split('_state.json')[0]?.split('_')?.slice(1) || []; // Skip timestamp parts
          console.log(fileSubreddits);
          return fileSubreddits.length > 0 && fileSubreddits.every(sub => subredditSet.has(sub));
        })
        .sort((a, b) => b.localeCompare(a)); // Sort descending

      if (relevantFiles.length === 0) {
        return null;
      }

      const latestFile = relevantFiles[0];
      if (!latestFile) {
        return null;
      }
      
      const latestStatePath = path.join(scrapeStateDir, latestFile);
      const stateContent = await fs.promises.readFile(latestStatePath, 'utf-8');
      const state = JSON.parse(stateContent) as UserConfig;

      if (!state.scrape_finished) {
        this.logger.log(`Found unfinished scrape state from ${relevantFiles[0]}`, true);
        return state;
      }

      return null;
    } catch (error) {
      this.logger.logError(`Failed to find last scrape state: ${error}`);
      return null;
    }
  }
}
