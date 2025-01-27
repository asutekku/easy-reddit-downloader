import axios from 'axios';
import { UserAgentService } from './UserAgentService';
import { LogService } from './LogService';
import { PostType, RedditApiResponse, RedditPost } from '../types/types';
import ytdl from 'ytdl-core';
import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs';
import { ConfigService } from './ConfigService';

export class RedditService {
    private configService: ConfigService;
    private logger: LogService;
    private postDelayMilliseconds: number = 250;
    private maxRetries: number = 5;
    private initialRetryDelay: number = 5000;

    constructor(configService: ConfigService) {
        this.configService = configService;
        this.logger = configService.getLogger();
    }

    public async fetchPosts(subreddit: string, lastPostId: string | null, limit: number): Promise<RedditApiResponse | null> {
        let retryCount = 0;
        let delay = this.initialRetryDelay;

        while (retryCount <= this.maxRetries) {
            try {
                const url = this.buildRedditUrl(subreddit, lastPostId, limit);
                this.logger.log(`\n\n👀 Requesting posts from ${url}\n`, true);

            const response = await axios.get(url, UserAgentService.getAxiosConfig());
                const data: RedditApiResponse = response.data;

                if (!data || data.message === "Not Found" || data.data.children.length === 0) {
                    throw new Error("No data found");
                }

                return data;
            } catch (err: any) {
                const isLastAttempt = retryCount === this.maxRetries;
                const isRateLimitError = err.response?.status === 429;
                const isServerError = err.response?.status >= 500;
                
                if (!isLastAttempt && (isRateLimitError || isServerError || err.code === 'ECONNRESET')) {
                    this.logger.log(
                        `\n⚠️ Attempt ${retryCount + 1}/${this.maxRetries + 1} failed. Retrying in ${delay/1000} seconds...`,
                        true
                    );
                    
                    await new Promise(resolve => setTimeout(resolve, delay));
                    retryCount++;
                    delay *= 2; // Exponential backoff
                    continue;
                }

                this.logger.logError(
                    `\n\nERROR: There was a problem fetching posts for ${subreddit}. ${
                        isRateLimitError ? 'Rate limit exceeded.' :
                        isServerError ? 'Reddit server error.' :
                        'This is likely because the subreddit is private, banned, or doesn\'t exist.'
                    }`
                );
                return null;
            }
        }
        return null;
    }

    private buildRedditUrl(subreddit: string, lastPostId: string | null, limit: number): string {
        const config = this.configService.getRuntimeConfig();
        const baseUrl = `https://www.reddit.com/r/${subreddit}/${config.sorting}/.json`;
        const params = new URLSearchParams({
            sort: config.sorting,
            t: config.time,
            limit: limit.toString(),
            ...(lastPostId && { after: lastPostId })
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
        const domain = post.domain || '';
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
        try {
            const response = await axios({
                method: "GET",
                url: downloadURL,
                responseType: "stream",
                ...UserAgentService.getAxiosConfig()
            });

            return new Promise((resolve, reject) => {
                const writer = fs.createWriteStream(filePath);
                response.data.pipe(writer);

                writer.on("finish", resolve);
                writer.on("error", reject);
            });
        } catch (error: any) {
            if (error.code === "ENOTFOUND") {
                this.logger.logError("ERROR: Hostname not found for: " + downloadURL + "\n... skipping post");
            } else {
                this.logger.logError("ERROR: " + error);
            }
            throw error;
        }
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
                    audioStream.pipe(fs.createWriteStream(tempAudioPath))
                        .on("finish", resolve)
                        .on("error", reject);
                }),
                new Promise<void>((resolve, reject) => {
                    videoStream.pipe(fs.createWriteStream(tempVideoPath))
                        .on("finish", resolve)
                        .on("error", reject);
                })
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
        return new Promise(resolve => setTimeout(resolve, this.postDelayMilliseconds));
    }
}
