import prompts, { PromptObject } from "prompts";
import { ConfigService } from "../services/ConfigService";
import { cleanSubreddits } from "../utils/utils";
import { SortTime, SortType } from "../types/types";
import { RuntimeConfig } from "../types/runtime";

export class PromptController {
  private configService: ConfigService;

  constructor(configService: ConfigService) {
    this.configService = configService;
  }

  public async startPrompt(): Promise<void> {
    // First ask for subreddits to check for existing scrapes
    const subredditQuestion: PromptObject = {
      type: "text",
      name: "subreddit",
      message: "Which subreddits or users would you like to download? You may submit multiple separated by commas (no spaces).",
      validate: (value: string) => (value.length < 1 ? `Please enter at least one subreddit or user` : true),
    };

    const { subreddit } = await prompts(subredditQuestion, {
      onCancel: () => {
        throw new Error("Prompt was cancelled");
      }
    });
    if (!subreddit) {
      throw new Error("No subreddit provided");
    }

    const subredditList = cleanSubreddits(subreddit.split(","));
    const existingScrape = await this.configService.findLastScrapeState(subredditList);

    let questions: PromptObject[] = [];
    
    // If there's an existing scrape, ask if user wants to continue it
    if (existingScrape && !existingScrape.scrape_finished) {
      const continueQuestion: PromptObject = {
        type: "toggle",
        name: "continueExisting",
        message: "An existing unfinished download was found. Do you want to continue it?",
        initial: true,
        active: "yes",
        inactive: "no",
      };

      const { continueExisting } = await prompts(continueQuestion, {
        onCancel: () => {
          throw new Error("Prompt was cancelled");
        }
      });
      
      if (continueExisting) {
        // Create runtime config from the saved state
        const savedRuntimeConfig = existingScrape as unknown as RuntimeConfig;
        const runtimeConfig: RuntimeConfig = {
          ...savedRuntimeConfig,
          subredditList, // Override with current subreddits
          // Keep existing runtime values or use testing mode values if available
          numberOfPosts: existingScrape.testingMode 
            ? existingScrape.testingModeOptions.numberOfPosts 
            : savedRuntimeConfig.numberOfPosts,
          sorting: existingScrape.testingMode 
            ? existingScrape.testingModeOptions.sorting 
            : savedRuntimeConfig.sorting,
          time: existingScrape.testingMode 
            ? existingScrape.testingModeOptions.time 
            : savedRuntimeConfig.time,
          repeatForever: existingScrape.testingMode 
            ? existingScrape.testingModeOptions.repeatForever 
            : savedRuntimeConfig.repeatForever,
          timeBetweenRuns: existingScrape.testingMode 
            ? existingScrape.testingModeOptions.timeBetweenRuns 
            : savedRuntimeConfig.timeBetweenRuns,
          downloadDirectory: existingScrape.testingMode 
            ? existingScrape.testingModeOptions.downloadDirectory 
            : (savedRuntimeConfig.downloadDirectory || "./downloads"),
        
          };
        
        // Update both configs to ensure consistency
        this.configService["defaultConfig"] = existingScrape;
        this.configService["runtimeConfig"] = runtimeConfig;
        
        this.configService.getLogger().log("Loaded previous configuration and scrape state", true);
        return;
      }
    }

    // If no existing scrape or user chose not to continue, show remaining questions
    questions = [
      {
        type: "number",
        name: "numberOfPosts",
        message: "How many posts would you like to attempt to download? If you would like to download all posts, enter 0.",
        initial: 0,
        validate: (value: number) => (!isNaN(value) ? true : `Please enter a number`),
      },
      {
        type: "text",
        name: "sorting",
        message: "How would you like to sort? (top, new, hot, rising, controversial)",
        initial: "top",
        validate: (value: string) => this.validateSorting(value.toLowerCase()),
      },
      {
        type: "text",
        name: "time",
        message: "During what time period? (hour, day, week, month, year, all)",
        initial: "month",
        validate: (value: string) => this.validateTime(value.toLowerCase()),
      },
      {
        type: "toggle",
        name: "repeatForever",
        message: "Would you like to run this on repeat?",
        initial: false,
        active: "yes",
        inactive: "no",
      },
      {
        type: (prev: boolean) => (prev ? "number" : null),
        name: "timeBetweenRuns",
        message: "How often would you like to run this? (in ms)",
      },
      {
        type: "text",
        name: "downloadDirectory",
        message: "Change the download path, defaults to ./downloads",
        initial: "",
      },
    ];

    const result = await prompts(questions, {
      onCancel: () => {
        throw new Error("Prompt was cancelled");
      }
    });

    // Validate required fields
    if (!result.sorting || !result.time) {
      throw new Error("Required options were not provided");
    }

    // Set the subreddit list since we already have it
    this.configService.setSubredditList(subredditList);
    await this.processPromptResult({ 
      ...result,
      subreddit,
      numberOfPosts: result.numberOfPosts ?? 0 // Default to 0 if not provided
    });
  }

  private async processPromptResult(result: any): Promise<void> {

    const subredditList = cleanSubreddits(result.subreddit.split(","));
    this.configService.setSubredditList(subredditList);

    const numberOfPosts = result.numberOfPosts;
    this.configService.setNumberOfPosts(numberOfPosts);

    const sorting = result.sorting.replace(/\s/g, "") as SortType;
    this.configService.setSorting(sorting);

    const time = result.time.replace(/\s/g, "") as SortTime;
    this.configService.setTime(time);

    const repeatForever = result.repeatForever;
    this.configService.setRepeatForever(repeatForever);

    if (repeatForever && result.timeBetweenRuns !== undefined) {
      const timeBetweenRuns = Math.max(0, result.timeBetweenRuns);
      this.configService.setTimeBetweenRuns(timeBetweenRuns);
    }

    if (result.downloadDirectory) {
      this.configService.setDownloadDirectory(result.downloadDirectory);
    }

    // Update the runtime configuration
    const updatedConfig = {
      ...this.configService.getRuntimeConfig(),
      subredditList,
      numberOfPosts,
      sorting,
      time,
      repeatForever,
      timeBetweenRuns: repeatForever ? result.timeBetweenRuns : 0,
      downloadDirectory: result.downloadDirectory || "./downloads",
    };
    this.configService.updateRuntimeConfig(updatedConfig);
  }

  private validateSorting(value: string): boolean | string {
    const validSortings = ["top", "new", "hot", "rising", "controversial"];
    return validSortings.includes(value) ? true : `Please enter a valid sorting method`;
  }

  private validateTime(value: string): boolean | string {
    const validTimes = ["hour", "day", "week", "month", "year", "all"];
    return validTimes.includes(value) ? true : `Please enter a valid time period`;
  }

  public async checkForUpdates(version: string): Promise<void> {
    const logger = this.configService.getLogger();
    try {
      const response = await fetch("https://api.github.com/repos/josephrcox/easy-reddit-downloader/releases/latest", {
        headers: { "User-Agent": "Downloader" },
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = (await response.json()) as { tag_name: string };
      const latestVersion = data.tag_name;

      if (version !== latestVersion) {
        logger.log(
          `Hey! A new version (${latestVersion}) is available. \nConsider updating to the latest version with 'git pull'.\n`,
          false
        );
      } else {
        logger.log(`You are on the latest stable version (${version})\n`, true);
      }
    } catch (error) {
      logger.logError(`Failed to check for updates: ${error}`);
    }
  }

  public displayWelcomeMessage(): void {
    const logger = this.configService.getLogger();
    console.clear();
    logger.log("👋 Welcome to the easiest & most customizable Reddit Post Downloader!", false);
    logger.log("😎 Contribute @ https://github.com/josephrcox/easy-reddit-downloader", false);
    logger.log("🤔 Confused? Check out the README @ https://github.com/josephrcox/easy-reddit-downloader#readme\n", false);
  }
}
