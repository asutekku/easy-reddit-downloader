import { LogService } from "./LogService";
import { ApiService } from "./ApiService";
import { PostType, RedditApiResponse, RedditPost } from "../types/types";
import ytdl from "ytdl-core";
import ffmpeg from "fluent-ffmpeg";
import fs from "fs";
import { ConfigService } from "./ConfigService";

export class RedditService {
  private configService: ConfigService;
  private logger: LogService;
  private apiService: ApiService;

  constructor(configService: ConfigService) {
    this.configService = configService;
    this.logger = configService.getLogger();
    this.apiService = new ApiService(this.logger);
  }

  public async fetchPosts(subreddit: string, lastPostId: string | null, limit: number): Promise<RedditApiResponse | null> {
    try {
      const url = this.buildRedditUrl(subreddit, lastPostId, limit);
      const data = await this.apiService.get<RedditApiResponse>(url);

      if (!data || data.message === "Not Found" || data.data.children.length === 0) {
        throw new Error("No data found");
      }

      return data;
    } catch (err: any) {
      this.logger.logError(
        `\n\nERROR: There was a problem fetching posts for ${subreddit}. ${
          err.response?.status === 429
            ? "Rate limit exceeded."
            : err.response?.status >= 500
            ? "Reddit server error."
            : "This is likely because the subreddit is private, banned, or doesn't exist."
        }`
      );
      return null;
    }
  }

  public async searchPosts(
    subreddit: string,
    lastPostId: string | null,
    limit: number,
    searchWord: string
  ): Promise<RedditApiResponse | null> {
    try {
      const url = this.buildRedditSearchUrl(subreddit, lastPostId, limit, searchWord);
      const data = await this.apiService.get<RedditApiResponse>(url);

      if (!data || data.message === "Not Found" || data.data.children.length === 0) {
        throw new Error("No data found");
      }

      return data;
    } catch (err: any) {
      this.logger.logError(
        `\n\nERROR: There was a problem fetching posts for ${subreddit}. ${
          err.response?.status === 429
            ? "Rate limit exceeded."
            : err.response?.status >= 500
            ? "Reddit server error."
            : "This is likely because the subreddit is private, banned, or doesn't exist."
        }`
      );
      return null;
    }
  }

  private buildRedditUrl(subreddit: string, lastPostId: string | null, limit: number): string {
    const config = this.configService.getRuntimeConfig();
    const baseUrl = `https://www.reddit.com/r/${subreddit}/${config.sorting}/.json`;
    const params = new URLSearchParams({
      sort: config.sorting,
      t: config.time,
      limit: limit.toString(),
      ...(lastPostId && { after: lastPostId }),
    });
    return `${baseUrl}?${params.toString()}`;
  }

  private buildRedditSearchUrl(subreddit: string, lastPostId: string | null, limit: number, searchWord: string): string {
    const config = this.configService.getRuntimeConfig();
    const baseUrl = `https://www.reddit.com/r/${subreddit}/search/.json`;
    const params = new URLSearchParams({
      q: searchWord,
      sort: config.sorting,
      t: config.time,
      limit: limit.toString(),
      restrict_sr: "on",
      type: this.configService.getRuntimeConfig().searchType === "post" ? "posts" : "comments",
      ...(lastPostId && { after: lastPostId }),
    });
    return `${baseUrl}?${params.toString()}`;
  }

  public getPostType(post: RedditPost): PostType {
    this.logger.log(`Analyzing post with title: [${post.title}] and URL: <${post.permalink}>`, true);

    if (post.post_hint === "self" || post.is_self) {
      return "self";
    }

    if (this.isMediaPost(post)) {
      return "media";
    }

    if (post.poll_data !== undefined) {
      return "poll";
    }

    if (post.domain?.includes("reddit.com") && post.is_gallery) {
      return "gallery";
    }

    return "link";
  }

  private isMediaPost(post: RedditPost): boolean {
    const domain = post.domain || "";
    return (
      post.post_hint === "image" ||
      (post.post_hint === "rich:video" && !domain.includes("youtu")) ||
      post.post_hint === "hosted:video" ||
      (post.post_hint === "link" && domain.includes("imgur") && !post.url_overridden_by_dest?.includes("gallery")) ||
      domain.includes("i.redd.it") ||
      domain.includes("i.reddituploads.com")
    );
  }

  public async downloadMediaFile(downloadURL: string, filePath: string): Promise<void> {
    const stream = await this.apiService.downloadStream(downloadURL);
    return new Promise((resolve, reject) => {
      const writer = fs.createWriteStream(filePath);
      stream.pipe(writer);
      writer.on("finish", resolve);
      writer.on("error", reject);
    });
  }

  public async downloadYouTubeVideo(url: string, filePath: string): Promise<void> {
    try {
      if (!ytdl.validateURL(url)) {
        throw new Error("Invalid YouTube URL");
      }

      const info = await ytdl.getInfo(url);
      const format = ytdl.chooseFormat(info.formats, { quality: "highest" });

      const tempAudioPath = `${filePath}.temp.mp3`;
      const tempVideoPath = `${filePath}.temp.mp4`;

      // Download audio and video streams
      const audioStream = ytdl(url, { filter: "audioonly" });
      const videoStream = ytdl(url, { format });

      await Promise.all([
        new Promise<void>((resolve, reject) => {
          audioStream.pipe(fs.createWriteStream(tempAudioPath)).on("finish", resolve).on("error", reject);
        }),
        new Promise<void>((resolve, reject) => {
          videoStream.pipe(fs.createWriteStream(tempVideoPath)).on("finish", resolve).on("error", reject);
        }),
      ]);

      // Merge audio and video
      await new Promise<void>((resolve, reject) => {
        ffmpeg()
          .input(tempVideoPath)
          .input(tempAudioPath)
          .output(filePath)
          .on("end", () => {
            // Clean up temp files
            fs.unlinkSync(tempAudioPath);
            fs.unlinkSync(tempVideoPath);
            resolve();
          })
          .on("error", reject)
          .run();
      });
    } catch (error) {
      this.logger.logError(`Failed to download YouTube video. Do you have FFMPEG installed? https://ffmpeg.org/`);
      throw error;
    }
  }

  public async sleep(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 250)); // Using default delay of 250ms
  }
}
