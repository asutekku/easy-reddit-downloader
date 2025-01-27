import { version } from "../package.json";
import defaultConfigJson from "../user_config_DEFAULT.json";
import { UserConfig } from "./types/config";
import { RuntimeConfig } from "./types/runtime";

const defaultConfig = defaultConfigJson as UserConfig;
import { ConfigService } from "./services/ConfigService";
import { FileService } from "./services/FileService";
import { RedditService } from "./services/RedditService";
import { CommentService } from "./services/CommentService";
import { DownloadController } from "./controllers/DownloadController";
import { PromptController } from "./controllers/PromptController";

async function main() {
  try {
    // Initialize services
    const configService = new ConfigService(defaultConfig);
    await configService.loadUserConfig();

    // Initialize services with configService
    const fileService = new FileService(configService);
    const redditService = new RedditService(configService);
    const commentService = new CommentService(configService);

    // Initialize controllers
    const promptController = new PromptController(configService);
    let downloadController = new DownloadController(
      configService,
      fileService,
      redditService,
      commentService
    );

    // Create necessary files
    await fileService.createDefaultFiles();

    // Display welcome message and check for updates
    promptController.displayWelcomeMessage();
    await promptController.checkForUpdates(version);

    const config = configService.getRuntimeConfig();
    if (!config.testingMode && !config.download_post_list_options.enabled) {
      // Start interactive prompt if not in testing mode
      await promptController.startPrompt();

      // Recreate download controller with updated config
      downloadController = new DownloadController(
        configService,
        fileService,
        redditService,
        commentService
      );
      
      // Get fresh config after prompt
      const updatedConfig = configService.getRuntimeConfig();
      await startDownloads(downloadController, updatedConfig.subredditList);
    } else if (config.download_post_list_options.enabled) {
      // Handle post list downloads
      await handlePostListDownloads(downloadController, config);
    } else {
      // Handle testing mode downloads
      await startDownloads(downloadController, config.subredditList);
    }
  } catch (error) {
    console.error("Fatal error:", error);
    process.exit(1);
  }
}

async function startDownloads(downloadController: DownloadController, subreddits: string[]): Promise<void> {
  const configService = downloadController["configService"] as ConfigService;
  const config = configService.getRuntimeConfig();
  
  // Only use last post ID if it came from the prompt controller
  // (which means user chose to continue an existing scrape)
  const lastPostId = config.last_post_id;

  for (const subreddit of subreddits) {
    await downloadController.startDownload(subreddit, lastPostId || null);
    downloadController.resetStats();
  }
}

async function handlePostListDownloads(downloadController: DownloadController, config: RuntimeConfig): Promise<void> {
  const lastPostId = config.last_post_id;

  if (config.download_post_list_options.repeatForever) {
    while (true) {
      await downloadController.startDownload("", lastPostId || null);
      downloadController.resetStats();
      const logger = downloadController["logger"];
      logger.log(`⏲️ Waiting ${config.download_post_list_options.timeBetweenRuns / 1000} seconds before rerunning...`, false);
      await new Promise((resolve) => setTimeout(resolve, config.download_post_list_options.timeBetweenRuns));
    }
  } else {
    await downloadController.startDownload("", lastPostId || null);
  }
}

// Start the application
main().catch(console.error);
